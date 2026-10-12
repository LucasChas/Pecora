// ============================================================================
// Pecora — Templates de los emails de pedido:
//   * renderRecibo:      comprobante para la clienta.
//   * renderAvisoDuena:  aviso de "nuevo pedido" para la dueña de la tienda.
//
// Plain TS template literal con HTML basado en tablas + estilos inline: es lo
// único que se renderiza de forma confiable en todos los clientes de correo
// (Gmail, Outlook, Apple Mail, etc.). Nada de un motor de templates ni de
// MJML: dos emails no justifican agregar un build step.
//
// Todo texto interpolado que viene de datos de usuario (nombre, teléfono,
// email, dirección, notas, nombres de producto) pasa por escapeHtml(): es un
// requisito de seguridad real (inyección de contenido en el email), no un
// detalle de estilo.
// ============================================================================

export interface ReciboItem {
  nombre: string;
  precio: number;
  cantidad: number;
}

export type Entrega = "envio" | "coordinar";

export interface TotalesPedido {
  subtotal: number;
  descuento: number;
  costoEnvio: number;
  total: number;
}

export interface ReciboData {
  numero: number;
  fecha: string; // ya formateada, ej: "06/08/2026"
  /** Solo el primer nombre (ver primerNombre en logica.ts); null = saludo sin nombre. */
  nombre: string | null;
  items: ReciboItem[];
  totales: TotalesPedido;
  entrega: Entrega;
}

export interface ReciboBranding {
  brandName: string;
  brandLogoUrl: string | null;
  storeUrl: string;
  whatsappUrl: string | null;
}

export interface AvisoDuenaData {
  numero: number;
  fecha: string; // ya formateada, con hora
  cliente: {
    nombre: string;
    telefono: string;
    email: string | null;
  };
  entrega: Entrega;
  direccion: string | null;
  localidad: string | null;
  cp: string | null;
  provincia: string | null;
  notas: string | null;
  items: ReciboItem[];
  totales: TotalesPedido;
  /** Link wa.me al teléfono de la clienta (null si no hay dígitos usables). */
  whatsappClienteUrl: string | null;
  /** Link al panel de pedidos (null si no hay STORE_URL). */
  panelUrl: string | null;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapa y conserva los saltos de línea (notas de la clienta). */
function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

function numeroSeguro(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatNumber(value: number): string {
  return numeroSeguro(value).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(value: number): string {
  return `$${formatNumber(value)}`;
}

function renderItemRow(item: ReciboItem): string {
  const nombre = escapeHtml(item.nombre);
  const cantidad = numeroSeguro(item.cantidad);
  const precio = numeroSeguro(item.precio);
  const lineTotal = precio * cantidad;
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;">${nombre}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:center;">${cantidad}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:right;">${formatMoney(precio)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:right;">${formatMoney(lineTotal)}</td>
    </tr>`;
}

function renderItemsTable(items: ReciboItem[]): string {
  return `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <thead>
                    <tr>
                      <th align="left" style="padding:8px 0;border-bottom:2px solid #222;font-size:12px;color:#888;text-transform:uppercase;">Producto</th>
                      <th align="center" style="padding:8px 0;border-bottom:2px solid #222;font-size:12px;color:#888;text-transform:uppercase;">Cant.</th>
                      <th align="right" style="padding:8px 0;border-bottom:2px solid #222;font-size:12px;color:#888;text-transform:uppercase;">Precio</th>
                      <th align="right" style="padding:8px 0;border-bottom:2px solid #222;font-size:12px;color:#888;text-transform:uppercase;">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map(renderItemRow).join("")}
                  </tbody>
                </table>`;
}

function renderTotalRow(label: string, value: string, destacado = false): string {
  const estilo = destacado
    ? "padding:12px 0 0;font-size:15px;color:#222;font-weight:bold;text-align:right;"
    : "padding:4px 0 0;font-size:14px;color:#555;text-align:right;";
  return `
                  <tr>
                    <td style="${estilo}">${label}: ${value}</td>
                  </tr>`;
}

/**
 * Bloque de totales. Descuento y envío solo aparecen si son > 0; si la entrega
 * es a domicilio y todavía no hay costo cargado, se aclara "a coordinar".
 * El subtotal se muestra cuando hay alguna línea que lo modifique (o siempre,
 * si se pide), para que la cuenta se entienda.
 */
function renderTotales(
  totales: TotalesPedido,
  entrega: Entrega,
  opciones: { siempreSubtotal?: boolean } = {},
): string {
  const descuento = numeroSeguro(totales.descuento);
  const costoEnvio = numeroSeguro(totales.costoEnvio);
  const filas: string[] = [];

  if (opciones.siempreSubtotal || descuento > 0 || costoEnvio > 0) {
    filas.push(renderTotalRow("Subtotal", formatMoney(totales.subtotal)));
  }
  if (descuento > 0) {
    filas.push(renderTotalRow("Descuento", `-${formatMoney(descuento)}`));
  }
  if (costoEnvio > 0) {
    filas.push(renderTotalRow("Envío", formatMoney(costoEnvio)));
  } else if (entrega === "envio") {
    filas.push(renderTotalRow("Envío", "a coordinar"));
  }
  filas.push(renderTotalRow("Total", formatMoney(totales.total), true));

  return `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                  ${filas.join("")}
                </table>`;
}

const ENTREGA_LABEL: Record<Entrega, string> = {
  envio: "Envío a domicilio",
  coordinar: "Retiro / a coordinar",
};

function renderLayout(params: {
  title: string;
  header: string;
  body: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${params.title}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f6f6f4;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f6f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 16px;text-align:center;">
                ${params.header}
              </td>
            </tr>
            ${params.body}
            <tr>
              <td style="padding:16px 32px 32px;text-align:center;border-top:1px solid #eee;">
                ${params.footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderBoton(href: string, texto: string, color: string): string {
  return `
            <tr>
              <td style="padding:0 32px 24px;text-align:center;">
                <a href="${escapeHtml(href)}"
                   style="display:inline-block;background-color:${color};color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:11px 22px;border-radius:100px;">
                  ${texto}
                </a>
              </td>
            </tr>`;
}

// ----------------------------------------------------------------------------
// Recibo para la clienta.
// ----------------------------------------------------------------------------
export function renderRecibo(
  data: ReciboData,
  branding: ReciboBranding,
): { subject: string; html: string } {
  const saludo = data.nombre
    ? `¡Gracias por tu compra, ${escapeHtml(data.nombre)}!`
    : "¡Gracias por tu compra!";
  const brandName = escapeHtml(branding.brandName);
  const entregaLabel = ENTREGA_LABEL[data.entrega] ?? escapeHtml(data.entrega);

  // El número de pedido es un dato interno del admin (lo usa para ubicarlo
  // en el panel) — a la clienta no le aporta nada, así que ni el asunto ni
  // el cuerpo del mail lo muestran; alcanza con la fecha para identificarlo.
  // TODO(owner-copy): revisar texto del email — asunto y cuerpo son
  // placeholders neutrales, el copy final lo define la dueña de la tienda.
  const subject = `Confirmación de tu pedido — ${branding.brandName}`;

  const logoBlock = branding.brandLogoUrl
    ? `<img src="${escapeHtml(branding.brandLogoUrl)}" alt="${brandName}" style="max-height:48px;display:block;margin:0 auto 12px;" />`
    : "";

  // Opcional: si no hay WHATSAPP_NUMBER configurado del lado de la función,
  // el mail sale igual, solo sin este bloque (nunca debe romper el envío).
  const whatsappBlock = branding.whatsappUrl
    ? renderBoton(branding.whatsappUrl, "Escribinos por WhatsApp", "#25D366")
    : "";

  const html = renderLayout({
    title: escapeHtml(subject),
    header: `
                ${logoBlock}
                <h1 style="margin:0;font-size:20px;color:#222;">${saludo}</h1>
                <p style="margin:8px 0 0;font-size:14px;color:#666;">
                  <!-- TODO(owner-copy): revisar texto del email -->
                  Te confirmamos que recibimos tu pedido del ${escapeHtml(data.fecha)}.
                </p>`,
    body: `
            <tr>
              <td style="padding:0 32px;">
                ${renderItemsTable(data.items)}
                ${renderTotales(data.totales, data.entrega)}
                <p style="font-size:13px;color:#666;margin:8px 0 24px;">
                  Modalidad de entrega: <strong>${entregaLabel}</strong>.
                </p>
              </td>
            </tr>
            ${whatsappBlock}`,
    footer: `
                <p style="font-size:12px;color:#999;margin:0;">
                  Si no hiciste este pedido, podés ignorar este mail.
                </p>
                <p style="font-size:12px;color:#999;margin:16px 0 0;">
                  ${brandName} · <a href="${escapeHtml(branding.storeUrl)}" style="color:#999;">${escapeHtml(branding.storeUrl)}</a>
                </p>
                <p style="font-size:11px;color:#bbb;margin:8px 0 0;">
                  © ${new Date().getFullYear()} ${brandName}. Todos los derechos reservados.
                </p>`,
  });

  return { subject, html };
}

// ----------------------------------------------------------------------------
// Aviso de pedido nuevo para la dueña.
// ----------------------------------------------------------------------------
function renderDato(label: string, value: string | null | undefined): string {
  const limpio = value?.trim();
  if (!limpio) return "";
  return `
                  <tr>
                    <td style="padding:4px 12px 4px 0;font-size:13px;color:#888;vertical-align:top;white-space:nowrap;">${label}</td>
                    <td style="padding:4px 0;font-size:14px;color:#222;">${escapeMultiline(limpio)}</td>
                  </tr>`;
}

function renderSeccion(titulo: string, filas: string): string {
  if (!filas.trim()) return "";
  return `
                <h2 style="margin:20px 0 6px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">${titulo}</h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${filas}
                </table>`;
}

export function renderAvisoDuena(
  data: AvisoDuenaData,
  branding: ReciboBranding,
): { subject: string; html: string } {
  const brandName = escapeHtml(branding.brandName);

  // Sin datos de la clienta en el asunto: solo número y total.
  const subject = `Nuevo pedido #${data.numero} · $ ${formatNumber(data.totales.total)}`;

  const clienteFilas = [
    renderDato("Nombre", data.cliente.nombre),
    renderDato("Teléfono", data.cliente.telefono),
    renderDato("Email", data.cliente.email),
  ].join("");

  const entregaFilas = [
    renderDato("Modalidad", ENTREGA_LABEL[data.entrega] ?? data.entrega),
    renderDato("Dirección", data.direccion),
    renderDato("Localidad", data.localidad),
    renderDato("CP", data.cp),
    renderDato("Provincia", data.provincia),
  ].join("");

  const notasFilas = renderDato("Notas", data.notas);

  const botones = [
    data.whatsappClienteUrl
      ? renderBoton(data.whatsappClienteUrl, "Escribirle por WhatsApp", "#25D366")
      : "",
    data.panelUrl ? renderBoton(data.panelUrl, "Ver en el panel", "#222222") : "",
  ].join("");

  const html = renderLayout({
    title: escapeHtml(subject),
    header: `
                <h1 style="margin:0;font-size:20px;color:#222;">Nuevo pedido #${data.numero}</h1>
                <p style="margin:8px 0 0;font-size:14px;color:#666;">
                  ${escapeHtml(data.fecha)} · Total ${formatMoney(data.totales.total)}
                </p>`,
    body: `
            <tr>
              <td style="padding:0 32px 16px;">
                ${renderSeccion("Clienta", clienteFilas)}
                ${renderSeccion("Entrega", entregaFilas)}
                <h2 style="margin:20px 0 6px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Productos</h2>
                ${renderItemsTable(data.items)}
                ${renderTotales(data.totales, data.entrega, { siempreSubtotal: true })}
                ${renderSeccion("Notas de la clienta", notasFilas)}
              </td>
            </tr>
            ${botones}`,
    footer: `
                <p style="font-size:11px;color:#bbb;margin:16px 0 0;">
                  Aviso automático de ${brandName}. Los pedidos cargados a mano desde el panel no generan este aviso.
                </p>`,
  });

  return { subject, html };
}
