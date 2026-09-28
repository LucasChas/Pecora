// ============================================================================
// Pecora — Lógica pura de avisar-reposicion.
//
// Todo lo que no toca la red, la base ni Deno.env vive acá, para poder
// testearlo con Vitest en Node (logica.test.ts). Reutiliza los helpers de
// enviar-recibo-pedido (auth, validación de emails, codificación MIME), que
// tampoco tienen imports remotos.
// ============================================================================

import {
  encodeMimeSubject,
  esEmailSeguro,
  utf8ToBase64,
  wrapBase64,
} from "../enviar-recibo-pedido/logica.ts";

export {
  bearerToken,
  esEmailSeguro,
  formatFromHeader,
  toBase64Url,
  tokensIguales,
} from "../enviar-recibo-pedido/logica.ts";

/** Sitio público por defecto (el muestrario en Vercel). */
export const SITIO_POR_DEFECTO = "https://pecora-muestrario.vercel.app";

/** Máximo de suscripciones que se leen por tanda. */
export const LIMITE_POR_TANDA = 200;

/** Timeout de cada fetch (Google y la base). */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * Minutos tras los que vence una reserva sin envío confirmado (la fila vuelve
 * a pendiente). Tiene que coincidir con aviso_stock_pendiente en la migración
 * *_avisos_stock.sql (lo chequea logica.test.ts).
 */
export const RESERVA_VENCE_MINUTOS = 15;

// ----------------------------------------------------------------------------
// Red.
// ----------------------------------------------------------------------------

/**
 * Copia de `init` con un AbortSignal que corta a los `ms`. Si ya traía una
 * señal (p. ej. supabase-js), corta con la primera de las dos.
 */
export function conTimeout(init: RequestInit = {}, ms: number = FETCH_TIMEOUT_MS): RequestInit {
  const timeout = AbortSignal.timeout(ms);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return { ...init, signal };
}

/** SQL para reintentar ya un aviso (borra la reserva y vuelve a invocar). */
export function sqlReintentarAviso(id: string): string {
  return (
    `update public.avisos_stock set reservado_at = null where id = '${id}' ` +
    `and notificado_at is null; select public.invocar_aviso_stock(` +
    `(select producto_id from public.avisos_stock where id = '${id}'));`
  );
}

// ----------------------------------------------------------------------------
// Request.
// ----------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Saca el producto_id del body de la request ({ producto_id }). */
export function leerProductoId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const id = (body as Record<string, unknown>).producto_id;
  return esUuid(id) ? id.toLowerCase() : null;
}

// ----------------------------------------------------------------------------
// URLs.
// ----------------------------------------------------------------------------

/**
 * URL base del sitio público: el primer candidato que sea una URL http(s)
 * válida, sin barra final. Si ninguno sirve, el sitio por defecto.
 */
export function resolverSitio(...candidatos: (string | undefined | null)[]): string {
  for (const raw of candidatos) {
    const valor = raw?.trim();
    if (!valor) continue;
    try {
      const url = new URL(valor);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
    } catch {
      // No es una URL: se prueba con el siguiente.
    }
  }
  return SITIO_POR_DEFECTO;
}

/** Link al detalle del producto (por slug si lo hay, si no por id). */
export function urlProducto(sitio: string, producto: { id: string; slug: string | null }): string {
  const param = producto.slug?.trim() || producto.id;
  return `${sitio}/producto/${encodeURIComponent(param)}`;
}

/** Link de baja: la página /aviso/baja del sitio con el token de la suscripción. */
export function urlBaja(sitio: string, token: string): string {
  return `${sitio}/aviso/baja?token=${encodeURIComponent(token)}`;
}

/** Primera foto usable del producto (galería o portada), solo http(s). */
export function primeraFoto(producto: {
  imagenes?: unknown;
  imagen_url?: string | null;
}): string | null {
  const candidatas: unknown[] = [
    ...(Array.isArray(producto.imagenes) ? producto.imagenes : []),
    producto.imagen_url,
  ];
  for (const c of candidatas) {
    if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) return c.trim();
  }
  return null;
}

// ----------------------------------------------------------------------------
// Qué mandar.
// ----------------------------------------------------------------------------

export interface Suscripcion {
  id: string;
  email: string;
  token: string;
}

/**
 * Separa las suscripciones a las que se les puede mandar el mail (email con
 * formato seguro, token válido) de las que no. Las inválidas se loguean y
 * quedan pendientes (no se marcan).
 */
export function separarDestinatarios(filas: readonly Suscripcion[]): {
  validas: Suscripcion[];
  invalidas: Suscripcion[];
} {
  const validas: Suscripcion[] = [];
  const invalidas: Suscripcion[] = [];
  for (const fila of filas) {
    const email = fila.email?.trim() ?? "";
    if (esEmailSeguro(email) && esUuid(fila.token)) validas.push({ ...fila, email });
    else invalidas.push(fila);
  }
  return { validas, invalidas };
}

/** Oculta la parte local de un email para los logs: "an***@dominio.com". */
export function enmascararEmail(email: string): string {
  const [local, dominio] = email.split("@");
  if (!dominio) return "***";
  return `${local.slice(0, 2)}***@${dominio}`;
}

// ----------------------------------------------------------------------------
// MIME.
// ----------------------------------------------------------------------------

/**
 * Mensaje RFC 2822 con List-Unsubscribe (los clientes de correo muestran un
 * "Anular suscripción" que abre la página de baja). La URL se valida: sin
 * CR/LF ni '>' no puede inyectar headers.
 */
export function buildMimeMessageConBaja(params: {
  from: string;
  to: string;
  subject: string;
  html: string;
  urlBaja: string;
}): string {
  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${encodeMimeSubject(params.subject)}`,
  ];
  if (/^https?:\/\/[^\s<>]+$/i.test(params.urlBaja)) {
    headers.push(`List-Unsubscribe: <${params.urlBaja}>`);
  }
  return [
    ...headers,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrapBase64(utf8ToBase64(params.html)),
  ].join("\r\n");
}
