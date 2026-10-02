// ============================================================================
// Pecora — Lógica pura de avisos-tienda (sin red, base ni Deno.env), para
// testearla con Vitest en Node (logica.test.ts).
// ============================================================================

export {
  bearerToken,
  buildMimeMessage,
  esEmailSeguro,
  formatFromHeader,
  parseItems,
  parseOwnerEmails,
  toNumber,
} from "../enviar-recibo-pedido/logica.ts";
export { enmascararEmail, primeraFoto, resolverSitio, urlProducto } from "../avisar-reposicion/logica.ts";

import { toNumber } from "../enviar-recibo-pedido/logica.ts";

export type TipoAviso = "pedido_enviado" | "envios_pendientes" | "stock_bajo" | "carritos" | "reporte_mensual";

export type PedidoAviso =
  | { tipo: "pedido_enviado"; pedidoId: string }
  | { tipo: "envios_pendientes" }
  | { tipo: "stock_bajo" }
  | { tipo: "carritos" }
  | { tipo: "reporte_mensual"; mes: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lee el body de la invocación. null si no es un aviso conocido. */
export function leerPedidoAviso(body: unknown): PedidoAviso | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  switch (b.tipo) {
    case "pedido_enviado":
      return typeof b.pedido_id === "string" && UUID_RE.test(b.pedido_id)
        ? { tipo: "pedido_enviado", pedidoId: b.pedido_id }
        : null;
    case "envios_pendientes":
      return { tipo: "envios_pendientes" };
    case "stock_bajo":
      return { tipo: "stock_bajo" };
    case "carritos":
      return { tipo: "carritos" };
    case "reporte_mensual": {
      const mes = typeof b.mes === "string" && /^\d{4}-\d{2}$/.test(b.mes) ? b.mes : null;
      return { tipo: "reporte_mensual", mes };
    }
    default:
      return null;
  }
}

/**
 * Primer día del mes anterior a `ahora` (en hora de Argentina), "YYYY-MM-01".
 * El reporte sale el día 1 y resume el mes que terminó.
 */
export function mesAnterior(ahora: Date): string {
  // UTC-3 fijo (Argentina no tiene horario de verano).
  const local = new Date(ahora.getTime() - 3 * 60 * 60 * 1000);
  let anio = local.getUTCFullYear();
  let mes = local.getUTCMonth(); // 0-11: el mes actual; el anterior es mes-1
  if (mes === 0) {
    anio -= 1;
    mes = 12;
  }
  return `${anio}-${String(mes).padStart(2, "0")}-01`;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-09" o "2026-09-01" → "septiembre 2026". */
export function nombreMes(mes: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(mes);
  if (!m) return mes;
  const idx = Number(m[2]) - 1;
  return MESES[idx] ? `${MESES[idx]} ${m[1]}` : mes;
}

/** Variación porcentual redondeada; null si no hay base para comparar. */
export function variacion(actual: number, anterior: number): number | null {
  if (!(anterior > 0)) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

/** El seguimiento puede ser un link o un código. */
export function leerSeguimiento(raw: string | null | undefined): { codigo: string | null; url: string | null } {
  const valor = raw?.trim() ?? "";
  if (!valor) return { codigo: null, url: null };
  if (/^https?:\/\/[^\s<>"]+$/i.test(valor)) return { codigo: null, url: valor };
  return { codigo: valor, url: null };
}

// ---- Carritos ------------------------------------------------------------------

export interface ItemCarritoGuardado {
  id: string;
  cantidad: number;
}

/** Ítems del carrito guardado: solo los que tienen id uuid y cantidad > 0. */
export function leerItemsCarrito(raw: unknown): ItemCarritoGuardado[] {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set<string>();
  const res: ItemCarritoGuardado[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const cantidad = Math.floor(toNumber(o.cantidad));
    // Un mismo producto puede venir en dos talles: se lo cuenta una vez.
    if (!UUID_RE.test(id) || cantidad <= 0 || vistos.has(id)) continue;
    vistos.add(id);
    res.push({ id, cantidad: Math.min(cantidad, 99) });
  }
  return res;
}

export interface ProductoCarrito {
  id: string;
  nombre: string;
  slug: string | null;
  precio: number | string;
  stock: number;
  imagenes?: unknown;
  imagen_url?: string | null;
}

export interface LineaRecordatorio {
  nombre: string;
  precio: number;
  cantidad: number;
  foto: string | null;
  url: string;
}

/**
 * Arma las líneas del recordatorio con los datos actuales de cada producto.
 * Los que ya no existen o no tienen stock no se muestran (no tiene sentido
 * recordarle algo que no puede comprar).
 */
export function lineasRecordatorio(
  items: readonly ItemCarritoGuardado[],
  productos: readonly ProductoCarrito[],
  urlDe: (p: ProductoCarrito) => string,
  fotoDe: (p: ProductoCarrito) => string | null,
): LineaRecordatorio[] {
  const porId = new Map(productos.map((p) => [p.id, p]));
  const lineas: LineaRecordatorio[] = [];
  for (const item of items) {
    const p = porId.get(item.id);
    if (!p || !(p.stock > 0)) continue;
    lineas.push({
      nombre: p.nombre,
      precio: toNumber(p.precio),
      cantidad: Math.min(item.cantidad, p.stock),
      foto: fotoDe(p),
      url: urlDe(p),
    });
  }
  return lineas;
}

/** Primer nombre para el saludo ("Ana María López" → "Ana"). */
export function primerNombre(nombre: string | null | undefined): string {
  return (nombre ?? "").trim().split(/\s+/)[0] ?? "";
}
