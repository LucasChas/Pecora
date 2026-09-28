// ============================================================================
// Pecora — Edge Function: gestionar-equipo
//
// El panel (solo una admin) gestiona el equipo de la tienda: quién tiene rol
// 'empleado'. Cambiar roles e invitar cuentas necesita la service-role key, que
// nunca va al navegador; por eso vive acá.
//
// POST con el JWT de la sesión de la admin (Authorization: Bearer <jwt>):
//   { accion: 'listar' }
//       -> { ok: true, miembros: [{ id, email, nombre, rol, ultimo_ingreso }] }
//          (admins y empleados; admins primero)
//   { accion: 'invitar', email, nombre }
//       -> { ok: true, resultado: 'invitada' | 'promovida' | 'sin_cambios', miembro,
//            origen_link: <origen del link del mail> | null }
//          Sin cuenta: manda el mail de invitación de Supabase Auth (link a
//          PUBLIC_ADMIN_URL, que debe ser https y del mismo origen que
//          ADMIN_ORIGIN; si no, 500 config_invalida y no se manda nada) y le
//          da rol empleado. Con cuenta de clienta: le da
//          rol empleado (sin mail). Si ya es admin: 409.
//   { accion: 'revocar', user_id }
//       -> { ok: true }. Vuelve a rol cliente. No se puede con una misma ni con
//          otra admin.
// Errores: { ok: false, error: <mensaje en español>, codigo }.
//
// Auth: el JWT se valida con supabase.auth.getUser(token) (con el cliente
// service-role) y el rol se lee de public.profiles del lado del servidor;
// nunca del body. Solo rol 'admin'. La plataforma también verifica el JWT
// antes de que corra este código (deploy con verificación JWT default).
//
// El cambio de rol se hace con service_role: el trigger de la 0014
// (proteger_rol_perfil) lo permite solo para service_role / postgres.
//
// CORS: solo los orígenes de ADMIN_ORIGIN (uno o varios, separados por coma).
// Un request con Origin fuera de la lista recibe 403.
//
// La lógica pura está en logica.ts, con tests en logica.test.ts.
//
// Secretos: ADMIN_ORIGIN, PUBLIC_ADMIN_URL (ver supabase/functions/README.md).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  armarMiembros,
  bearerToken,
  corsHeaders,
  cuerpoError,
  decidirInvitacion,
  error,
  errorConfigInvitacion,
  type ErrorEquipo,
  esEmailYaRegistrado,
  esError,
  origenPermitido,
  parseAccion,
  parseOrigenes,
  redirectInvitacion,
  validarRevocacion,
  verificarAdmin,
} from "./logica.ts";

const LOG_PREFIX = "[gestionar-equipo]";

const RESULTADO_INVITACION = {
  invitar: "invitada",
  promover: "promovida",
  sin_cambios: "sin_cambios",
} as const;

function crearClienteAdmin(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
type SupabaseAdmin = ReturnType<typeof crearClienteAdmin>;

async function leerRol(supabase: SupabaseAdmin, userId: string): Promise<string | null> {
  const { data, error: err } = await supabase
    .from("profiles")
    .select("rol")
    .eq("id", userId)
    .maybeSingle<{ rol: string }>();
  if (err) throw new Error(`leyendo profiles(${userId}): ${err.message}`);
  return data?.rol ?? null;
}

/** Deja la cuenta con rol empleado (crea el perfil si falta). */
async function hacerEmpleado(supabase: SupabaseAdmin, userId: string, nombre: string): Promise<void> {
  const { data: perfil, error: errLeer } = await supabase
    .from("profiles")
    .select("id, nombre")
    .eq("id", userId)
    .maybeSingle<{ id: string; nombre: string | null }>();
  if (errLeer) throw new Error(`leyendo profiles(${userId}): ${errLeer.message}`);

  if (!perfil) {
    const { error: errAlta } = await supabase
      .from("profiles")
      .insert({ id: userId, nombre, rol: "empleado" });
    if (errAlta) throw new Error(`creando profiles(${userId}): ${errAlta.message}`);
    return;
  }

  // El nombre solo se completa si la cuenta no tenía uno.
  const cambios: Record<string, string> = { rol: "empleado" };
  if (!perfil.nombre?.trim()) cambios.nombre = nombre;
  const { error: errCambio } = await supabase.from("profiles").update(cambios).eq("id", userId);
  if (errCambio) throw new Error(`actualizando profiles(${userId}): ${errCambio.message}`);
}

async function miembro(supabase: SupabaseAdmin, userId: string) {
  const { data, error: err } = await supabase.rpc("equipo_listar");
  if (err) throw new Error(`equipo_listar: ${err.message}`);
  return armarMiembros(data).find((m) => m.id === userId) ?? null;
}

Deno.serve(async (req: Request) => {
  const permitidos = parseOrigenes(Deno.env.get("ADMIN_ORIGIN"));
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin, permitidos);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  const fallo = (e: ErrorEquipo) => json(cuerpoError(e), e.status);

  // Un navegador en otro origen no puede usar la función (sin Origin =
  // llamada de servidor/CLI: la auth decide).
  if (origin && !origenPermitido(origin, permitidos)) {
    if (permitidos.length === 0) {
      console.error(`${LOG_PREFIX} falta el secreto ADMIN_ORIGIN: se rechazan todos los navegadores`);
    }
    return fallo(error(403, "origin_not_allowed", "Origen no permitido."));
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return fallo(error(405, "method_not_allowed", "Método no permitido."));
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`${LOG_PREFIX} faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY`);
    return fallo(error(500, "missing_supabase_env", "La función no está configurada."));
  }
  const supabase = crearClienteAdmin(supabaseUrl, serviceRoleKey);

  // ---- Quién llama ----------------------------------------------------------
  const token = bearerToken(req);
  if (!token) return fallo(error(401, "unauthorized", "Tu sesión venció. Volvé a ingresar."));

  const { data: auth, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !auth?.user) {
    return fallo(error(401, "unauthorized", "Tu sesión venció. Volvé a ingresar."));
  }
  const callerId = auth.user.id;

  try {
    const noAdmin = verificarAdmin(await leerRol(supabase, callerId));
    if (noAdmin) return fallo(noAdmin);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fallo(error(400, "invalid_body", "El pedido no tiene el formato esperado."));
    }
    const accion = parseAccion(body);
    if (esError(accion)) return fallo(accion);

    // ---- listar -------------------------------------------------------------
    if (accion.accion === "listar") {
      const { data, error: err } = await supabase.rpc("equipo_listar");
      if (err) throw new Error(`equipo_listar: ${err.message}`);
      return json({ ok: true, miembros: armarMiembros(data) });
    }

    // ---- revocar ------------------------------------------------------------
    if (accion.accion === "revocar") {
      const rol = await leerRol(supabase, accion.userId);
      const invalido = validarRevocacion(
        callerId,
        rol === null ? null : { id: accion.userId, rol },
      );
      if (invalido) return fallo(invalido);

      // Condicional por rol: si en el medio la hicieron admin, no se toca.
      const { data, error: err } = await supabase
        .from("profiles")
        .update({ rol: "cliente" })
        .eq("id", accion.userId)
        .eq("rol", "empleado")
        .select("id");
      if (err) throw new Error(`revocando ${accion.userId}: ${err.message}`);
      if (!data?.length) {
        return fallo(error(409, "not_staff", "Esa cuenta no es parte del equipo."));
      }
      console.log(`${LOG_PREFIX} ${callerId} revocó a ${accion.userId}`);
      return json({ ok: true });
    }

    // ---- invitar ------------------------------------------------------------
    const { data: idExistente, error: errBuscar } = await supabase.rpc("usuario_id_por_email", {
      p_email: accion.email,
    });
    if (errBuscar) throw new Error(`usuario_id_por_email: ${errBuscar.message}`);

    let userId = typeof idExistente === "string" ? idExistente : null;
    let decision = decidirInvitacion(
      userId ? { id: userId, rol: await leerRol(supabase, userId) } : null,
    );
    if (esError(decision)) return fallo(decision);

    // Origen al que lleva el link del mail (solo si se mandó una invitación).
    let origenLink: string | null = null;

    if (decision === "invitar") {
      // Validación estricta antes de invitar: con un redirect inválido Supabase
      // manda igual el mail, pero el link cae en la tienda pública.
      const redirect = redirectInvitacion(Deno.env.get("PUBLIC_ADMIN_URL"), permitidos);
      if (!redirect.ok) {
        console.error(
          `${LOG_PREFIX} invitación no enviada: secreto ${redirect.secreto} mal configurado (${redirect.motivo})`,
        );
        return fallo(errorConfigInvitacion());
      }
      const { data: inv, error: errInv } = await supabase.auth.admin.inviteUserByEmail(accion.email, {
        redirectTo: redirect.url,
        data: { nombre: accion.nombre },
      });
      if (errInv && esEmailYaRegistrado(errInv)) {
        // Se creó la cuenta en el medio: se la promueve.
        const { data: id2 } = await supabase.rpc("usuario_id_por_email", { p_email: accion.email });
        userId = typeof id2 === "string" ? id2 : null;
        if (!userId) throw new Error(`invitación: el email ya existe pero no se encontró la cuenta`);
        decision = decidirInvitacion({ id: userId, rol: await leerRol(supabase, userId) });
        if (esError(decision)) return fallo(decision);
      } else if (errInv || !inv?.user) {
        console.error(`${LOG_PREFIX} inviteUserByEmail falló:`, errInv?.message);
        return fallo(error(502, "invite_failed", "No se pudo mandar la invitación. Probá de nuevo en un rato."));
      } else {
        userId = inv.user.id;
        origenLink = redirect.origen;
      }
    }

    if (!userId) throw new Error("invitación sin userId");
    if (decision !== "sin_cambios") {
      await hacerEmpleado(supabase, userId, accion.nombre);
    }

    const resultado = RESULTADO_INVITACION[decision];
    console.log(`${LOG_PREFIX} ${callerId} invitó a ${userId} (${resultado})`);
    return json({
      ok: true,
      resultado,
      miembro: await miembro(supabase, userId),
      origen_link: origenLink,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} error inesperado:`, err instanceof Error ? err.message : err);
    return fallo(error(500, "internal_error", "Algo salió mal. Probá de nuevo en un rato."));
  }
});
