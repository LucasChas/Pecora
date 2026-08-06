// ============================================================================
// Pecora — Template del email de confirmación de pedido.
//
// Plain TS template literal con HTML basado en tablas + estilos inline: es lo
// único que se renderiza de forma confiable en todos los clientes de correo
// (Gmail, Outlook, Apple Mail, etc.). Nada de un motor de templates ni de
// MJML: un solo email no justifica agregar un build step.
//
// Todo texto interpolado que viene de datos de usuario (nombre de la clienta,
// nombres de producto) pasa por escapeHtml(): es un requisito de seguridad
// real (inyección de contenido en el email), no un detalle de estilo.
// ============================================================================

export interface ReciboItem {
  nombre: string;
  precio: number;
  cantidad: number;
}

export interface ReciboData {
  numero: number;
  fecha: string; // ya formateada, ej: "06/08/2026"
  nombre: string;
  items: ReciboItem[];
  subtotal: number;
  entrega: "envio" | "coordinar";
}

export interface ReciboBranding {
  brandName: string;
  brandLogoUrl: string | null;
  storeUrl: string;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderItemRow(item: ReciboItem): string {
  const nombre = escapeHtml(item.nombre);
  const cantidad = Number.isFinite(item.cantidad) ? item.cantidad : 0;
  const precio = Number.isFinite(item.precio) ? item.precio : 0;
  const lineTotal = precio * cantidad;
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;">${nombre}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:center;">${cantidad}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:right;">${formatMoney(precio)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:right;">${formatMoney(lineTotal)}</td>
    </tr>`;
}

const ENTREGA_LABEL: Record<ReciboData["entrega"], string> = {
  envio: "Envío a domicilio",
  coordinar: "Retiro / a coordinar",
};

export function renderRecibo(
  data: ReciboData,
  branding: ReciboBranding,
): { subject: string; html: string } {
  const nombre = escapeHtml(data.nombre);
  const brandName = escapeHtml(branding.brandName);
  const entregaLabel = ENTREGA_LABEL[data.entrega] ?? escapeHtml(data.entrega);

  // TODO(owner-copy): revisar texto del email — asunto y cuerpo son
  // placeholders neutrales, el copy final lo define la dueña de la tienda.
  const subject = `Confirmación de tu pedido #${data.numero} — ${brandName}`;

  const logoBlock = branding.brandLogoUrl
    ? `<img src="${escapeHtml(branding.brandLogoUrl)}" alt="${brandName}" style="max-height:48px;display:block;margin:0 auto 12px;" />`
    : "";

  const itemsRows = data.items.map(renderItemRow).join("");

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f6f6f4;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f6f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 16px;text-align:center;">
                ${logoBlock}
                <h1 style="margin:0;font-size:20px;color:#222;">¡Gracias por tu compra, ${nombre}!</h1>
                <p style="margin:8px 0 0;font-size:14px;color:#666;">
                  <!-- TODO(owner-copy): revisar texto del email -->
                  Te confirmamos que recibimos tu pedido #${data.numero} del ${escapeHtml(data.fecha)}.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
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
                    ${itemsRows}
                  </tbody>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                  <tr>
                    <td style="padding:12px 0;font-size:15px;color:#222;font-weight:bold;text-align:right;">
                      Total: ${formatMoney(data.subtotal)}
                    </td>
                  </tr>
                </table>
                <p style="font-size:13px;color:#666;margin:8px 0 24px;">
                  Modalidad de entrega: <strong>${entregaLabel}</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px;text-align:center;border-top:1px solid #eee;">
                <p style="font-size:12px;color:#999;margin:16px 0 0;">
                  ${brandName} · <a href="${escapeHtml(branding.storeUrl)}" style="color:#999;">${escapeHtml(branding.storeUrl)}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html };
}
