// ============================================================================
// Pecora — Edge Function: avisos-tienda
//
// Una sola función para los avisos automáticos (ver la migración
// *_avisos_tienda.sql). La base la llama con invocar_avisos_tienda(body):
//
//   { tipo: "pedido_enviado", pedido_id }  trigger al pasar un pedido a "enviado"
//                                          (o al cargarle el seguimiento): mail a
//                                          la clienta con el seguimiento.
//   { tipo: "envios_pendientes" }          pg_cron, cada hora: los enviados hace
//                                          más de 2 h que esperaban el seguimiento.
//   { tipo: "stock_bajo" }                 pg_cron, cada hora: un mail a la dueña
//                                          con los productos que bajaron a ≤ 3.
//   { tipo: "carritos" }                   pg_cron, cada hora: recordatorio a las
//                                          clientas con carrito abandonado.
//   { tipo: "reporte_mensual", mes? }      pg_cron, día 1: resumen del mes pasado
//                                          a la dueña ("mes": "YYYY-MM" opcional
//                                          para pedir otro mes a mano).
//
// Cada envío se marca en la base (aviso_envio_enviado_at, aviso_stock_bajo_at,
// recordado_at) solo si salió bien, así no se repite ni se pierde.
//
// Auth: igual que las demás (Bearer = service_role, _shared/autorizacion.ts).
// Secretos: los de Gmail (GMAIL_SENDER + GMAIL_APP_PASSWORD), OWNER_EMAIL,
// BRAND_NAME, BRAND_LOGO_URL, PUBLIC_SITE_URL/STORE_URL, PUBLIC_ADMIN_URL,
// WHATSAPP_NUMBER (opcionales salvo Gmail y OWNER_EMAIL para los de la dueña).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  bearerToken,
  buildMimeMessage,
  enmascararEmail,
  esEmailSeguro,
  formatFromHeader,
  leerItemsCarrito,
  leerPedidoAviso,
  leerSeguimiento,
  lineasRecordatorio,
  mesAnterior,
  nombreMes,
  parseItems,
  parseOwnerEmails,
  primeraFoto,
  primerNombre,
  type ProductoCarrito,
  resolverPanelUrl,
  resolverSitio,
  toNumber,
  urlProducto,
  variacion,
} from "./logica.ts";
import {
  type Marca,
  renderPedidoEnviado,
  renderRecordatorioCarrito,
  renderReporteMensual,
  renderStockBajo,
} from "./template.ts";
import { esLlamadaInterna } from "../_shared/autorizacion.ts";
import { abrirCorreo, type Correo } from "../_shared/correo.ts";
import { leerConfigCorreo, MENSAJE_FALTAN_SECRETOS } from "../_shared/correoConfig.ts";

const LOG_PREFIX = "[avisos-tienda]";
const TIMEOUT_MS = 15_000;
const PRESUPUESTO_MS = 100_000;

const TRANSPORTISTAS: Record<string, string> = {
  andreani: "Andreani",
  correo_argentino: "Correo Argentino",
};

function crearClienteAdmin(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }),
    },
  });
}
type SupabaseAdmin = ReturnType<typeof crearClienteAdmin>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Contexto {
  supabase: SupabaseAdmin;
  marca: Marca;
  panelUrl: string | null;
  whatsappUrl: string | null;
  owners: string[];
  /** Abre Gmail una sola vez, recién cuando hay algo para mandar. */
  correo: () => Promise<Correo | null>;
}

async function enviar(ctx: Contexto, to: string | string[], subject: string, html: string): Promise<boolean> {
  const correo = await ctx.correo();
  if (!correo) return false;
  const destinatarios = Array.isArray(to) ? to : [to];
  const mime = buildMimeMessage({
    from: formatFromHeader(ctx.marca.brandName, correo.remitente),
    to: destinatarios.join(", "),
    subject,
    html,
  });
  const r = await correo.enviar(destinatarios, mime);
  if (!r.ok) console.error(`${LOG_PREFIX} envío fallido (${subject}): ${r.error}`);
  return r.ok;
}

// ---- 1) Pedido enviado ------------------------------------------------------------

async function avisarPedidoEnviado(ctx: Contexto, pedidoId: string): Promise<Response> {
  const { data: pedido, error } = await ctx.supabase
    .from("pedidos")
    .select("id, numero, nombre, email, user_id, estado, items, seguimiento, transportista, aviso_envio_enviado_at, eliminado_at")
    .eq("id", pedidoId)
    .maybeSingle();
  if (error) {
    console.error(`${LOG_PREFIX} error leyendo el pedido ${pedidoId}: ${error.message}`);
    return json({ ok: false, error: "pedido_read_failed" }, 500);
  }
  if (!pedido) return json({ ok: false, error: "pedido_not_found" }, 404);
  if (pedido.aviso_envio_enviado_at) return json({ ok: true, skipped: "already_sent" });
  if (pedido.estado !== "enviado" || pedido.eliminado_at) return json({ ok: true, skipped: "not_shipped" });

  let email = (pedido.email ?? "").trim();
  if (!email && pedido.user_id) {
    const { data } = await ctx.supabase.auth.admin.getUserById(pedido.user_id);
    email = data.user?.email?.trim() ?? "";
  }
  if (!email || !esEmailSeguro(email)) {
    console.log(`${LOG_PREFIX} pedido #${pedido.numero}: sin email válido — no se avisa el envío`);
    return json({ ok: true, skipped: "no_recipient" });
  }

  const seg = leerSeguimiento(pedido.seguimiento);
  const { subject, html } = renderPedidoEnviado(
    {
      nombre: primerNombre(pedido.nombre),
      items: parseItems(pedido.items).map((i) => ({ nombre: i.nombre, cantidad: i.cantidad })),
      seguimientoCodigo: seg.codigo,
      seguimientoUrl: seg.url,
      transportista: pedido.transportista ? TRANSPORTISTAS[pedido.transportista] ?? null : null,
      misPedidosUrl: pedido.user_id ? `${ctx.marca.sitioUrl}/mis-pedidos` : null,
      whatsappUrl: ctx.whatsappUrl,
    },
    ctx.marca,
  );
  if (!(await enviar(ctx, email, subject, html))) return json({ ok: false, error: "send_failed" }, 502);

  const { error: marcaError } = await ctx.supabase
    .from("pedidos")
    .update({ aviso_envio_enviado_at: new Date().toISOString() })
    .eq("id", pedido.id);
  if (marcaError) console.error(`${LOG_PREFIX} pedido #${pedido.numero}: el mail salió pero no se pudo marcar: ${marcaError.message}`);
  console.log(`${LOG_PREFIX} aviso de envío del pedido #${pedido.numero} → ${enmascararEmail(email)}`);
  return json({ ok: true, enviado: true });
}

async function avisarEnviosPendientes(ctx: Contexto, inicio: number): Promise<Response> {
  const { data, error } = await ctx.supabase.rpc("pedidos_envio_sin_aviso");
  if (error) {
    console.error(`${LOG_PREFIX} error leyendo envíos sin aviso: ${error.message}`);
    return json({ ok: false, error: "read_failed" }, 500);
  }
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  let fallidos = 0;
  for (const id of ids) {
    if (Date.now() - inicio > PRESUPUESTO_MS) break;
    const r = await avisarPedidoEnviado(ctx, id);
    if (!r.ok) fallidos++;
  }
  return json({ ok: fallidos === 0, pedidos: ids.length, fallidos }, fallidos ? 502 : 200);
}

// ---- 2) Stock bajo ------------------------------------------------------------------

async function avisarStockBajo(ctx: Contexto): Promise<Response> {
  const { data, error } = await ctx.supabase.rpc("productos_stock_bajo_pendientes");
  if (error) {
    console.error(`${LOG_PREFIX} error leyendo stock bajo: ${error.message}`);
    return json({ ok: false, error: "read_failed" }, 500);
  }
  const productos = (data ?? []) as { id: string; nombre: string; stock: number; slug: string | null }[];
  if (productos.length === 0) return json({ ok: true, skipped: "sin_pendientes" });
  if (ctx.owners.length === 0) {
    console.warn(`${LOG_PREFIX} hay ${productos.length} productos con stock bajo pero falta OWNER_EMAIL`);
    return json({ ok: true, skipped: "owner_email_unset" });
  }

  const { subject, html } = renderStockBajo(
    productos.map((p) => ({ nombre: p.nombre, stock: p.stock, url: urlProducto(ctx.marca.sitioUrl, p) })),
    ctx.panelUrl,
    ctx.marca,
  );
  if (!(await enviar(ctx, ctx.owners, subject, html))) return json({ ok: false, error: "send_failed" }, 502);

  const { error: marcaError } = await ctx.supabase
    .from("productos")
    .update({ aviso_stock_bajo_at: new Date().toISOString() })
    .in("id", productos.map((p) => p.id));
  if (marcaError) console.error(`${LOG_PREFIX} stock bajo avisado pero no se pudo marcar: ${marcaError.message}`);
  console.log(`${LOG_PREFIX} aviso de stock bajo: ${productos.length} productos`);
  return json({ ok: true, productos: productos.length });
}

// ---- 3) Carritos abandonados ------------------------------------------------------

interface CarritoPendiente {
  user_id: string;
  email: string;
  nombre: string | null;
  items: unknown;
}

async function recordarCarritos(ctx: Contexto, inicio: number): Promise<Response> {
  const { data, error } = await ctx.supabase.rpc("carritos_para_recordar", { p_horas: 20, p_limite: 50 });
  if (error) {
    console.error(`${LOG_PREFIX} error leyendo carritos: ${error.message}`);
    return json({ ok: false, error: "read_failed" }, 500);
  }
  const carritos = (data ?? []) as CarritoPendiente[];
  if (carritos.length === 0) return json({ ok: true, skipped: "sin_pendientes" });

  const ids = [...new Set(carritos.flatMap((c) => leerItemsCarrito(c.items).map((i) => i.id)))];
  const { data: prods, error: prodError } = ids.length
    ? await ctx.supabase.from("productos").select("id, nombre, slug, precio, stock, imagenes, imagen_url").in("id", ids)
    : { data: [], error: null };
  if (prodError) {
    console.error(`${LOG_PREFIX} error leyendo productos de los carritos: ${prodError.message}`);
    return json({ ok: false, error: "read_failed" }, 500);
  }

  const marcar = async (userId: string) => {
    const { error: e } = await ctx.supabase
      .from("carritos")
      .update({ recordado_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (e) console.error(`${LOG_PREFIX} no se pudo marcar el carrito de ${userId}: ${e.message}`);
  };

  let enviados = 0;
  let omitidos = 0;
  let fallidos = 0;
  for (const c of carritos) {
    if (Date.now() - inicio > PRESUPUESTO_MS) break;
    const lineas = lineasRecordatorio(
      leerItemsCarrito(c.items),
      (prods ?? []) as ProductoCarrito[],
      (p) => urlProducto(ctx.marca.sitioUrl, p),
      (p) => primeraFoto(p),
    );
    // Nada para comprar (agotado o borrado) o email raro: no se manda y no
    // se vuelve a intentar con este carrito.
    if (lineas.length === 0 || !esEmailSeguro(c.email ?? "")) {
      omitidos++;
      await marcar(c.user_id);
      continue;
    }
    const { subject, html } = renderRecordatorioCarrito(
      {
        nombre: primerNombre(c.nombre),
        lineas,
        carritoUrl: `${ctx.marca.sitioUrl}/carrito`,
        preferenciasUrl: `${ctx.marca.sitioUrl}/mi-cuenta`,
      },
      ctx.marca,
    );
    if (await enviar(ctx, c.email, subject, html)) {
      enviados++;
      await marcar(c.user_id);
    } else {
      fallidos++;
      if (fallidos >= 3) break;
    }
  }
  console.log(`${LOG_PREFIX} carritos: ${JSON.stringify({ enviados, omitidos, fallidos })}`);
  return json({ ok: fallidos === 0, enviados, omitidos, fallidos }, fallidos ? 502 : 200);
}

// ---- 4) Reporte mensual --------------------------------------------------------

async function mandarReporte(ctx: Contexto, mes: string | null): Promise<Response> {
  if (ctx.owners.length === 0) return json({ ok: true, skipped: "owner_email_unset" });
  const dia = mes ? `${mes}-01` : mesAnterior(new Date());
  const { data, error } = await ctx.supabase.rpc("reporte_mensual_datos", { p_mes: dia });
  if (error || !data) {
    console.error(`${LOG_PREFIX} error armando el reporte: ${error?.message}`);
    return json({ ok: false, error: "read_failed" }, 500);
  }
  const r = data as Record<string, unknown>;
  const total = toNumber(r.total);
  const totalAnterior = toNumber(r.total_mes_anterior);
  const mas = Array.isArray(r.mas_vendidos) ? r.mas_vendidos : [];
  const { subject, html } = renderReporteMensual(
    {
      mesNombre: nombreMes(String(r.mes ?? dia)),
      pedidos: toNumber(r.pedidos),
      total,
      pedidosAnterior: toNumber(r.pedidos_mes_anterior),
      totalAnterior,
      variacionTotal: variacion(total, totalAnterior),
      cancelados: toNumber(r.cancelados),
      gastos: toNumber(r.gastos),
      clientasNuevas: toNumber(r.clientas_nuevas),
      masVendidos: mas.map((m: Record<string, unknown>) => ({
        nombre: String(m.nombre ?? ""),
        unidades: toNumber(m.unidades),
        importe: toNumber(m.importe),
      })),
      sinStock: toNumber(r.sin_stock),
      pendientes: toNumber(r.pendientes),
    },
    ctx.panelUrl,
    ctx.marca,
  );
  if (!(await enviar(ctx, ctx.owners, subject, html))) return json({ ok: false, error: "send_failed" }, 502);
  console.log(`${LOG_PREFIX} reporte mensual de ${r.mes} enviado`);
  return json({ ok: true, enviado: true });
}

// ---- Entrada -----------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const inicio = Date.now();
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return json({ ok: false, error: "missing_supabase_env" }, 500);

  const token = bearerToken(req);
  const autorizacion = token
    ? await esLlamadaInterna(token, Deno.env.get)
    : { ok: false as const, motivo: "falta el header Authorization: Bearer" };
  if (!autorizacion.ok) {
    console.error(`${LOG_PREFIX} request rechazada (401): ${autorizacion.motivo}`);
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }
  const aviso = leerPedidoAviso(body);
  if (!aviso) return json({ ok: false, error: "tipo_desconocido" }, 400);

  if (!leerConfigCorreo(Deno.env.get)) {
    console.error(`${LOG_PREFIX} ${MENSAJE_FALTAN_SECRETOS} — no se manda el aviso ${aviso.tipo}`);
    return json({ ok: true, skipped: "missing_email_secrets" });
  }

  const sitio = resolverSitio(Deno.env.get("PUBLIC_SITE_URL"), Deno.env.get("STORE_URL"));
  const adminUrl = resolverPanelUrl(Deno.env.get("PUBLIC_ADMIN_URL"), Deno.env.get("ADMIN_ORIGIN"));
  const whatsapp = Deno.env.get("WHATSAPP_NUMBER")?.replace(/\D/g, "") || null;

  let abierto: Correo | null | undefined;
  const ctx: Contexto = {
    supabase: crearClienteAdmin(supabaseUrl, token!),
    marca: {
      brandName: Deno.env.get("BRAND_NAME") ?? "Pecora",
      brandLogoUrl: Deno.env.get("BRAND_LOGO_URL") || null,
      sitioUrl: sitio,
    },
    panelUrl: adminUrl,
    whatsappUrl: whatsapp ? `https://wa.me/${whatsapp}` : null,
    owners: parseOwnerEmails(Deno.env.get("OWNER_EMAIL")).validos,
    correo: async () => {
      if (abierto !== undefined) return abierto;
      const apertura = await abrirCorreo(Deno.env.get);
      if (!apertura.ok) console.error(`${LOG_PREFIX} ACCIÓN REQUERIDA: ${apertura.detalle}`);
      abierto = apertura.ok ? apertura.correo : null;
      return abierto;
    },
  };

  try {
    switch (aviso.tipo) {
      case "pedido_enviado":
        return await avisarPedidoEnviado(ctx, aviso.pedidoId);
      case "envios_pendientes":
        return await avisarEnviosPendientes(ctx, inicio);
      case "stock_bajo":
        return await avisarStockBajo(ctx);
      case "carritos":
        return await recordarCarritos(ctx, inicio);
      case "reporte_mensual":
        return await mandarReporte(ctx, aviso.mes);
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} error inesperado en ${aviso.tipo}:`, e);
    return json({ ok: false, error: "unexpected" }, 500);
  } finally {
    abierto?.cerrar();
  }
});
