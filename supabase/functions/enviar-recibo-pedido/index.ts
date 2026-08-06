// ============================================================================
// Pecora — Edge Function: enviar-recibo-pedido
//
// Disparada por el trigger AFTER INSERT de la migración 0012 (pg_net,
// fire-and-forget). Recibe solo { pedido_id }, vuelve a leer el pedido del
// lado del servidor con un cliente service-role, resuelve el destinatario y
// manda el mail de confirmación vía Resend.
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
// Secretos usados (ver supabase/functions/README.md para setearlos):
//   RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, BRAND_NAME, BRAND_LOGO_URL,
//   STORE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (estas dos últimas las
//   inyecta Supabase automáticamente en toda Edge Function).
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
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM");
  const emailReplyTo = Deno.env.get("EMAIL_REPLY_TO") ?? undefined;
  const brandName = Deno.env.get("BRAND_NAME") ?? "Pecora";
  const brandLogoUrl = Deno.env.get("BRAND_LOGO_URL") || null;
  const storeUrl = Deno.env.get("STORE_URL") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`${LOG_PREFIX} faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY`);
    return jsonResponse({ ok: false, error: "missing_supabase_env" }, 500);
  }
  if (!resendApiKey || !emailFrom) {
    console.error(`${LOG_PREFIX} faltan RESEND_API_KEY/EMAIL_FROM — no se puede enviar`);
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
  });

  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [recipient],
        reply_to: emailReplyTo,
        subject,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error(
        `${LOG_PREFIX} Resend respondió ${resendResponse.status} para pedido ${pedidoId}:`,
        errorText,
      );
      return jsonResponse({ ok: false, error: "resend_failed" }, 502);
    }

    console.log(`${LOG_PREFIX} enviado OK — pedido ${pedidoId} → ${recipient}`);
    return jsonResponse({ ok: true, sent: true });
  } catch (err) {
    console.error(`${LOG_PREFIX} excepción llamando a Resend para pedido ${pedidoId}:`, err);
    return jsonResponse({ ok: false, error: "resend_exception" }, 502);
  }
});
