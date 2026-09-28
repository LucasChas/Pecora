// ============================================================================
// Pecora — Edge Function: enviar-recibo-pedido
//
// Disparada por el trigger AFTER INSERT de la migración 0012 (pg_net,
// fire-and-forget). Recibe solo { pedido_id }, vuelve a leer el pedido del
// lado del servidor con un cliente service-role y manda, vía la API de Gmail
// (enviando como pecoraabril@gmail.com por OAuth2), dos mails independientes:
//   1) El recibo a la clienta.
//   2) El aviso de "nuevo pedido" a la dueña (secreto OWNER_EMAIL).
// Si uno falla, el otro se intenta igual. Cada uno se marca en la base
// (pedidos.email_enviado_at / pedidos.aviso_duena_enviado_at) después de
// salir bien; si la función se vuelve a invocar para el mismo pedido, lo ya
// enviado no se reenvía. Desde el panel, la admin la vuelve a invocar con el
// RPC reenviar_emails_pedido (misma llamada que el trigger).
//
// La lógica pura (qué mandar, auth, destinatarios, MIME) está en logica.ts,
// con tests en logica.test.ts; los templates, en template.ts.
//
// Los pedidos cargados a mano por la admin (origen = 'admin') no generan
// ningún mail: la clienta no hizo el pedido por la web y la dueña ya lo sabe.
//
// Por qué no confiar en un payload completo: el destinatario y el contenido se
// calculan acá adentro a partir de la fila real en la base, nunca del body de
// la request.
//
// Auth (dos capas):
//   * Supabase valida el JWT antes de que este código corra (se despliega con
//     verificación JWT default, sin --no-verify-jwt).
//   * Además, acá se exige que el Bearer sea EXACTAMENTE la service-role key.
//     La verificación de Supabase sola también deja pasar la anon key, que es
//     pública (está en el bundle del front): con ella cualquiera podía invocar
//     la función. El trigger 0012 manda el secreto de Vault
//     'pecora_email_function_token', que tiene que ser la service-role key.
//
// Envío vía Gmail API: flujo OAuth2 de dos pasos por request:
//   1) POST a oauth2.googleapis.com/token con el refresh token para conseguir
//      un access token de corta duración (uno solo, para los dos mails).
//   2) POST a gmail.googleapis.com/.../messages/send con ese access token,
//      mandando el mensaje crudo en formato RFC 2822 codificado en base64url.
//
// Secretos usados (ver supabase/functions/README.md para setearlos):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER,
//   OWNER_EMAIL (uno o varios, separados por coma — sin este no sale el aviso
//   a la dueña), BRAND_NAME, BRAND_LOGO_URL, STORE_URL, WHATSAPP_NUMBER
//   (opcional), SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (estas dos las
//   inyecta Supabase automáticamente en toda Edge Function).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  bearerToken,
  buildMimeMessage,
  decidirEnvios,
  esCargaManual,
  type EstadoEnvio,
  formatFecha,
  formatFromHeader,
  parseItems,
  parseOwnerEmails,
  toBase64Url,
  tokensIguales,
  toNumber,
  waClienteUrl,
} from "./logica.ts";
import {
  renderAvisoDuena,
  renderRecibo,
  type Entrega,
  type TotalesPedido,
} from "./template.ts";

const LOG_PREFIX = "[enviar-recibo-pedido]";

interface RequestBody {
  pedido_id?: string;
}

interface PedidoRow {
  id: string;
  numero: number;
  nombre: string;
  telefono: string;
  email: string | null;
  entrega: string;
  direccion: string | null;
  localidad: string | null;
  cp: string | null;
  provincia: string | null;
  notas: string | null;
  items: unknown;
  subtotal: number | string;
  descuento: number | string;
  costo_envio: number | string;
  total: number | string;
  origen: string;
  user_id: string | null;
  created_at: string;
  email_enviado_at: string | null;
  aviso_duena_enviado_at: string | null;
}

const PEDIDO_COLUMNS =
  "id, numero, nombre, telefono, email, entrega, direccion, localidad, cp, provincia, " +
  "notas, items, subtotal, descuento, costo_envio, total, origen, user_id, created_at, " +
  "email_enviado_at, aviso_duena_enviado_at";

/** Cliente service-role (saltea RLS). Wrapper no genérico para poder tiparlo. */
function crearClienteAdmin(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey);
}
type SupabaseAdmin = ReturnType<typeof crearClienteAdmin>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ----------------------------------------------------------------------------
// Gmail.
// ----------------------------------------------------------------------------

/**
 * Explica qué hacer cuando Google no renueva el acceso. Se loguea tal cual en
 * los logs de la función para que la dueña (o quien mire) sepa cómo arreglarlo.
 */
function logOauthRefreshFailed(pedidoId: string, detalle: string): void {
  console.error(
    `${LOG_PREFIX} gmail_oauth_refresh_failed (pedido ${pedidoId}): ${detalle}`,
  );
  console.error(
    `${LOG_PREFIX} ACCIÓN REQUERIDA: no se pudo renovar el acceso a Gmail, así que ` +
      `NO sale ningún mail (ni el recibo a la clienta ni el aviso a la dueña). ` +
      `Si Google respondió "invalid_grant", el refresh token venció o fue revocado. ` +
      `Causa más común: la app OAuth de Google Cloud está en modo "Testing", y en ` +
      `ese modo Google hace vencer los refresh tokens a los 7 días. Solución: ` +
      `publicar la app (Google Cloud → APIs & Services → OAuth consent screen → ` +
      `"Publish app") y generar un refresh token nuevo (OAuth Playground), o pasar ` +
      `a un proveedor transaccional. Después: ` +
      `supabase secrets set GMAIL_REFRESH_TOKEN=<nuevo>. ` +
      `Detalle en supabase/functions/README.md.`,
  );
}

/**
 * Paso A: refresca el access token de corta duración a partir del refresh
 * token. Nunca lanza: devuelve el token o una descripción del error.
 */
async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ token: string } | { error: string }> {
  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return { error: `Google respondió ${res.status}: ${errorText}` };
    }

    const data = await res.json();
    if (!data || typeof data.access_token !== "string" || !data.access_token) {
      return { error: `respuesta de refresh sin access_token: ${JSON.stringify(data)}` };
    }

    return { token: data.access_token };
  } catch (err) {
    return { error: `excepción llamando a oauth2.googleapis.com: ${String(err)}` };
  }
}

/** Paso B: manda un mensaje. Nunca lanza: devuelve true/false y loguea. */
async function enviarGmail(
  accessToken: string,
  mensaje: { from: string; to: string; subject: string; html: string },
  contexto: string,
): Promise<boolean> {
  const raw = toBase64Url(buildMimeMessage(mensaje));
  try {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ raw }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`${LOG_PREFIX} ${contexto}: Gmail API respondió ${res.status}:`, errorText);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} ${contexto}: excepción llamando a Gmail API:`, err);
    return false;
  }
}

/**
 * Marca el mail como enviado. Solo si seguía sin marcar, para no pisar la hora
 * de un envío anterior. Si falla, el mail ya salió: se loguea y listo.
 */
async function marcarEnviado(
  supabase: SupabaseAdmin,
  pedidoId: string,
  columna: "email_enviado_at" | "aviso_duena_enviado_at",
): Promise<void> {
  const { error } = await supabase
    .from("pedidos")
    .update({ [columna]: new Date().toISOString() })
    .eq("id", pedidoId)
    .is(columna, null);
  if (error) {
    console.error(
      `${LOG_PREFIX} pedido ${pedidoId}: el mail salió pero no se pudo guardar ${columna} ` +
        `(una re-invocación lo reenviaría):`,
      error.message,
    );
  }
}

/** Email de la clienta: pedidos.email → fallback a auth.users.email. */
async function resolverEmailCliente(
  supabase: SupabaseAdmin,
  pedido: PedidoRow,
): Promise<string> {
  const email = pedido.email?.trim() || "";
  if (email || !pedido.user_id) return email;

  // try/catch: si esto falla, el aviso a la dueña tiene que salir igual.
  try {
    const { data, error } = await supabase.auth.admin.getUserById(pedido.user_id);
    if (error) {
      console.error(
        `${LOG_PREFIX} error leyendo auth.users para user_id=${pedido.user_id}:`,
        error.message,
      );
      return "";
    }
    return data.user?.email?.trim() || "";
  } catch (err) {
    console.error(`${LOG_PREFIX} excepción leyendo auth.users para user_id=${pedido.user_id}:`, err);
    return "";
  }
}

Deno.serve(async (req: Request) => {
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
        `Si viene del trigger 0012, revisar el secreto de Vault 'pecora_email_function_token'.`,
    );
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    console.error(`${LOG_PREFIX} body inválido: no es JSON`);
    return jsonResponse({ ok: false, error: "invalid_body" }, 400);
  }

  const pedidoId = body?.pedido_id;
  if (!pedidoId || typeof pedidoId !== "string") {
    console.error(`${LOG_PREFIX} falta pedido_id en el body`);
    return jsonResponse({ ok: false, error: "missing_pedido_id" }, 400);
  }

  console.log(`${LOG_PREFIX} recibido pedido_id=${pedidoId}`);

  const gmailClientId = Deno.env.get("GMAIL_CLIENT_ID");
  const gmailClientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  const gmailRefreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
  const gmailSender = Deno.env.get("GMAIL_SENDER");
  const brandName = Deno.env.get("BRAND_NAME") ?? "Pecora";
  const brandLogoUrl = Deno.env.get("BRAND_LOGO_URL") || null;
  const storeUrl = Deno.env.get("STORE_URL") ?? "";
  // Mismo número que usa el front (VITE_WHATSAPP_NUMBER) — como esta función
  // corre en otro runtime (Deno, no Vite), se repite como secreto propio en
  // vez de compartir el .env del frontend. Formato: código de país + área +
  // número, sin "+" ni espacios (ej: 5493511234567).
  const whatsappNumber = Deno.env.get("WHATSAPP_NUMBER") || null;
  const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}` : null;
  const branding = { brandName, brandLogoUrl, storeUrl, whatsappUrl };

  if (!gmailClientId || !gmailClientSecret || !gmailRefreshToken || !gmailSender) {
    console.error(
      `${LOG_PREFIX} faltan GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN/GMAIL_SENDER — no se puede enviar`,
    );
    // No es un error del pedido: respondemos ok igual, el trigger ya ignora
    // cualquier resultado. Solo logueamos para que la dueña lo detecte.
    return jsonResponse({ ok: true, skipped: "missing_email_secrets" });
  }

  const supabase = crearClienteAdmin(supabaseUrl, serviceRoleKey);

  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .select(PEDIDO_COLUMNS)
    .eq("id", pedidoId)
    .maybeSingle<PedidoRow>();

  if (pedidoError) {
    console.error(`${LOG_PREFIX} error leyendo pedido ${pedidoId}:`, pedidoError.message);
    return jsonResponse({ ok: false, error: "pedido_read_failed" }, 500);
  }
  if (!pedido) {
    console.error(`${LOG_PREFIX} pedido ${pedidoId} no encontrado`);
    return jsonResponse({ ok: false, error: "pedido_not_found" }, 404);
  }

  // Carga manual de la admin (pedido por WhatsApp): no se manda nada. Se
  // corta antes de buscar el email de la clienta en auth.users.
  if (esCargaManual(pedido.origen)) {
    console.log(`${LOG_PREFIX} pedido ${pedidoId}: carga manual (origen admin) — no se envían mails`);
    return jsonResponse({ ok: true, skipped: "manual" });
  }

  const entrega: Entrega = pedido.entrega === "envio" ? "envio" : "coordinar";
  const items = parseItems(pedido.items);
  const totales: TotalesPedido = {
    subtotal: toNumber(pedido.subtotal),
    descuento: toNumber(pedido.descuento),
    costoEnvio: toNumber(pedido.costo_envio),
    total: toNumber(pedido.total),
  };
  const emailCliente = await resolverEmailCliente(supabase, pedido);
  const owner = parseOwnerEmails(Deno.env.get("OWNER_EMAIL"));

  // --------------------------------------------------------------------------
  // Qué hay que mandar (logica.ts). Se decide antes de pedir el token a
  // Google, así una re-invocación sin nada pendiente no consume una llamada
  // OAuth.
  // --------------------------------------------------------------------------
  const decision = decidirEnvios({
    origen: pedido.origen,
    emailEnviadoAt: pedido.email_enviado_at,
    avisoDuenaEnviadoAt: pedido.aviso_duena_enviado_at,
    emailCliente,
    ownerEmails: owner.validos,
  });
  if (decision.tipo === "manual") {
    // Ya se cortó arriba; queda por si cambia el criterio de esCargaManual.
    return jsonResponse({ ok: true, skipped: "manual" });
  }

  let estadoRecibo: EstadoEnvio | "pending" = decision.recibo;
  if (estadoRecibo === "no_recipient") {
    console.log(`${LOG_PREFIX} pedido ${pedidoId}: sin email en pedidos ni en auth.users — recibo omitido`);
  } else if (estadoRecibo === "invalid_recipient") {
    // No es un error del pedido: solo no se puede armar un mensaje seguro con
    // este valor. Logueado, no lanzado.
    console.error(`${LOG_PREFIX} pedido ${pedidoId}: email de la clienta con formato inválido/inseguro, recibo omitido`);
  }

  if (owner.invalidos > 0) {
    console.warn(`${LOG_PREFIX} OWNER_EMAIL tiene ${owner.invalidos} dirección(es) inválida(s) — se ignoran`);
  }
  let estadoAviso: EstadoEnvio | "pending" = decision.aviso;
  if (estadoAviso === "owner_email_unset") {
    console.warn(
      `${LOG_PREFIX} OWNER_EMAIL no está configurado (o no tiene direcciones válidas) — ` +
        `no se manda el aviso de pedido nuevo a la dueña. ` +
        `Configurarlo con: supabase secrets set OWNER_EMAIL=dueña@ejemplo.com`,
    );
  }

  if (estadoRecibo !== "pending" && estadoAviso !== "pending") {
    return jsonResponse({ ok: true, recibo: estadoRecibo, aviso: estadoAviso });
  }

  const oauth = await refreshAccessToken(gmailClientId, gmailClientSecret, gmailRefreshToken);
  if ("error" in oauth) {
    logOauthRefreshFailed(pedidoId, oauth.error);
    return jsonResponse({ ok: false, error: "gmail_oauth_refresh_failed" }, 502);
  }

  const from = formatFromHeader(brandName, gmailSender);

  // 1) Recibo a la clienta.
  if (estadoRecibo === "pending") {
    const { subject, html } = renderRecibo(
      {
        numero: pedido.numero,
        fecha: formatFecha(pedido.created_at),
        nombre: pedido.nombre,
        items,
        totales,
        entrega,
      },
      branding,
    );
    const ok = await enviarGmail(
      oauth.token,
      { from, to: emailCliente, subject, html },
      `recibo pedido ${pedidoId}`,
    );
    if (ok) {
      console.log(`${LOG_PREFIX} recibo enviado — pedido ${pedidoId} → ${emailCliente}`);
      await marcarEnviado(supabase, pedidoId, "email_enviado_at");
      estadoRecibo = "sent";
    } else {
      estadoRecibo = "send_failed";
    }
  }

  // 2) Aviso a la dueña (independiente del resultado del recibo).
  if (estadoAviso === "pending") {
    const { subject, html } = renderAvisoDuena(
      {
        numero: pedido.numero,
        fecha: formatFecha(pedido.created_at, true),
        cliente: {
          nombre: pedido.nombre,
          telefono: pedido.telefono,
          email: emailCliente || null,
        },
        entrega,
        direccion: pedido.direccion,
        localidad: pedido.localidad,
        cp: pedido.cp,
        provincia: pedido.provincia,
        notas: pedido.notas,
        items,
        totales,
        whatsappClienteUrl: waClienteUrl(pedido.telefono, pedido.numero, brandName),
        panelUrl: storeUrl ? `${storeUrl.replace(/\/+$/, "")}/admin` : null,
      },
      branding,
    );
    const ok = await enviarGmail(
      oauth.token,
      { from, to: owner.validos.join(", "), subject, html },
      `aviso a la dueña pedido ${pedidoId}`,
    );
    if (ok) {
      console.log(`${LOG_PREFIX} aviso a la dueña enviado — pedido ${pedidoId}`);
      await marcarEnviado(supabase, pedidoId, "aviso_duena_enviado_at");
      estadoAviso = "sent";
    } else {
      estadoAviso = "send_failed";
    }
  }

  const huboFalla = estadoRecibo === "send_failed" || estadoAviso === "send_failed";
  return jsonResponse(
    { ok: !huboFalla, recibo: estadoRecibo, aviso: estadoAviso },
    huboFalla ? 502 : 200,
  );
});
