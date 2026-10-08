// ============================================================================
// Pecora — Lógica pura de crear-pedido-invitada.
//
// Todo lo que no toca la red, la base ni Deno.env vive acá, para poder
// testearlo con Vitest en Node (logica.test.ts). Reutiliza los helpers de
// CORS y de errores de cotizar-envio.
// ============================================================================

import { error, type ErrorCotizacion } from "../cotizar-envio/logica.ts";

export {
  corsHeaders,
  cuerpoError,
  error,
  esError,
  type ErrorCotizacion,
  origenesPermitidos,
  origenPermitido,
} from "../cotizar-envio/logica.ts";

/** Acción del widget de Turnstile en el checkout (CheckoutPage). */
export const ACCION_TURNSTILE = "checkout";

// ----------------------------------------------------------------------------
// Body.
// ----------------------------------------------------------------------------

/**
 * Parámetros de crear_pedido que puede mandar una invitada. Sin p_cupon (las
 * invitadas no usan cupones) ni p_origen (siempre 'checkout').
 */
export interface ParamsPedido {
  p_nombre: string;
  p_telefono: string;
  p_email: string;
  p_entrega: string;
  p_direccion: string | null;
  p_localidad: string | null;
  p_cp: string | null;
  p_notas: string | null;
  p_items: { id: string; cantidad: number; talle_id?: string }[];
  p_subtotal: number;
  p_provincia: string | null;
  p_idempotency_key: string | null;
  p_cotizacion_envio: string | null;
}

export interface CuerpoPedido {
  token: string;
  params: ParamsPedido;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXTO = 2000;

const invalido = () => error(400, "invalid_body", "El pedido no tiene el formato esperado.");

function texto(v: unknown, obligatorio: boolean): string | null | undefined {
  if (v === undefined || v === null || v === "") return obligatorio ? undefined : null;
  if (typeof v !== "string" || v.length > MAX_TEXTO) return undefined;
  return v;
}

function uuidOpcional(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" && UUID_RE.test(v) ? v : undefined;
}

/**
 * Valida el body { turnstile_token, pedido: { p_nombre, ... } }. Solo copia
 * los parámetros conocidos: todo lo demás se descarta. Las reglas de negocio
 * (stock, topes, email, cotización) las vuelve a chequear crear_pedido.
 */
export function parseCuerpo(body: unknown): CuerpoPedido | ErrorCotizacion {
  if (!body || typeof body !== "object") return invalido();
  const b = body as Record<string, unknown>;

  const token = b.turnstile_token;
  if (typeof token !== "string" || !token || token.length > 4096) {
    return error(400, "captcha_requerido", "Falta la verificación de seguridad. Recargá la página y volvé a intentar.");
  }

  const p = b.pedido;
  if (!p || typeof p !== "object") return invalido();
  const r = p as Record<string, unknown>;

  const nombre = texto(r.p_nombre, true);
  const telefono = texto(r.p_telefono, true);
  const email = texto(r.p_email, false);
  const entrega = texto(r.p_entrega, false);
  const direccion = texto(r.p_direccion, false);
  const localidad = texto(r.p_localidad, false);
  const cp = texto(r.p_cp, false);
  const notas = texto(r.p_notas, false);
  const provincia = texto(r.p_provincia, false);
  const idempotency = uuidOpcional(r.p_idempotency_key);
  const cotizacion = uuidOpcional(r.p_cotizacion_envio);
  const subtotal = r.p_subtotal === undefined ? 0 : r.p_subtotal;

  if (
    nombre === undefined || telefono === undefined || email === undefined ||
    entrega === undefined || direccion === undefined || localidad === undefined ||
    cp === undefined || notas === undefined || provincia === undefined ||
    idempotency === undefined || cotizacion === undefined ||
    typeof subtotal !== "number" || !Number.isFinite(subtotal)
  ) {
    return invalido();
  }

  if (!Array.isArray(r.p_items) || r.p_items.length === 0 || r.p_items.length > 50) return invalido();
  const items: ParamsPedido["p_items"] = [];
  for (const raw of r.p_items) {
    if (!raw || typeof raw !== "object") return invalido();
    const it = raw as Record<string, unknown>;
    if (typeof it.id !== "string" || !UUID_RE.test(it.id)) return invalido();
    if (typeof it.cantidad !== "number" || !Number.isInteger(it.cantidad) || it.cantidad < 1) return invalido();
    const talle = uuidOpcional(it.talle_id);
    if (talle === undefined) return invalido();
    items.push({ id: it.id, cantidad: it.cantidad, ...(talle ? { talle_id: talle } : {}) });
  }

  return {
    token,
    params: {
      p_nombre: nombre!,
      p_telefono: telefono!,
      p_email: email ?? "",
      p_entrega: entrega ?? "coordinar",
      p_direccion: direccion,
      p_localidad: localidad,
      p_cp: cp,
      p_notas: notas,
      p_items: items,
      p_subtotal: subtotal,
      p_provincia: provincia,
      p_idempotency_key: idempotency,
      p_cotizacion_envio: cotizacion,
    },
  };
}

// ----------------------------------------------------------------------------
// Turnstile.
// ----------------------------------------------------------------------------

/**
 * Respuesta de https://challenges.cloudflare.com/turnstile/v0/siteverify.
 * Vale si success es true y, cuando viene la acción, es la del checkout.
 */
export function turnstileValido(respuesta: unknown, accion: string = ACCION_TURNSTILE): boolean {
  if (!respuesta || typeof respuesta !== "object") return false;
  const r = respuesta as Record<string, unknown>;
  if (r.success !== true) return false;
  return r.action === undefined || r.action === null || r.action === "" || r.action === accion;
}

// ----------------------------------------------------------------------------
// Conexión de quien llama.
// ----------------------------------------------------------------------------

/**
 * IP de quien llama, solo de headers que pone la infraestructura
 * (cf-connecting-ip o x-real-ip). No se usa x-forwarded-for: su primer valor
 * lo puede escribir quien llama. Sin ninguno de los dos, null (el tope por
 * conexión no se aplica; el CAPTCHA sí).
 */
export function ipConfiable(headers: Headers): string | null {
  for (const nombre of ["cf-connecting-ip", "x-real-ip"]) {
    const v = headers.get(nombre)?.trim();
    if (v && v.length <= 64 && /^[0-9a-f.:]+$/i.test(v)) return v.toLowerCase();
  }
  return null;
}

/** SHA-256 (hex) de la IP con un secreto: en la base nunca queda la IP. */
export async function hashIp(ip: string, secreto: string): Promise<string> {
  const datos = new TextEncoder().encode(`${secreto}:${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", datos));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ----------------------------------------------------------------------------
// Errores de crear_pedido.
// ----------------------------------------------------------------------------

/**
 * Error del RPC → respuesta. Los mensajes de crear_pedido (P0001: stock,
 * topes, email; 22023: cotización vencida) están redactados para la clienta y
 * se devuelven tal cual, con el código de Postgres en `codigo` (el front usa
 * 22023 para recotizar). 42501: la base todavía no le da permiso a la
 * service_role (falta la migración); el front vuelve al RPC directo. Lo
 * demás, mensaje genérico (el detalle queda en el log).
 */
export function errorDeRpc(e: { code?: string; message?: string }): ErrorCotizacion {
  if ((e.code === "P0001" || e.code === "22023") && e.message) {
    return error(400, e.code, e.message);
  }
  if (e.code === "42501") {
    return error(503, "sin_permiso", "La compra sin cuenta no está disponible en este momento.");
  }
  return error(500, "internal_error", "No pudimos registrar el pedido. Probá de nuevo en un momento.");
}

/** El RPC devuelve el número de pedido (bigint): número o texto. */
export function numeroDePedido(data: unknown): number | null {
  const n = typeof data === "string" ? Number(data) : data;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}
