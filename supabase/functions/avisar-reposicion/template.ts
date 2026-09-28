// ============================================================================
// Pecora — Template del mail "¡Volvió <producto>!" (avisar-reposicion).
//
// Mismo enfoque que enviar-recibo-pedido/template.ts: HTML con tablas y
// estilos inline (lo único confiable en todos los clientes de correo). Todo
// texto o URL interpolado pasa por escapeHtml().
// ============================================================================

export interface AvisoReposicionData {
  nombreProducto: string;
  precio: number;
  fotoUrl: string | null;
  urlProducto: string;
  urlBaja: string;
}

export interface AvisoBranding {
  brandName: string;
  brandLogoUrl: string | null;
  sitioUrl: string;
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatPrecio(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Asunto del mail. Sin saltos de línea (el nombre lo carga la admin). */
export function asuntoAviso(nombreProducto: string): string {
  const nombre = nombreProducto.replace(/\s+/g, " ").trim() || "el producto que esperabas";
  return `¡Volvió ${nombre}!`;
}

export function renderAvisoReposicion(
  data: AvisoReposicionData,
  branding: AvisoBranding,
): { subject: string; html: string } {
  const subject = asuntoAviso(data.nombreProducto);
  const nombre = escapeHtml(data.nombreProducto.trim());
  const brandName = escapeHtml(branding.brandName);

  const logoBlock = branding.brandLogoUrl
    ? `<img src="${escapeHtml(branding.brandLogoUrl)}" alt="${brandName}" style="max-height:48px;display:block;margin:0 auto 12px;" />`
    : "";

  const fotoBlock = data.fotoUrl
    ? `
            <tr>
              <td style="padding:0 32px 16px;text-align:center;">
                <a href="${escapeHtml(data.urlProducto)}">
                  <img src="${escapeHtml(data.fotoUrl)}" alt="${nombre}" width="280" style="width:100%;max-width:280px;height:auto;border-radius:8px;display:block;margin:0 auto;" />
                </a>
              </td>
            </tr>`
    : "";

  // TODO(owner-copy): revisar texto del email.
  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f6f6f4;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f6f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 16px;text-align:center;">
                ${logoBlock}
                <h1 style="margin:0;font-size:20px;color:#222;">¡Volvió ${nombre}!</h1>
                <p style="margin:8px 0 0;font-size:14px;color:#666;">
                  Nos pediste que te avisáramos cuando volviera a haber stock. Ya está disponible.
                </p>
              </td>
            </tr>
            ${fotoBlock}
            <tr>
              <td style="padding:0 32px 8px;text-align:center;font-size:18px;font-weight:bold;color:#222;">
                ${formatPrecio(data.precio)}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px;text-align:center;">
                <a href="${escapeHtml(data.urlProducto)}"
                   style="display:inline-block;background-color:#222222;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:100px;">
                  Ver producto
                </a>
                <p style="margin:12px 0 0;font-size:12px;color:#888;">
                  Las unidades son limitadas: el stock puede agotarse de nuevo.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px;text-align:center;border-top:1px solid #eee;">
                <p style="font-size:12px;color:#999;margin:16px 0 0;">
                  Recibiste este mail porque pediste un aviso en ${brandName}. Es un aviso único para este producto.
                </p>
                <p style="font-size:12px;color:#999;margin:8px 0 0;">
                  <a href="${escapeHtml(data.urlBaja)}" style="color:#999;">No quiero recibir más avisos</a>
                  · <a href="${escapeHtml(branding.sitioUrl)}" style="color:#999;">${escapeHtml(branding.sitioUrl)}</a>
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
