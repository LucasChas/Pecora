// ============================================================================
// Pecora — Edge Function: enviar-recibo-pedido
//
// Disparada por el trigger AFTER INSERT de la migración 0012 (pg_net,
// fire-and-forget). Recibe solo { pedido_id }, vuelve a leer el pedido del
// lado del servidor con un cliente service-role, resuelve el destinatario y
// manda el mail de confirmación vía la API de Gmail (enviando como
// pecoraabril@gmail.com por OAuth2), no SMTP crudo: Deno Edge Functions no
// tienen un path confiable de TCP/SMTP de larga duración.
//
// Por qué no confiar en un payload completo: un body forjado o repetido en
// el peor caso re-envía un comprobante legítimo a su dueña legítima, nunca
// puede redirigir uno a otra persona, porque el destinatario se calcula acá
// adentro a partir de la fila real en la base — nunca del body de la request.
//
// Auth: se despliega con verificación JWT default (sin --no-verify-jwt). El
// trigger manda la service-role key como Bearer; Supabase la valida antes de
// que este código corra.
//
// Envío vía Gmail API: no hay API key estática de "envío" como con un
// proveedor transaccional — se usa un flujo OAuth2 de dos pasos por request:
//   1) POST a oauth2.googleapis.com/token con el refresh token (obtenido una
//      sola vez a mano, ver supabase/functions/README.md) para conseguir un
//      access token de corta duración.
//   2) POST a gmail.googleapis.com/.../messages/send con ese access token,
//      mandando el mensaje crudo en formato RFC 2822 codificado en
//      base64url.
//
// Secretos usados (ver supabase/functions/README.md para setearlos):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER,
//   BRAND_NAME, BRAND_LOGO_URL, STORE_URL, WHATSAPP_NUMBER (opcional — sin
//   este, el mail sale igual, solo sin el botón de WhatsApp), SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY (estas dos últimas las inyecta Supabase
//   automáticamente en toda Edge Function).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { renderRecibo, type ReciboData, type ReciboItem } from "./template.ts";

const LOG_PREFIX = "[enviar-recibo-pedido]";

interface RequestBody {
  pedido_id?: string;
}

interface PedidoRow {
  id: string;
  numero: number;
  nombre: string;
  email: string | null;
  entrega: "envio" | "coordinar";
  items: unknown;
  subtotal: number;
  user_id: string | null;
  created_at: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseItems(raw: unknown): ReciboItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ReciboItem | null => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const nombre = typeof obj.nombre === "string" ? obj.nombre : "";
      const precio = typeof obj.precio === "number" ? obj.precio : Number(obj.precio) || 0;
      const cantidad = typeof obj.cantidad === "number" ? obj.cantidad : Number(obj.cantidad) || 0;
      if (!nombre) return null;
      return { nombre, precio, cantidad };
    })
    .filter((item): item is ReciboItem => item !== null);
}

function formatFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ----------------------------------------------------------------------------
// Helpers de codificación para armar el mensaje MIME crudo que espera la
// Gmail API en `messages.send` (campo `raw`, base64url del RFC 2822 completo).
// ----------------------------------------------------------------------------

/** UTF-8 string → base64 estándar (con padding, sin las sustituciones url-safe). */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Envuelve una string base64 en líneas de 76 caracteres (recomendado por MIME). */
function wrapBase64(b64: string, lineLength = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += lineLength) {
    lines.push(b64.slice(i, i + lineLength));
  }
  return lines.join("\r\n");
}

/**
 * Codifica un Subject con caracteres no-ASCII (tildes, ñ) como "encoded-word"
 * RFC 2047: =?UTF-8?B?<base64>?=. Sin esto, headers con acentos quedan mal
 * interpretados por la mayoría de los clientes de correo.
 */
function encodeMimeSubject(subject: string): string {
  return `=?UTF-8?B?${utf8ToBase64(subject)}?=`;
}

/**
 * String (ASCII-only, ya armado) → base64url SIN padding, apto para el campo
 * `raw` de la Gmail API: `+` → `-`, `/` → `_`, se recorta el `=` final.
 */
function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Formato básico de email + ausencia de CR/LF. `pedidos.email` no tiene
 * validación de formato a nivel de base (crear_pedido() lo inserta tal cual
 * viene), así que sin este chequeo un `email` malicioso con un salto de línea
 * podría inyectar headers extra (ej. un Bcc oculto) en el mensaje RFC 2822.
 */
const EMAIL_RE = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;
function esEmailSeguro(value: string): boolean {
  return EMAIL_RE.test(value) && !/[\r\n]/.test(value);
}

/** Arma el mensaje RFC 2822 completo (headers + línea en blanco + cuerpo). */
function buildMimeMessage(params: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): string {
  const encodedSubject = encodeMimeSubject(params.subject);
  const encodedBody = wrapBase64(utf8ToBase64(params.html));

  return [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    encodedBody,
  ].join("\r\n");
}

/**
 * Paso A: refresca el access token de corta duración a partir del refresh
 * token de larga duración (obtenido una sola vez a mano, ver README).
 * Nunca lanza: cualquier falla vuelve `null` para que el caller responda
 * limpio, respetando el contrato fire-and-forget del trigger.
 */
async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string | null> {
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
      console.error(
        `${LOG_PREFIX} refresh de token OAuth falló (${res.status}):`,
        errorText,
      );
      return null;
    }

    const data = await res.json();
    if (!data || typeof data.access_token !== "string" || !data.access_token) {
      console.error(`${LOG_PREFIX} respuesta de refresh sin access_token:`, data);
      return null;
    }

    return data.access_token;
  } catch (err) {
    console.error(`${LOG_PREFIX} excepción refrescando token OAuth:`, err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    console.error(`${LOG_PREFIX} body inválido: no es JSON`);
    return jsonResponse({ ok: false, error: "invalid_body" }, 400);
  }

  const pedidoId = body.pedido_id;
  if (!pedidoId || typeof pedidoId !== "string") {
    console.error(`${LOG_PREFIX} falta pedido_id en el body`);
    return jsonResponse({ ok: false, error: "missing_pedido_id" }, 400);
  }

  console.log(`${LOG_PREFIX} recibido pedido_id=${pedidoId}`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`${LOG_PREFIX} faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY`);
    return jsonResponse({ ok: false, error: "missing_supabase_env" }, 500);
  }
  if (!gmailClientId || !gmailClientSecret || !gmailRefreshToken || !gmailSender) {
    console.error(
      `${LOG_PREFIX} faltan GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN/GMAIL_SENDER — no se puede enviar`,
    );
    // No es un error del pedido: respondemos ok igual, el trigger ya ignora
    // cualquier resultado. Solo logueamos para que la dueña lo detecte.
    return jsonResponse({ ok: true, skipped: "missing_email_secrets" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .select("id, numero, nombre, email, entrega, items, subtotal, user_id, created_at")
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

  // Resolución de destinatario: pedidos.email (capturado en checkout) →
  // fallback a auth.users.email del user_id → si ninguno existe, no-op.
  let recipient = pedido.email?.trim() || "";
  if (!recipient && pedido.user_id) {
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
      pedido.user_id,
    );
    if (userError) {
      console.error(
        `${LOG_PREFIX} error leyendo auth.users para user_id=${pedido.user_id}:`,
        userError.message,
      );
    } else {
      recipient = userData.user?.email?.trim() || "";
    }
  }

  if (!recipient) {
    console.log(
      `${LOG_PREFIX} pedido ${pedidoId}: sin email en pedidos ni en auth.users — no-op`,
    );
    return jsonResponse({ ok: true, skipped: "no_recipient" });
  }

  if (!esEmailSeguro(recipient)) {
    // No es un error del pedido (el pedido ya se creó bien) — solo no se
    // puede armar un mensaje seguro con este valor. Logueado, no lanzado.
    console.error(
      `${LOG_PREFIX} pedido ${pedidoId}: destinatario con formato inválido/inseguro, no se envía`,
    );
    return jsonResponse({ ok: true, skipped: "invalid_recipient" });
  }

  console.log(`${LOG_PREFIX} pedido ${pedidoId}: destinatario resuelto (${recipient})`);

  const reciboData: ReciboData = {
    numero: pedido.numero,
    fecha: formatFecha(pedido.created_at),
    nombre: pedido.nombre,
    items: parseItems(pedido.items),
    subtotal: Number(pedido.subtotal) || 0,
    entrega: pedido.entrega === "envio" ? "envio" : "coordinar",
  };

  const { subject, html } = renderRecibo(reciboData, {
    brandName,
    brandLogoUrl,
    storeUrl,
    whatsappUrl,
  });

  // Paso A: refrescar el access token de Gmail.
  const accessToken = await refreshAccessToken(gmailClientId, gmailClientSecret, gmailRefreshToken);
  if (!accessToken) {
    console.error(`${LOG_PREFIX} no se pudo obtener access token de Gmail para pedido ${pedidoId}`);
    return jsonResponse({ ok: false, error: "gmail_oauth_refresh_failed" }, 502);
  }

  // Paso B: armar el mensaje RFC 2822 crudo.
  const mimeMessage = buildMimeMessage({
    from: gmailSender,
    to: recipient,
    subject,
    html,
  });

  // Paso C: base64url-encodear el mensaje y mandarlo vía Gmail API.
  const raw = toBase64Url(mimeMessage);

  try {
    const gmailResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ raw }),
      },
    );

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text();
      console.error(
        `${LOG_PREFIX} Gmail API respondió ${gmailResponse.status} para pedido ${pedidoId}:`,
        errorText,
      );
      return jsonResponse({ ok: false, error: "gmail_send_failed" }, 502);
    }

    console.log(`${LOG_PREFIX} enviado OK — pedido ${pedidoId} → ${recipient}`);
    return jsonResponse({ ok: true, sent: true });
  } catch (err) {
    console.error(`${LOG_PREFIX} excepción llamando a Gmail API para pedido ${pedidoId}:`, err);
    return jsonResponse({ ok: false, error: "gmail_exception" }, 502);
  }
});
