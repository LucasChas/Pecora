// ============================================================================
// Pecora — Edge Function: avisar-reposicion ("Avisame cuando vuelva")
//
// La dispara el trigger productos_aviso_reposicion (migración
// *_avisos_stock.sql) vía pg_net cuando un producto pasa de 0 a > 0 de stock y
// tiene suscripciones pendientes. Recibe solo { producto_id }; todo lo demás
// (producto, destinatarios) se lee acá con un cliente service-role.
//
// Por cada suscripción pendiente (sin notificado_at y sin reserva vigente:
// aviso_stock_pendiente en la migración) manda un
// mail "¡Volvió <producto>!" desde la cuenta de Gmail de la tienda (mismos
// secretos que enviar-recibo-pedido, ver _shared/correo.ts) con el link al
// producto y un link de baja
// (<sitio>/aviso/baja?token=...).
//
// Sin mails duplicados ni avisos perdidos:
//   * Antes de mandar, cada fila se "reserva" (RPC reservar_aviso_stock:
//     reservado_at = now() solo si sigue pendiente). Si otra invocación ya la
//     tomó (dos reposiciones seguidas), se saltea.
//   * Envío OK -> notificado_at = now(). Envío fallido -> se borra la reserva
//     y la fila queda pendiente para la próxima reposición.
//   * Si la función se cae o la cortan entre la reserva y el envío, la reserva
//     vence a los RESERVA_VENCE_MINUTOS y la fila vuelve a ser pendiente (la
//     toma la próxima reposición o select public.invocar_aviso_stock(...)).
//   * Toda llamada a Google o a Gmail tiene timeout, así una respuesta
//     colgada no deja la invocación esperando para siempre.
//   * Si el producto se volvió a agotar antes de que corra la función, no se
//     manda nada (las suscripciones siguen pendientes).
//
// Tandas de LIMITE_POR_TANDA filas, con un tope de tiempo por invocación. Si
// quedan pendientes, se loguea cómo volver a invocarla.
//
// Auth: igual que enviar-recibo-pedido (verificación JWT de Supabase + el
// Bearer tiene que ser EXACTAMENTE la service-role key, en tiempo constante).
//
// Secretos: GMAIL_SENDER + GMAIL_APP_PASSWORD (o GMAIL_CLIENT_ID,
// GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN para OAuth), BRAND_NAME, BRAND_LOGO_URL (opcional), PUBLIC_SITE_URL
// (opcional; si falta usa STORE_URL y, si tampoco, el muestrario en Vercel),
// más SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY que inyecta Supabase.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  bearerToken,
  buildMimeMessageConBaja,
  conTimeout,
  enmascararEmail,
  formatFromHeader,
  leerProductoId,
  LIMITE_POR_TANDA,
  primeraFoto,
  resolverSitio,
  separarDestinatarios,
  sqlReintentarAviso,
  type Suscripcion,
  tokensIguales,
  urlBaja,
  urlProducto,
} from "./logica.ts";
import { renderAvisoReposicion } from "./template.ts";
import { abrirCorreo } from "../_shared/correo.ts";
import { leerConfigCorreo, MENSAJE_FALTAN_SECRETOS } from "../_shared/correoConfig.ts";

const LOG_PREFIX = "[avisar-reposicion]";

/** Tope de tiempo por invocación (el límite de las Edge Functions es mayor). */
const PRESUPUESTO_MS = 100_000;

/** Fallas de envío seguidas que cortan la invocación (Gmail caído, cuota). */
const MAX_FALLAS_SEGUIDAS = 5;

interface ProductoRow {
  id: string;
  nombre: string;
  slug: string | null;
  precio: number | string;
  stock: number;
  imagenes: string[] | null;
  imagen_url: string | null;
}

function crearClienteAdmin(url: string, serviceRoleKey: string) {
  // También con timeout las llamadas a la base (PostgREST), así una respuesta
  // colgada no se come el presupuesto de la invocación.
  return createClient(url, serviceRoleKey, {
    global: { fetch: (input, init) => fetch(input, conTimeout(init)) },
  });
}
type SupabaseAdmin = ReturnType<typeof crearClienteAdmin>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Reserva la fila (RPC reservar_aviso_stock: reservado_at = now() si sigue
 * pendiente, en la base y con la misma regla que la lectura). true si la tomó.
 */
async function reservar(supabase: SupabaseAdmin, id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("reservar_aviso_stock", { p_id: id });
  if (error) {
    console.error(`${LOG_PREFIX} no se pudo reservar la suscripción ${id}:`, error.message);
    return false;
  }
  return data === true;
}

/** Marca la fila como avisada después de un envío OK. */
async function marcarNotificado(supabase: SupabaseAdmin, id: string): Promise<void> {
  const { error } = await supabase
    .from("avisos_stock")
    .update({ notificado_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    // El mail ya salió: si la marca no se guarda, al vencer la reserva la fila
    // vuelve a pendiente y la clienta podría recibir un segundo aviso.
    console.error(
      `${LOG_PREFIX} ACCIÓN REQUERIDA: el aviso ${id} se mandó pero no se pudo marcar ` +
        `(${error.message}). Para no repetirlo: ` +
        `update public.avisos_stock set notificado_at = now() where id = '${id}';`,
    );
  }
}

/** Borra la reserva después de un envío fallido (la fila vuelve a pendiente). */
async function liberar(supabase: SupabaseAdmin, id: string): Promise<void> {
  const { error } = await supabase
    .from("avisos_stock")
    .update({ reservado_at: null })
    .eq("id", id)
    .is("notificado_at", null);
  if (error) {
    console.error(
      `${LOG_PREFIX} el mail de la suscripción ${id} falló y no se pudo borrar la reserva ` +
        `(${error.message}). Vuelve a estar pendiente sola cuando venza la reserva; para ` +
        `reintentarla ya: ${sqlReintentarAviso(id)}`,
    );
  }
}

Deno.serve(async (req: Request) => {
  const inicio = Date.now();

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`${LOG_PREFIX} faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY`);
    return jsonResponse({ ok: false, error: "missing_supabase_env" }, 500);
  }

  const token = bearerToken(req);
  if (!token || !(await tokensIguales(token, serviceRoleKey))) {
    console.error(
      `${LOG_PREFIX} request rechazada (401): el Bearer no es la service-role key. ` +
        `Revisar el secreto de Vault 'pecora_email_function_token'.`,
    );
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    console.error(`${LOG_PREFIX} body inválido: no es JSON`);
    return jsonResponse({ ok: false, error: "invalid_body" }, 400);
  }
  const productoId = leerProductoId(body);
  if (!productoId) {
    console.error(`${LOG_PREFIX} falta producto_id (uuid) en el body`);
    return jsonResponse({ ok: false, error: "missing_producto_id" }, 400);
  }

  console.log(`${LOG_PREFIX} recibido producto_id=${productoId}`);

  if (!leerConfigCorreo(Deno.env.get)) {
    console.error(
      `${LOG_PREFIX} ${MENSAJE_FALTAN_SECRETOS} — no se manda ningún aviso (las suscripciones quedan pendientes).`,
    );
    return jsonResponse({ ok: true, skipped: "missing_email_secrets" });
  }

  const brandName = Deno.env.get("BRAND_NAME") ?? "Pecora";
  const brandLogoUrl = Deno.env.get("BRAND_LOGO_URL") || null;
  const sitio = resolverSitio(Deno.env.get("PUBLIC_SITE_URL"), Deno.env.get("STORE_URL"));

  const supabase = crearClienteAdmin(supabaseUrl, serviceRoleKey);

  const { data: producto, error: productoError } = await supabase
    .from("productos")
    .select("id, nombre, slug, precio, stock, imagenes, imagen_url")
    .eq("id", productoId)
    .maybeSingle<ProductoRow>();
  if (productoError) {
    console.error(`${LOG_PREFIX} error leyendo producto ${productoId}:`, productoError.message);
    return jsonResponse({ ok: false, error: "producto_read_failed" }, 500);
  }
  if (!producto) {
    console.error(`${LOG_PREFIX} producto ${productoId} no encontrado`);
    return jsonResponse({ ok: false, error: "producto_not_found" }, 404);
  }
  if (!(producto.stock > 0)) {
    console.log(`${LOG_PREFIX} producto ${productoId} volvió a quedar sin stock — no se avisa`);
    return jsonResponse({ ok: true, skipped: "sin_stock" });
  }

  // Pendientes = sin avisar y sin reserva vigente (misma regla que la reserva
  // y el trigger: aviso_stock_pendiente en la base).
  const leerTanda = async (desdeId: string | null) =>
    await supabase
      .rpc("avisos_stock_pendientes", {
        p_producto_id: productoId,
        p_desde_id: desdeId,
        p_limite: LIMITE_POR_TANDA,
      })
      .returns<Suscripcion[]>();

  let tanda = await leerTanda(null);
  if (tanda.error) {
    console.error(`${LOG_PREFIX} error leyendo suscripciones de ${productoId}:`, tanda.error.message);
    return jsonResponse({ ok: false, error: "avisos_read_failed" }, 500);
  }
  if (!tanda.data || tanda.data.length === 0) {
    console.log(`${LOG_PREFIX} producto ${productoId}: sin suscripciones pendientes`);
    return jsonResponse({ ok: true, skipped: "sin_pendientes" });
  }

  const apertura = await abrirCorreo(Deno.env.get);
  if (!apertura.ok) {
    console.error(
      `${LOG_PREFIX} ACCIÓN REQUERIDA (producto ${productoId}): ${apertura.detalle} ` +
        `NO sale ningún aviso (quedan pendientes).`,
    );
    return jsonResponse({ ok: false, error: "gmail_oauth_refresh_failed" }, 502);
  }
  const correo = apertura.correo;
  const from = formatFromHeader(brandName, correo.remitente);
  const linkProducto = urlProducto(sitio, producto);
  const foto = primeraFoto(producto);
  const precio = Number(producto.precio);

  let enviados = 0;
  let fallidos = 0;
  let invalidos = 0;
  let tomadosPorOtra = 0;
  let fallasSeguidas = 0;
  let cortado: "tiempo" | "fallas" | null = null;

  procesar: while (tanda.data && tanda.data.length > 0) {
    const { validas, invalidas } = separarDestinatarios(tanda.data);
    for (const fila of invalidas) {
      invalidos++;
      console.error(
        `${LOG_PREFIX} suscripción ${fila.id}: email o token inválido — se omite (queda pendiente)`,
      );
    }

    for (const fila of validas) {
      if (Date.now() - inicio > PRESUPUESTO_MS) {
        cortado = "tiempo";
        break procesar;
      }
      if (!(await reservar(supabase, fila.id))) {
        tomadosPorOtra++;
        continue;
      }

      const baja = urlBaja(sitio, fila.token);
      const { subject, html } = renderAvisoReposicion(
        { nombreProducto: producto.nombre, precio, fotoUrl: foto, urlProducto: linkProducto, urlBaja: baja },
        { brandName, brandLogoUrl, sitioUrl: sitio },
      );
      const envio = await correo.enviar(
        fila.email,
        buildMimeMessageConBaja({ from, to: fila.email, subject, html, urlBaja: baja }),
      );
      if (!envio.ok) console.error(`${LOG_PREFIX} aviso ${fila.id}: ${envio.error}`);
      if (envio.ok) {
        enviados++;
        fallasSeguidas = 0;
        await marcarNotificado(supabase, fila.id);
        console.log(`${LOG_PREFIX} aviso enviado — producto ${productoId} → ${enmascararEmail(fila.email)}`);
      } else {
        fallidos++;
        fallasSeguidas++;
        await liberar(supabase, fila.id);
        if (fallasSeguidas >= MAX_FALLAS_SEGUIDAS) {
          cortado = "fallas";
          break procesar;
        }
      }
    }

    const ultimo = tanda.data[tanda.data.length - 1].id;
    if (tanda.data.length < LIMITE_POR_TANDA) break;
    tanda = await leerTanda(ultimo);
    if (tanda.error) {
      console.error(`${LOG_PREFIX} error leyendo la siguiente tanda:`, tanda.error.message);
      break;
    }
  }

  correo.cerrar();

  if (cortado) {
    console.warn(
      `${LOG_PREFIX} producto ${productoId}: se cortó por ${cortado === "tiempo" ? "tiempo" : `${MAX_FALLAS_SEGUIDAS} fallas seguidas de envío`}; ` +
        `quedan suscripciones pendientes. Para reintentar, en el SQL Editor: ` +
        `select public.invocar_aviso_stock('${productoId}');`,
    );
  }

  const resultado = { enviados, fallidos, invalidos, tomados_por_otra: tomadosPorOtra, cortado };
  console.log(`${LOG_PREFIX} producto ${productoId}: ${JSON.stringify(resultado)}`);
  const huboFalla = fallidos > 0 || cortado !== null;
  return jsonResponse({ ok: !huboFalla, ...resultado }, huboFalla ? 502 : 200);
});
