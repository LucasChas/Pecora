// ============================================================================
// Pecora — Lógica pura de enviar-recibo-pedido.
//
// Todo lo que no toca la red, la base ni Deno.env vive acá, para poder
// testearlo con Vitest en Node (logica.test.ts). Sin imports remotos: solo
// APIs web estándar (crypto.subtle, TextEncoder, btoa), que están tanto en
// Deno como en Node.
// ============================================================================

import type { ReciboItem } from "./template.ts";

// ----------------------------------------------------------------------------
// Qué mandar.
// ----------------------------------------------------------------------------

/**
 * Resultado de cada mail, tal cual queda en la respuesta (pg_net la guarda en
 * net._http_response, útil para diagnosticar desde el SQL Editor).
 */
export type EstadoEnvio =
  | "sent"
  | "already_sent"
  | "no_recipient"
  | "invalid_recipient"
  | "owner_email_unset"
  | "send_failed";

/** Estado antes de intentar: "pending" = hay que mandarlo. */
export type EstadoInicial = Exclude<EstadoEnvio, "sent" | "send_failed"> | "pending";

export type DecisionEnvios =
  | { tipo: "manual" }
  | { tipo: "envios"; recibo: EstadoInicial; aviso: EstadoInicial };

/** Los pedidos cargados a mano por la admin (origen 'admin') no mandan mails. */
export function esCargaManual(origen: string): boolean {
  return origen === "admin";
}

/**
 * Decide qué mails salen para un pedido, sin mandar nada:
 *   - carga manual → ninguno;
 *   - cada mail ya marcado como enviado → no se repite;
 *   - recibo: hace falta un email de la clienta con formato seguro;
 *   - aviso: hace falta al menos una dirección válida en OWNER_EMAIL.
 */
export function decidirEnvios(entrada: {
  origen: string;
  emailEnviadoAt: string | null;
  avisoDuenaEnviadoAt: string | null;
  /** Email ya resuelto (pedidos.email o el de la cuenta); "" si no hay. */
  emailCliente: string;
  /** Direcciones válidas de OWNER_EMAIL (ver parseOwnerEmails). */
  ownerEmails: readonly string[];
}): DecisionEnvios {
  if (esCargaManual(entrada.origen)) return { tipo: "manual" };

  let recibo: EstadoInicial;
  if (entrada.emailEnviadoAt) recibo = "already_sent";
  else if (!entrada.emailCliente) recibo = "no_recipient";
  else if (!esEmailSeguro(entrada.emailCliente)) recibo = "invalid_recipient";
  else recibo = "pending";

  let aviso: EstadoInicial;
  if (entrada.avisoDuenaEnviadoAt) aviso = "already_sent";
  else if (entrada.ownerEmails.length === 0) aviso = "owner_email_unset";
  else aviso = "pending";

  return { tipo: "envios", recibo, aviso };
}

// ----------------------------------------------------------------------------
// Datos del pedido.
// ----------------------------------------------------------------------------

export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseItems(raw: unknown): ReciboItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ReciboItem | null => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const nombre = typeof obj.nombre === "string" ? obj.nombre : "";
      if (!nombre) return null;
      return { nombre, precio: toNumber(obj.precio), cantidad: toNumber(obj.cantidad) };
    })
    .filter((item): item is ReciboItem => item !== null);
}

/**
 * Nombre para el saludo del recibo: solo la primera palabra, si es un nombre
 * (letras, apóstrofo o guion, hasta 20). Si no, null y el saludo va sin
 * nombre. El nombre lo escribe quien hace el pedido y el recibo sale desde el
 * mail de la tienda hacia la dirección que se haya escrito: con el nombre
 * completo, se podía mandar un texto cualquiera ("transferí a ...", un link)
 * a terceros con la firma de la tienda.
 */
export function primerNombre(nombre: string | null | undefined): string | null {
  const primero = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}][\p{L}'’-]{0,19}$/u.test(primero) ? primero : null;
}

export function formatFecha(iso: string, conHora = false): string {
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...(conHora ? { hour: "2-digit", minute: "2-digit" } : {}),
      timeZone: "America/Argentina/Buenos_Aires",
    });
  } catch {
    return iso;
  }
}

// ----------------------------------------------------------------------------
// Auth: el Bearer tiene que ser la service-role key.
// ----------------------------------------------------------------------------

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match ? match[1] : null;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

/**
 * Comparación en tiempo constante. Compara los SHA-256 (32 bytes siempre) en
 * vez de los strings: el tiempo no depende ni del contenido ni del largo del
 * token recibido.
 */
export async function tokensIguales(recibido: string, esperado: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(recibido), sha256(esperado)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ----------------------------------------------------------------------------
// Destinatarios.
// ----------------------------------------------------------------------------

/**
 * Formato básico de email + ausencia de CR/LF. `pedidos.email` no tiene
 * validación de formato a nivel de base (crear_pedido() lo inserta tal cual
 * viene), así que sin este chequeo un `email` malicioso con un salto de línea
 * podría inyectar headers extra (ej. un Bcc oculto) en el mensaje RFC 2822.
 */
const EMAIL_RE = /^[^\s@\r\n,<>]+@[^\s@\r\n,<>]+\.[^\s@\r\n,<>]+$/;
/**
 * Link "Ver en el panel" de los mails a la dueña. El panel es otro deploy
 * (VITE_APP_MODE=admin) con su propia URL: en el muestrario /admin no existe,
 * así que nunca se arma a partir de STORE_URL. Se usa PUBLIC_ADMIN_URL y, si
 * falta, el primer origen de ADMIN_ORIGIN (el mismo panel). Sin ninguno de
 * los dos, el mail sale sin el botón.
 */
export function resolverPanelUrl(
  publicAdminUrl: string | undefined | null,
  adminOrigin: string | undefined | null,
): string | null {
  const candidatos = [publicAdminUrl ?? "", ...(adminOrigin ?? "").split(",")];
  for (const raw of candidatos) {
    const valor = raw.trim();
    if (!valor) continue;
    try {
      const url = new URL(valor);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      return url.href.replace(/\/+$/, "");
    } catch {
      // No es una URL: se prueba la siguiente.
    }
  }
  return null;
}

export function esEmailSeguro(value: string): boolean {
  return EMAIL_RE.test(value) && !/[\r\n]/.test(value);
}

/** OWNER_EMAIL admite varias direcciones separadas por coma. */
export function parseOwnerEmails(raw: string | undefined): { validos: string[]; invalidos: number } {
  const candidatos = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const validos = candidatos.filter(esEmailSeguro);
  return { validos, invalidos: candidatos.length - validos.length };
}

/**
 * Link de WhatsApp al teléfono de la clienta, normalizado a Argentina igual
 * que en el panel (src/components/admin/OrderCard.tsx): solo dígitos, sin el
 * 0 inicial y con 549 adelante si no empieza con 54.
 */
export function waClienteUrl(telefono: string, numero: number, brandName: string): string | null {
  let d = (telefono ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = d.slice(1);
  if (!d.startsWith("54")) d = "549" + d;
  const msg = `Hola! Te escribo por tu pedido #${numero} en ${brandName}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
}

// ----------------------------------------------------------------------------
// Helpers de codificación para armar el mensaje MIME crudo que espera la
// Gmail API en `messages.send` (campo `raw`, base64url del RFC 2822 completo).
// ----------------------------------------------------------------------------

/** UTF-8 string → base64 estándar (con padding, sin las sustituciones url-safe). */
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Envuelve una string base64 en líneas de 76 caracteres (recomendado por MIME). */
export function wrapBase64(b64: string, lineLength = 76): string {
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
export function encodeMimeSubject(subject: string): string {
  return `=?UTF-8?B?${utf8ToBase64(subject)}?=`;
}

/**
 * Arma el header `From` con nombre para mostrar + dirección, ej.
 * `"Pecora" <pecoraabril@gmail.com>`. Sin el nombre, los clientes de correo
 * muestran la dirección cruda (el nombre de usuario de Gmail) en vez de la
 * marca.
 */
export function formatFromHeader(displayName: string, email: string): string {
  return `${encodeMimeSubject(displayName)} <${email}>`;
}

/**
 * String (ASCII-only, ya armado) → base64url SIN padding, apto para el campo
 * `raw` de la Gmail API: `+` → `-`, `/` → `_`, se recorta el `=` final.
 */
export function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Arma el mensaje RFC 2822 completo (headers + línea en blanco + cuerpo). */
export function buildMimeMessage(params: {
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
