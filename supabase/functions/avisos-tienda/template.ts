// ============================================================================
// Pecora — Mails de avisos-tienda (HTML con tablas y estilos inline, como los
// demás mails de la tienda). Todo dato que viene de la base pasa por
// escapeHtml (nombres de productos y de clientas, seguimiento, links).
// ============================================================================

import type { LineaRecordatorio } from "./logica.ts";

export interface Marca {
  brandName: string;
  brandLogoUrl: string | null;
  sitioUrl: string;
}

const ROSA = "#b05a7a";

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plata(valor: number): string {
  const n = Number.isFinite(valor) ? valor : 0;
  return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function boton(href: string, texto: string, color = ROSA): string {
  return `
            <tr>
              <td style="padding:8px 32px 24px;text-align:center;">
                <a href="${escapeHtml(href)}"
                   style="display:inline-block;background-color:${color};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 26px;border-radius:100px;">
                  ${escapeHtml(texto)}
                </a>
              </td>
            </tr>`;
}

function layout(p: { titulo: string; encabezado: string; cuerpo: string; pie: string; marca: Marca }): string {
  const nombre = escapeHtml(p.marca.brandName);
  const logo = p.marca.brandLogoUrl
    ? `<img src="${escapeHtml(p.marca.brandLogoUrl)}" alt="${nombre}" style="max-height:48px;display:block;margin:0 auto 12px;" />`
    : `<p style="margin:0 0 12px;font-size:18px;font-weight:bold;color:${ROSA};letter-spacing:1px;">${nombre}</p>`;
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(p.titulo)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f7f3f0;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f3f0;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 12px;text-align:center;">
                ${logo}
                ${p.encabezado}
              </td>
            </tr>
            ${p.cuerpo}
            <tr>
              <td style="padding:16px 32px 28px;text-align:center;border-top:1px solid #f0e8e4;">
                ${p.pie}
                <p style="font-size:12px;color:#aaa;margin:10px 0 0;">
                  ${nombre} · <a href="${escapeHtml(p.marca.sitioUrl)}" style="color:#aaa;">${escapeHtml(p.marca.sitioUrl.replace(/^https?:\/\//, ""))}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function titulo(texto: string, sub?: string): string {
  return `
                <h1 style="margin:0;font-size:21px;color:#2b2b2b;">${texto}</h1>
                ${sub ? `<p style="margin:8px 0 0;font-size:14px;color:#666;line-height:1.5;">${sub}</p>` : ""}`;
}

function filaProducto(l: { nombre: string; detalle: string; foto?: string | null; url?: string | null }): string {
  const foto = l.foto
    ? `<img src="${escapeHtml(l.foto)}" alt="" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:8px;" />`
    : `<div style="width:56px;height:56px;border-radius:8px;background:#f3ece8;"></div>`;
  const nombre = l.url
    ? `<a href="${escapeHtml(l.url)}" style="color:#2b2b2b;text-decoration:none;font-weight:bold;">${escapeHtml(l.nombre)}</a>`
    : `<strong style="color:#2b2b2b;">${escapeHtml(l.nombre)}</strong>`;
  return `
                  <tr>
                    <td width="68" style="padding:8px 12px 8px 0;vertical-align:middle;">${foto}</td>
                    <td style="padding:8px 0;font-size:14px;vertical-align:middle;border-bottom:1px solid #f3ece8;">
                      ${nombre}<br />
                      <span style="color:#777;font-size:13px;">${l.detalle}</span>
                    </td>
                  </tr>`;
}

function tabla(filas: string): string {
  return `
            <tr>
              <td style="padding:8px 32px 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
              </td>
            </tr>`;
}

// ---- 1) Pedido enviado ------------------------------------------------------------

export function renderPedidoEnviado(
  d: {
    nombre: string;
    items: { nombre: string; cantidad: number }[];
    seguimientoCodigo: string | null;
    seguimientoUrl: string | null;
    transportista: string | null;
    misPedidosUrl: string | null;
    whatsappUrl: string | null;
  },
  marca: Marca,
): { subject: string; html: string } {
  const subject = `¡Tu pedido ya está en camino! — ${marca.brandName}`;
  const hola = d.nombre ? `¡Hola, ${escapeHtml(d.nombre)}!` : "¡Hola!";

  const filas = d.items
    .map((i) => filaProducto({ nombre: i.nombre, detalle: `${i.cantidad} ${i.cantidad === 1 ? "unidad" : "unidades"}` }))
    .join("");

  const transportista = d.transportista
    ? `<p style="margin:0 0 4px;font-size:13px;color:#777;">Lo lleva: <strong style="color:#2b2b2b;">${escapeHtml(d.transportista)}</strong></p>`
    : "";
  const seguimiento = d.seguimientoCodigo
    ? `
            <tr>
              <td style="padding:8px 32px 16px;text-align:center;">
                ${transportista}
                <p style="margin:0;font-size:13px;color:#777;">Código de seguimiento</p>
                <p style="margin:6px 0 0;font-size:20px;font-weight:bold;letter-spacing:1px;color:#2b2b2b;font-family:Menlo,Consolas,monospace;">${escapeHtml(d.seguimientoCodigo)}</p>
              </td>
            </tr>`
    : transportista
      ? `<tr><td style="padding:8px 32px 8px;text-align:center;">${transportista}</td></tr>`
      : "";

  const botones = [
    d.seguimientoUrl ? boton(d.seguimientoUrl, "Seguir mi envío") : "",
    d.misPedidosUrl ? boton(d.misPedidosUrl, "Ver mi pedido", d.seguimientoUrl ? "#7a7a7a" : ROSA) : "",
    !d.misPedidosUrl && d.whatsappUrl ? boton(d.whatsappUrl, "Escribinos por WhatsApp", "#25D366") : "",
  ].join("");

  const html = layout({
    titulo: subject,
    marca,
    encabezado: titulo(
      `${hola} Tu pedido salió 📦`,
      "Ya despachamos tu compra. En cuanto llegue, ¡esperamos que la disfruten!",
    ),
    cuerpo: tabla(filas) + seguimiento + botones,
    pie: `<p style="font-size:13px;color:#888;margin:0;">¿Alguna duda con la entrega? Respondé este mail o escribinos por WhatsApp.</p>`,
  });
  return { subject, html };
}

// ---- 2) Stock bajo (para la dueña) ------------------------------------------------

export function renderStockBajo(
  productos: { nombre: string; stock: number; url: string | null }[],
  panelUrl: string | null,
  marca: Marca,
): { subject: string; html: string } {
  const sinStock = productos.filter((p) => p.stock <= 0).length;
  const subject =
    productos.length === 1
      ? `Stock bajo: ${productos[0].nombre} (${Math.max(productos[0].stock, 0)})`
      : `Stock bajo en ${productos.length} productos${sinStock ? ` (${sinStock} agotados)` : ""}`;

  const filas = productos
    .map((p) =>
      filaProducto({
        nombre: p.nombre,
        detalle:
          p.stock <= 0
            ? `<strong style="color:#c0392b;">Agotado</strong>`
            : `Quedan <strong style="color:#d35400;">${p.stock}</strong>`,
        url: p.url,
      })
    )
    .join("");

  const html = layout({
    titulo: subject,
    marca,
    encabezado: titulo("Productos por reponer", "Estos productos quedaron con 3 unidades o menos."),
    cuerpo: tabla(filas) + (panelUrl ? boton(panelUrl, "Abrir el panel") : ""),
    pie: `<p style="font-size:12px;color:#999;margin:0;">Te avisamos una vez por producto: si lo reponés y vuelve a bajar, te llega de nuevo.</p>`,
  });
  return { subject, html };
}

// ---- 3) Carrito abandonado --------------------------------------------------------

export function renderRecordatorioCarrito(
  d: { nombre: string; lineas: LineaRecordatorio[]; carritoUrl: string; preferenciasUrl: string },
  marca: Marca,
): { subject: string; html: string } {
  const subject = d.nombre
    ? `${d.nombre}, te guardamos tu carrito 🧺`
    : `Te guardamos tu carrito 🧺 — ${marca.brandName}`;
  const total = d.lineas.reduce((n, l) => n + l.precio * l.cantidad, 0);

  const filas = d.lineas
    .map((l) =>
      filaProducto({
        nombre: l.nombre,
        detalle: `${l.cantidad} × ${plata(l.precio)}`,
        foto: l.foto,
        url: l.url,
      })
    )
    .join("");

  const html = layout({
    titulo: subject,
    marca,
    encabezado: titulo(
      d.nombre ? `¡Hola, ${escapeHtml(d.nombre)}!` : "¡Hola!",
      "Dejaste estos productos en tu carrito. Los tenemos guardados para que termines tu compra cuando quieras.",
    ),
    cuerpo:
      tabla(filas) +
      `
            <tr>
              <td style="padding:4px 32px 8px;text-align:right;font-size:15px;color:#2b2b2b;">
                Total: <strong>${plata(total)}</strong>
              </td>
            </tr>` +
      boton(d.carritoUrl, "Terminar mi compra"),
    pie: `<p style="font-size:12px;color:#999;margin:0;">El stock es limitado y puede cambiar. ¿No querés estos recordatorios? Apagalos en <a href="${escapeHtml(d.preferenciasUrl)}" style="color:#999;">Mi cuenta → Preferencias</a>.</p>`,
  });
  return { subject, html };
}

// ---- 4) Reporte mensual (para la dueña) -------------------------------------------

export interface DatosReporte {
  mesNombre: string;
  pedidos: number;
  total: number;
  pedidosAnterior: number;
  totalAnterior: number;
  variacionTotal: number | null;
  cancelados: number;
  gastos: number;
  clientasNuevas: number;
  masVendidos: { nombre: string; unidades: number; importe: number }[];
  sinStock: number;
  pendientes: number;
}

function tarjeta(etiqueta: string, valor: string, nota = ""): string {
  return `
                    <td width="50%" style="padding:6px;">
                      <div style="background:#faf6f3;border-radius:10px;padding:14px;text-align:center;">
                        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;">${etiqueta}</div>
                        <div style="font-size:22px;font-weight:bold;color:#2b2b2b;margin-top:4px;">${valor}</div>
                        ${nota ? `<div style="font-size:12px;color:#888;margin-top:2px;">${nota}</div>` : ""}
                      </div>
                    </td>`;
}

export function renderReporteMensual(
  d: DatosReporte,
  panelUrl: string | null,
  marca: Marca,
): { subject: string; html: string } {
  const subject = `Resumen de ${d.mesNombre}: ${plata(d.total)} en ${d.pedidos} ${d.pedidos === 1 ? "pedido" : "pedidos"}`;
  const ticket = d.pedidos > 0 ? d.total / d.pedidos : 0;
  const varTxt =
    d.variacionTotal === null
      ? "sin datos del mes anterior"
      : `${d.variacionTotal >= 0 ? "▲" : "▼"} ${Math.abs(d.variacionTotal)}% vs. mes anterior`;
  const resultado = d.total - d.gastos;

  const tarjetas = `
            <tr>
              <td style="padding:8px 26px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>${tarjeta("Ventas", plata(d.total), varTxt)}${tarjeta("Pedidos", String(d.pedidos), `antes: ${d.pedidosAnterior}`)}</tr>
                  <tr>${tarjeta("Ticket promedio", plata(ticket))}${tarjeta("Clientas nuevas", String(d.clientasNuevas))}</tr>
                  <tr>${tarjeta("Gastos cargados", plata(d.gastos))}${tarjeta("Ventas − gastos", plata(resultado))}</tr>
                </table>
              </td>
            </tr>`;

  const top = d.masVendidos.length
    ? `
            <tr>
              <td style="padding:12px 32px 4px;">
                <h2 style="margin:0 0 6px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Más vendidos</h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${d.masVendidos
                    .map(
                      (p, i) => `
                  <tr>
                    <td style="padding:6px 0;font-size:14px;color:#2b2b2b;border-bottom:1px solid #f3ece8;">${i + 1}. ${escapeHtml(p.nombre)}</td>
                    <td style="padding:6px 0;font-size:13px;color:#777;text-align:right;border-bottom:1px solid #f3ece8;white-space:nowrap;">${p.unidades} u · ${plata(p.importe)}</td>
                  </tr>`,
                    )
                    .join("")}
                </table>
              </td>
            </tr>`
    : "";

  const alertas = [
    d.pendientes > 0 ? `${d.pendientes} ${d.pendientes === 1 ? "pedido pendiente" : "pedidos pendientes"} de entregar` : "",
    d.sinStock > 0 ? `${d.sinStock} ${d.sinStock === 1 ? "producto agotado" : "productos agotados"}` : "",
    d.cancelados > 0 ? `${d.cancelados} ${d.cancelados === 1 ? "pedido cancelado" : "pedidos cancelados"} en el mes` : "",
  ].filter(Boolean);
  const bloqueAlertas = alertas.length
    ? `
            <tr>
              <td style="padding:12px 32px 4px;">
                <h2 style="margin:0 0 6px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Para tener en cuenta</h2>
                <ul style="margin:0;padding-left:18px;font-size:14px;color:#2b2b2b;line-height:1.7;">
                  ${alertas.map((a) => `<li>${a}</li>`).join("")}
                </ul>
              </td>
            </tr>`
    : "";

  const html = layout({
    titulo: subject,
    marca,
    encabezado: titulo(`Resumen de ${escapeHtml(d.mesNombre)}`, "Así le fue a la tienda el mes pasado."),
    cuerpo: tarjetas + top + bloqueAlertas + (panelUrl ? boton(panelUrl, "Ver estadísticas en el panel") : ""),
    pie: `<p style="font-size:12px;color:#999;margin:0;">Ventas = pedidos no cancelados. Los gastos son los que cargaste en el panel.</p>`,
  });
  return { subject, html };
}
