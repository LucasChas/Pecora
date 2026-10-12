// ============================================================================
// Pecora — Edge Function: crear-pedido-invitada
//
// Registra un pedido de una invitada (compra sin cuenta). Desde la migración
// 20261008120000_proteger_compra_invitada, crear_pedido ya no se puede llamar
// con la anon key: sin esta función, cualquiera podía crear pedidos sin pasar
// por la página (y reservar stock o mandar comprobantes a cualquier mail).
//
// POST con la anon key:
//   { turnstile_token: string,
//     pedido: { p_nombre, p_telefono, p_email, p_entrega, p_direccion,
//               p_localidad, p_cp, p_notas, p_items, p_subtotal, p_provincia,
//               p_idempotency_key, p_cotizacion_envio } }
//   -> 200 { numero }
// Errores: { error: <mensaje en español>, codigo } con 400/403/405/429/500/503.
//   codigo P0001 / 22023: mensaje de crear_pedido (22023 = recotizar el envío).
//   codigo sin_permiso (503): la base todavía no tiene la migración.
//
// Pasos:
//   1) CORS: solo los orígenes de CATALOG_ORIGIN y ADMIN_ORIGIN.
//   2) CAPTCHA: verifica el token de Cloudflare Turnstile (un solo uso, vence
//      a los 5 minutos) con TURNSTILE_SECRET_KEY.
//   3) Tope por conexión: registrar_intento_invitada con un hash de la IP
//      (5 cada 10 minutos, 20 por día). Si la plataforma no informa la IP,
//      no se aplica (el CAPTCHA sí).
//   4) crear_pedido con la service_role, sin sesión: la base lo registra como
//      pedido de invitada, con todas sus validaciones y topes.
//
// La lógica pura está en logica.ts, con tests en logica.test.ts.
// Secretos: TURNSTILE_SECRET_KEY y CATALOG_ORIGIN (ver
// supabase/functions/README.md). SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los
// inyecta Supabase.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  corsHeaders,
  cuerpoError,
  error,
  type ErrorCotizacion,
  errorDeRpc,
  esError,
  hashIp,
  ipConfiable,
  numeroDePedido,
  origenesPermitidos,
  origenPermitido,
  parseCuerpo,
  turnstileValido,
} from "./logica.ts";

const LOG_PREFIX = "[crear-pedido-invitada]";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const env = (k: string) => Deno.env.get(k);

async function verificarTurnstile(token: string, secreto: string, ip: string | null): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secreto);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    if (!turnstileValido(json)) {
      console.warn(`${LOG_PREFIX} turnstile rechazado: ${JSON.stringify(json?.["error-codes"] ?? [])}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} no se pudo verificar turnstile:`, err instanceof Error ? err.message : err);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const permitidos = origenesPermitidos(env("CATALOG_ORIGIN"), env("ADMIN_ORIGIN"));
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin, permitidos);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  const fallo = (e: ErrorCotizacion) => json(cuerpoError(e), e.status);

  if (origin && !origenPermitido(origin, permitidos)) {
    if (permitidos.length === 0) {
      console.error(`${LOG_PREFIX} falta el secreto CATALOG_ORIGIN: se rechazan todos los navegadores`);
    }
    return fallo(error(403, "origin_not_allowed", "Origen no permitido."));
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return fallo(error(405, "method_not_allowed", "Método no permitido."));
  }

  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const turnstileSecret = env("TURNSTILE_SECRET_KEY");
  if (!supabaseUrl || !serviceRoleKey || !turnstileSecret) {
    console.error(`${LOG_PREFIX} faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o TURNSTILE_SECRET_KEY`);
    return fallo(error(500, "missing_env", "La compra sin cuenta no está disponible en este momento."));
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fallo(error(400, "invalid_body", "El pedido no tiene el formato esperado."));
  }
  const cuerpo = parseCuerpo(body);
  if (esError(cuerpo)) return fallo(cuerpo);

  const ip = ipConfiable(req.headers);
  if (!(await verificarTurnstile(cuerpo.token, turnstileSecret, ip))) {
    return fallo(error(403, "captcha_invalido",
      "No pudimos verificar que no seas un robot. Volvé a intentar en un momento."));
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (ip) {
      const { data: permitido, error: errTope } = await supabase.rpc("registrar_intento_invitada", {
        p_ip_hash: await hashIp(ip, turnstileSecret),
      });
      if (errTope) {
        // Sin la migración (o con la base caída) se sigue: crear_pedido
        // tiene sus propios topes por email y teléfono.
        console.warn(`${LOG_PREFIX} registrar_intento_invitada falló: ${errTope.message}`);
      } else if (permitido === false) {
        return fallo(error(429, "rate_limited",
          "Hiciste muchos pedidos seguidos. Esperá un rato o escribinos por WhatsApp."));
      }
    } else {
      console.warn(`${LOG_PREFIX} sin IP confiable en los headers: no se aplica el tope por conexión`);
    }

    const { data, error: errRpc } = await supabase.rpc("crear_pedido", {
      ...cuerpo.params,
      p_origen: "checkout",
      p_cupon: null,
    });
    if (errRpc) {
      const e = errorDeRpc(errRpc);
      if (e.status >= 500) console.error(`${LOG_PREFIX} crear_pedido falló: ${errRpc.code} ${errRpc.message}`);
      return fallo(e);
    }
    const numero = numeroDePedido(data);
    if (numero === null) {
      console.error(`${LOG_PREFIX} crear_pedido devolvió un número inválido: ${JSON.stringify(data)}`);
      return fallo(error(500, "internal_error",
        "No pudimos confirmar el número del pedido. Escribinos por WhatsApp antes de volver a intentar."));
    }
    return json({ numero });
  } catch (err) {
    console.error(`${LOG_PREFIX} error inesperado:`, err instanceof Error ? err.message : err);
    return fallo(error(500, "internal_error", "No pudimos registrar el pedido. Probá de nuevo en un momento."));
  }
});
