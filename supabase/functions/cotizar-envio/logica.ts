// ============================================================================
// Pecora — Lógica pura de cotizar-envio.
//
// Todo lo que no toca la base ni Deno.env vive acá, para testearlo con Vitest
// en Node (logica.test.ts). Las llamadas HTTP a los transportistas reciben un
// `fetch` inyectado, así los tests usan respuestas fijas (fixtures) con la
// forma documentada de cada API.
//
// Transportistas (ver supabase/functions/README.md, sección cotizar-envio,
// para lo verificado y lo supuesto de cada API):
//   - Andreani:          GET /login (Basic) -> header x-authorization-token,
//                        GET /v1/tarifas, GET /v2/sucursales.
//   - Correo Argentino:  API MiCorreo: POST /token (Basic) -> JWT,
//                        POST /rates, GET /agencies.
// ============================================================================

import { origenPermitido, parseOrigenes } from "../gestionar-equipo/logica.ts";

export { bearerToken } from "../enviar-recibo-pedido/logica.ts";
export { origenPermitido, parseOrigenes };

export type TransportistaId = "andreani" | "correo_argentino";
export type Servicio = "domicilio" | "sucursal";

export const TIMEOUT_TRANSPORTISTA_MS = 5000;
export const MAX_ITEMS = 50;
export const MAX_CANTIDAD = 99;
export const MAX_SUCURSALES = 5;

// ----------------------------------------------------------------------------
// Errores de respuesta.
// ----------------------------------------------------------------------------

export interface ErrorCotizacion {
  status: number;
  codigo: string;
  mensaje: string;
}

export function error(status: number, codigo: string, mensaje: string): ErrorCotizacion {
  return { status, codigo, mensaje };
}

export function esError(x: unknown): x is ErrorCotizacion {
  return !!x && typeof x === "object" && "codigo" in x && "status" in x && "mensaje" in x;
}

/** Cuerpo de error: `error` es el mensaje en español para mostrar tal cual. */
export function cuerpoError(e: ErrorCotizacion): { error: string; codigo: string } {
  return { error: e.mensaje, codigo: e.codigo };
}

// ----------------------------------------------------------------------------
// CORS: orígenes del catálogo (CATALOG_ORIGIN) y del panel (ADMIN_ORIGIN).
// ----------------------------------------------------------------------------

export function origenesPermitidos(catalogo: string | undefined, admin: string | undefined): string[] {
  return [...new Set([...parseOrigenes(catalogo), ...parseOrigenes(admin)])];
}

export function corsHeaders(origin: string | null, permitidos: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && origenPermitido(origin, permitidos)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

// ----------------------------------------------------------------------------
// Límite de pedidos por IP (en memoria, por instancia: es best effort).
// ----------------------------------------------------------------------------

/**
 * Ventana fija por clave: como máximo `max` pedidos cada `ventanaMs`.
 * Devuelve true si el pedido se permite.
 */
export function crearLimitador(max: number, ventanaMs: number, ahora: () => number = Date.now) {
  const ventanas = new Map<string, { inicio: number; cuenta: number }>();
  return (clave: string): boolean => {
    const t = ahora();
    // Limpieza para que el mapa no crezca sin límite.
    if (ventanas.size > 5000) {
      for (const [k, v] of ventanas) if (t - v.inicio >= ventanaMs) ventanas.delete(k);
    }
    const v = ventanas.get(clave);
    if (!v || t - v.inicio >= ventanaMs) {
      ventanas.set(clave, { inicio: t, cuenta: 1 });
      return true;
    }
    v.cuenta += 1;
    return v.cuenta <= max;
  };
}

/** IP de quien llama (primer valor de x-forwarded-for) o "desconocida". */
export function ipDeRequest(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const primera = xff.split(",")[0]?.trim();
    if (primera) return primera;
  }
  return headers.get("cf-connecting-ip")?.trim() || headers.get("x-real-ip")?.trim() || "desconocida";
}

// ----------------------------------------------------------------------------
// Body.
// ----------------------------------------------------------------------------

export interface ItemCotizacion {
  producto_id: string;
  cantidad: number;
}

export interface PedidoCotizacion {
  /** CP numérico de 4 dígitos (lo que usan los transportistas). */
  cp: string;
  /** CP tal como lo escribió la clienta (sin espacios, en mayúsculas). */
  cpOriginal: string;
  provincia: string;
  /** Agrupados por producto y ordenados por producto_id (en minúsculas). */
  items: ItemCotizacion[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVINCIA_MAX = 60;

/**
 * CP argentino -> código numérico de 4 dígitos. Acepta "5000" o el CPA
 * ("X5000ABC", letra + 4 dígitos + 3 letras). Cualquier otra cosa -> null.
 */
export function normalizarCp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cp = raw.replace(/\s+/g, "").toUpperCase();
  if (/^\d{4}$/.test(cp)) return cp;
  const cpa = /^[A-Z](\d{4})[A-Z]{3}$/.exec(cp);
  return cpa ? cpa[1] : null;
}

export function parsePedido(body: unknown): PedidoCotizacion | ErrorCotizacion {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return error(400, "invalid_body", "El pedido no tiene el formato esperado.");
  }
  const b = body as Record<string, unknown>;

  const cp = normalizarCp(b.cp);
  if (!cp) {
    return error(400, "invalid_cp", "El código postal no es válido. Usá 4 números (por ejemplo 5000).");
  }
  const provincia = typeof b.provincia === "string" ? b.provincia.trim().replace(/\s+/g, " ") : "";
  if (!provincia || provincia.length > PROVINCIA_MAX) {
    return error(400, "invalid_provincia", "Elegí la provincia.");
  }

  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > MAX_ITEMS) {
    return error(400, "invalid_items", `El carrito tiene que tener entre 1 y ${MAX_ITEMS} productos.`);
  }
  const porProducto = new Map<string, number>();
  for (const it of b.items) {
    const item = it as Record<string, unknown> | null;
    const id = typeof item?.producto_id === "string" ? item.producto_id.trim().toLowerCase() : "";
    const cantidad = item?.cantidad;
    if (!UUID_RE.test(id)) {
      return error(400, "invalid_items", "Uno de los productos del carrito no es válido.");
    }
    if (typeof cantidad !== "number" || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) {
      return error(400, "invalid_items", `La cantidad de cada producto tiene que ser entre 1 y ${MAX_CANTIDAD}.`);
    }
    porProducto.set(id, (porProducto.get(id) ?? 0) + cantidad);
  }
  const items = [...porProducto.entries()]
    .sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0))
    .map(([producto_id, cantidad]) => ({ producto_id, cantidad }));

  return {
    cp,
    cpOriginal: String(b.cp).replace(/\s+/g, "").toUpperCase(),
    provincia,
    items,
  };
}

// ----------------------------------------------------------------------------
// Paquete.
// ----------------------------------------------------------------------------

export interface ProductoEnvio {
  id: string;
  precio: number | string;
  peso_g: number | null;
  alto_cm: number | string | null;
  ancho_cm: number | string | null;
  largo_cm: number | string | null;
}

export interface Defaults {
  peso_g: number;
  alto_cm: number;
  ancho_cm: number;
  largo_cm: number;
}

export interface Paquete {
  peso_g: number;
  alto_cm: number;
  ancho_cm: number;
  largo_cm: number;
  /** Valor declarado = subtotal con los precios de la base. */
  valor_declarado: number;
}

export const DEFAULTS: Defaults = { peso_g: 300, alto_cm: 10, ancho_cm: 15, largo_cm: 20 };

function positivo(raw: string | undefined, porDefecto: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : porDefecto;
}

/** Defaults desde los secretos DEFAULT_PESO_G / DEFAULT_ALTO_CM / ... */
export function leerDefaults(env: (k: string) => string | undefined): Defaults {
  return {
    peso_g: positivo(env("DEFAULT_PESO_G"), DEFAULTS.peso_g),
    alto_cm: positivo(env("DEFAULT_ALTO_CM"), DEFAULTS.alto_cm),
    ancho_cm: positivo(env("DEFAULT_ANCHO_CM"), DEFAULTS.ancho_cm),
    largo_cm: positivo(env("DEFAULT_LARGO_CM"), DEFAULTS.largo_cm),
  };
}

function medida(v: number | string | null | undefined, porDefecto: number): number {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) && n > 0 ? n : porDefecto;
}

/**
 * Un solo bulto: peso = suma de (peso_g ?? default) × cantidad; cada lado =
 * el máximo de ese lado entre los productos (o el default). Si falta algún
 * producto (borrado), devuelve error.
 */
export function armarPaquete(
  items: readonly ItemCotizacion[],
  productos: readonly ProductoEnvio[],
  defaults: Defaults,
): Paquete | ErrorCotizacion {
  const porId = new Map(productos.map((p) => [p.id.toLowerCase(), p]));
  let peso = 0;
  let valor = 0;
  let alto = 0;
  let ancho = 0;
  let largo = 0;
  for (const it of items) {
    const p = porId.get(it.producto_id);
    if (!p) {
      return error(400, "producto_no_disponible", "Uno de los productos de tu carrito ya no está disponible.");
    }
    peso += medida(p.peso_g, defaults.peso_g) * it.cantidad;
    valor += Number(p.precio) * it.cantidad;
    alto = Math.max(alto, medida(p.alto_cm, defaults.alto_cm));
    ancho = Math.max(ancho, medida(p.ancho_cm, defaults.ancho_cm));
    largo = Math.max(largo, medida(p.largo_cm, defaults.largo_cm));
  }
  return {
    peso_g: Math.round(peso),
    alto_cm: alto,
    ancho_cm: ancho,
    largo_cm: largo,
    valor_declarado: Math.round(valor * 100) / 100,
  };
}

// ----------------------------------------------------------------------------
// Transportistas.
// ----------------------------------------------------------------------------

export interface Destino {
  cp: string;
  provincia: string;
}

export interface Sucursal {
  id: string;
  nombre: string;
  direccion: string;
}

export interface OpcionTransportista {
  transportista: TransportistaId;
  servicio: Servicio;
  precio: number;
  plazo: string | null;
  sucursal?: Sucursal;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Contexto {
  fetch: Fetch;
  signal: AbortSignal;
  /** Para avisar fallas parciales (p. ej. sucursales) sin datos sensibles. */
  log?: (msg: string) => void;
}

function motivoDe(e: unknown): string {
  return e instanceof ErrorTransportista ? e.message
    : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** Loguea las partes que fallaron cuando igual hubo alguna opción. */
function avisarParciales(ctx: Contexto, id: TransportistaId, resultados: PromiseSettledResult<unknown>[]) {
  for (const r of resultados) {
    if (r.status === "rejected") ctx.log?.(`${id} parcial: ${motivoDe(r.reason)}`);
  }
}

export interface Transportista {
  id: TransportistaId;
  cotizar(paquete: Paquete, destino: Destino, ctx: Contexto): Promise<OpcionTransportista[]>;
}

/** Error de un transportista (sin datos sensibles: se loguea tal cual). */
export class ErrorTransportista extends Error {}

/** Token con vencimiento, compartido entre requests de la misma instancia. */
export interface CacheToken {
  token: string;
  venceMs: number;
}
export type CacheTokens = Map<string, CacheToken>;

function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

function aNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** "3 a 5 días hábiles" / "2 días hábiles" / null. */
export function formatearPlazo(min: unknown, max: unknown): string | null {
  const a = aNumero(min);
  const b = aNumero(max);
  const lo = a ?? b;
  const hi = b ?? a;
  if (lo === null || hi === null || lo < 0 || hi < 0) return null;
  if (lo === hi) return `${lo} ${lo === 1 ? "día hábil" : "días hábiles"}`;
  return `${Math.min(lo, hi)} a ${Math.max(lo, hi)} días hábiles`;
}

function basicAuth(usuario: string, password: string): string {
  return `Basic ${btoa(`${usuario}:${password}`)}`;
}

async function leerJson(res: Response, que: string): Promise<unknown> {
  if (!res.ok) throw new ErrorTransportista(`${que}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new ErrorTransportista(`${que}: respuesta no es JSON`);
  }
}

function quitarBarra(url: string): string {
  return url.replace(/\/+$/, "");
}

// ---- Andreani ---------------------------------------------------------------

export interface ConfigAndreani {
  baseUrl: string;
  cliente: string;
  contratoDomicilio: string | null;
  contratoSucursal: string | null;
  sucursalOrigen: string | null;
  usuario: string | null;
  password: string | null;
}

export const ANDREANI_URL = "https://apis.andreani.com";
/** Duración supuesta del token de Andreani (no está documentada). */
export const ANDREANI_TOKEN_MS = 60 * 60 * 1000;

/**
 * Andreani se habilita con ANDREANI_CLIENTE y al menos un contrato. Usuario y
 * contraseña (login) son opcionales: si están, las llamadas llevan el token.
 */
export function configAndreani(env: (k: string) => string | undefined): ConfigAndreani | null {
  const v = (k: string) => env(k)?.trim() || null;
  const cliente = v("ANDREANI_CLIENTE");
  const contratoDomicilio = v("ANDREANI_CONTRATO_DOMICILIO");
  const contratoSucursal = v("ANDREANI_CONTRATO_SUCURSAL");
  if (!cliente || (!contratoDomicilio && !contratoSucursal)) return null;
  return {
    baseUrl: quitarBarra(v("ANDREANI_API_URL") ?? ANDREANI_URL),
    cliente,
    contratoDomicilio,
    contratoSucursal,
    sucursalOrigen: v("ANDREANI_SUCURSAL_ORIGEN"),
    usuario: v("ANDREANI_USUARIO"),
    password: v("ANDREANI_PASSWORD"),
  };
}

/**
 * Precio con IVA de /v1/tarifas. Según la fuente, `tarifaConIva` es un objeto
 * `{ distribucion, seguroDistribucion, total }` (strings) o directamente un
 * número; se aceptan las dos formas.
 */
export function parseTarifaAndreani(json: unknown): { precio: number; plazo: string | null } {
  const j = (json ?? {}) as Record<string, unknown>;
  const t = j.tarifaConIva;
  const precio = typeof t === "object" && t !== null
    ? aNumero((t as Record<string, unknown>).total)
    : aNumero(t);
  if (precio === null || precio < 0) {
    throw new ErrorTransportista("andreani tarifas: falta tarifaConIva.total");
  }
  let plazo: string | null = null;
  const p = j.plazoEntrega;
  if (p && typeof p === "object") {
    const o = p as Record<string, unknown>;
    plazo = formatearPlazo(o.minimo, o.maximo);
  } else if (p !== undefined) {
    plazo = formatearPlazo(p, p);
  }
  return { precio: redondear2(precio), plazo };
}

/** Sucursales de /v2/sucursales (hasta MAX_SUCURSALES, en el orden de la API). */
export function parseSucursalesAndreani(json: unknown): Sucursal[] {
  if (!Array.isArray(json)) throw new ErrorTransportista("andreani sucursales: se esperaba una lista");
  const out: Sucursal[] = [];
  for (const raw of json) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const id = s.id ?? s.codigo ?? s.numero;
    if (id === undefined || id === null || String(id).trim() === "") continue;
    const d = (s.direccion ?? {}) as Record<string, unknown>;
    const calle = [d.calle, d.numero].filter((x) => x !== undefined && x !== null && String(x).trim() !== "")
      .join(" ");
    const direccion = [calle, d.localidad, d.provincia]
      .filter((x) => typeof x === "string" && x.trim() !== "")
      .join(", ");
    const nombre = [s.descripcion, s.nombre, s.sucursal].find((x) => typeof x === "string" && x.trim() !== "");
    out.push({
      id: String(id).trim(),
      nombre: typeof nombre === "string" ? nombre.trim() : `Sucursal ${String(id).trim()}`,
      direccion,
    });
    if (out.length >= MAX_SUCURSALES) break;
  }
  return out;
}

export function crearAndreani(config: ConfigAndreani, cache: CacheTokens, ahora: () => number = Date.now): Transportista {
  async function token(ctx: Contexto): Promise<string | null> {
    if (!config.usuario || !config.password) return null;
    const c = cache.get("andreani");
    if (c && c.venceMs > ahora()) return c.token;
    const res = await ctx.fetch(`${config.baseUrl}/login`, {
      method: "GET",
      headers: { Authorization: basicAuth(config.usuario, config.password) },
      signal: ctx.signal,
    });
    if (!res.ok) throw new ErrorTransportista(`andreani login: HTTP ${res.status}`);
    const t = res.headers.get("x-authorization-token");
    if (!t) throw new ErrorTransportista("andreani login: falta x-authorization-token");
    cache.set("andreani", { token: t, venceMs: ahora() + ANDREANI_TOKEN_MS });
    return t;
  }

  async function tarifa(contrato: string, p: Paquete, destino: Destino, tk: string | null, ctx: Contexto) {
    const qs = new URLSearchParams({ cpDestino: destino.cp, contrato, cliente: config.cliente });
    if (config.sucursalOrigen) qs.set("sucursalOrigen", config.sucursalOrigen);
    qs.set("bultos[0][valorDeclarado]", String(p.valor_declarado));
    qs.set("bultos[0][volumen]", String(Math.ceil(p.alto_cm * p.ancho_cm * p.largo_cm)));
    qs.set("bultos[0][kilos]", String(Math.round(p.peso_g) / 1000));
    qs.set("bultos[0][altoCm]", String(p.alto_cm));
    qs.set("bultos[0][anchoCm]", String(p.ancho_cm));
    qs.set("bultos[0][largoCm]", String(p.largo_cm));
    const res = await ctx.fetch(`${config.baseUrl}/v1/tarifas?${qs.toString()}`, {
      headers: tk ? { "x-authorization-token": tk } : {},
      signal: ctx.signal,
    });
    if (res.status === 401 || res.status === 403) cache.delete("andreani");
    return parseTarifaAndreani(await leerJson(res, "andreani tarifas"));
  }

  async function sucursales(destino: Destino, tk: string | null, ctx: Contexto): Promise<Sucursal[]> {
    const qs = new URLSearchParams({ codigoPostal: destino.cp, canal: "B2C" });
    const res = await ctx.fetch(`${config.baseUrl}/v2/sucursales?${qs.toString()}`, {
      headers: tk ? { "x-authorization-token": tk } : {},
      signal: ctx.signal,
    });
    return parseSucursalesAndreani(await leerJson(res, "andreani sucursales"));
  }

  return {
    id: "andreani",
    async cotizar(paquete, destino, ctx) {
      const tk = await token(ctx);
      const [dom, suc, lista] = await Promise.allSettled([
        config.contratoDomicilio ? tarifa(config.contratoDomicilio, paquete, destino, tk, ctx) : Promise.resolve(null),
        config.contratoSucursal ? tarifa(config.contratoSucursal, paquete, destino, tk, ctx) : Promise.resolve(null),
        config.contratoSucursal ? sucursales(destino, tk, ctx) : Promise.resolve([]),
      ]);
      const opciones: OpcionTransportista[] = [];
      if (dom.status === "fulfilled" && dom.value) {
        opciones.push({ transportista: "andreani", servicio: "domicilio", ...dom.value });
      }
      if (suc.status === "fulfilled" && suc.value && lista.status === "fulfilled") {
        for (const s of lista.value) {
          opciones.push({ transportista: "andreani", servicio: "sucursal", ...suc.value, sucursal: s });
        }
      }
      if (opciones.length > 0) avisarParciales(ctx, "andreani", [dom, suc, lista]);
      if (opciones.length === 0) {
        const motivo = [dom, suc, lista].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        throw motivo?.reason instanceof Error
          ? motivo.reason
          : new ErrorTransportista("andreani: sin opciones para este destino");
      }
      return opciones;
    },
  };
}

// ---- Correo Argentino (MiCorreo) -------------------------------------------

export interface ConfigCorreo {
  baseUrl: string;
  usuario: string;
  password: string;
  customerId: string;
  cpOrigen: string;
}

export const CORREO_URL = "https://api.correoargentino.com.ar/micorreo/v1";
/** Límites de /rates según la documentación de MiCorreo. */
export const CORREO_MAX_PESO_G = 25000;
export const CORREO_MAX_LADO_CM = 150;

export function configCorreo(env: (k: string) => string | undefined): ConfigCorreo | null {
  const v = (k: string) => env(k)?.trim() || null;
  const usuario = v("CORREO_USER");
  const password = v("CORREO_PASSWORD");
  const customerId = v("CORREO_CUSTOMER_ID");
  const cpOrigen = normalizarCp(v("ORIGEN_CP") ?? "");
  if (!usuario || !password || !customerId || !cpOrigen) return null;
  return {
    baseUrl: quitarBarra(v("CORREO_API_URL") ?? CORREO_URL),
    usuario,
    password,
    customerId,
    cpOrigen,
  };
}

/** Códigos de provincia de MiCorreo (ISO 3166-2:AR sin el prefijo). */
const PROVINCIAS_CORREO: Record<string, string> = {
  "salta": "A",
  "buenos-aires": "B",
  "provincia-de-buenos-aires": "B",
  "ciudad-autonoma-de-buenos-aires": "C",
  "caba": "C",
  "capital-federal": "C",
  "san-luis": "D",
  "entre-rios": "E",
  "la-rioja": "F",
  "santiago-del-estero": "G",
  "chaco": "H",
  "san-juan": "J",
  "catamarca": "K",
  "la-pampa": "L",
  "mendoza": "M",
  "misiones": "N",
  "formosa": "P",
  "neuquen": "Q",
  "rio-negro": "R",
  "santa-fe": "S",
  "tucuman": "T",
  "chubut": "U",
  "tierra-del-fuego": "V",
  "corrientes": "W",
  "cordoba": "X",
  "jujuy": "Y",
  "santa-cruz": "Z",
};

/** Igual que public.slugify: minúsculas, sin acentos, guiones. */
export function slugify(txt: string): string {
  return txt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function codigoProvinciaCorreo(provincia: string): string | null {
  const slug = slugify(provincia);
  if (PROVINCIAS_CORREO[slug]) return PROVINCIAS_CORREO[slug];
  if (slug.startsWith("tierra-del-fuego")) return "V";
  return null;
}

/** "2022-04-26 21:16:20" (hora de Argentina) -> ms; null si no se entiende. */
export function venceTokenCorreo(expires: unknown): number | null {
  if (typeof expires !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(expires.trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}-03:00`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Tarifas de /rates: la más barata por tipo de entrega ("D" domicilio, "S"
 * sucursal). deliveryTimeMin/Max no figuran en la documentación de 2022; si
 * vienen, se usan para el plazo.
 */
export function parseRatesCorreo(json: unknown): Partial<Record<Servicio, { precio: number; plazo: string | null }>> {
  const rates = (json as Record<string, unknown> | null)?.rates;
  if (!Array.isArray(rates)) throw new ErrorTransportista("correo rates: falta rates");
  const out: Partial<Record<Servicio, { precio: number; plazo: string | null }>> = {};
  for (const raw of rates) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const servicio: Servicio | null = r.deliveredType === "D" ? "domicilio"
      : r.deliveredType === "S" ? "sucursal" : null;
    const precio = aNumero(r.price);
    if (!servicio || precio === null || precio < 0) continue;
    const actual = out[servicio];
    if (!actual || precio < actual.precio) {
      out[servicio] = { precio: redondear2(precio), plazo: formatearPlazo(r.deliveryTimeMin, r.deliveryTimeMax) };
    }
  }
  return out;
}

/**
 * Sucursales de /agencies (por provincia). La API no ordena por distancia:
 * se toman las activas con retiro y se ordenan por cercanía numérica del CP
 * (aproximación), después por nombre.
 */
export function parseAgenciesCorreo(json: unknown, cpDestino: string): Sucursal[] {
  if (!Array.isArray(json)) throw new ErrorTransportista("correo agencies: se esperaba una lista");
  const destino = Number(cpDestino);
  const candidatas: { s: Sucursal; distancia: number }[] = [];
  for (const raw of json) {
    const a = (raw ?? {}) as Record<string, unknown>;
    const code = typeof a.code === "string" ? a.code.trim() : "";
    if (!code) continue;
    if (a.status !== undefined && a.status !== "ACTIVE") continue;
    const servicios = (a.services ?? {}) as Record<string, unknown>;
    if (servicios.pickupAvailability === false) continue;
    const addr = (((a.location ?? {}) as Record<string, unknown>).address ?? {}) as Record<string, unknown>;
    const calle = [addr.streetName, addr.streetNumber]
      .filter((x) => typeof x === "string" && x.trim() !== "").join(" ");
    const lugar = [addr.locality, addr.city].find((x) => typeof x === "string" && x.trim() !== "");
    const direccion = [calle, lugar].filter((x) => typeof x === "string" && x !== "").join(", ");
    const cp = normalizarCp(typeof addr.postalCode === "string" ? addr.postalCode : "") ?? "";
    candidatas.push({
      s: { id: code, nombre: typeof a.name === "string" && a.name.trim() ? a.name.trim() : code, direccion },
      distancia: cp ? Math.abs(Number(cp) - destino) : Number.POSITIVE_INFINITY,
    });
  }
  return candidatas
    .sort((x, y) => x.distancia - y.distancia || x.s.nombre.localeCompare(y.s.nombre, "es"))
    .slice(0, MAX_SUCURSALES)
    .map((c) => c.s);
}

export function crearCorreoArgentino(
  config: ConfigCorreo,
  cache: CacheTokens,
  ahora: () => number = Date.now,
): Transportista {
  async function token(ctx: Contexto): Promise<string> {
    const c = cache.get("correo_argentino");
    if (c && c.venceMs > ahora()) return c.token;
    const res = await ctx.fetch(`${config.baseUrl}/token`, {
      method: "POST",
      headers: { Authorization: basicAuth(config.usuario, config.password) },
      signal: ctx.signal,
    });
    const json = (await leerJson(res, "correo token")) as Record<string, unknown>;
    if (typeof json.token !== "string" || !json.token) throw new ErrorTransportista("correo token: falta token");
    // Un minuto de margen; como máximo una hora aunque diga más.
    const vence = venceTokenCorreo(json.expires);
    const limite = ahora() + 60 * 60 * 1000;
    cache.set("correo_argentino", {
      token: json.token,
      venceMs: Math.min(vence !== null ? vence - 60_000 : ahora() + 10 * 60 * 1000, limite),
    });
    return json.token;
  }

  return {
    id: "correo_argentino",
    async cotizar(paquete, destino, ctx) {
      const lados = [paquete.alto_cm, paquete.ancho_cm, paquete.largo_cm].map((x) => Math.ceil(x));
      if (paquete.peso_g > CORREO_MAX_PESO_G || lados.some((l) => l > CORREO_MAX_LADO_CM)) {
        throw new ErrorTransportista("correo: el paquete supera el peso o las medidas máximas");
      }
      const tk = await token(ctx);
      const auth = { Authorization: `Bearer ${tk}` };
      const provincia = codigoProvinciaCorreo(destino.provincia);

      const rates = ctx.fetch(`${config.baseUrl}/rates`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: config.customerId,
          postalCodeOrigin: config.cpOrigen,
          postalCodeDestination: destino.cp,
          dimensions: {
            weight: Math.max(1, Math.round(paquete.peso_g)),
            height: lados[0],
            width: lados[1],
            length: lados[2],
          },
        }),
        signal: ctx.signal,
      }).then(async (res) => {
        if (res.status === 401) cache.delete("correo_argentino");
        return parseRatesCorreo(await leerJson(res, "correo rates"));
      });

      const agencias = provincia
        ? ctx.fetch(
          `${config.baseUrl}/agencies?${new URLSearchParams({
            customerId: config.customerId,
            provinceCode: provincia,
            services: "pickup_availability",
          }).toString()}`,
          { headers: auth, signal: ctx.signal },
        ).then(async (res) => parseAgenciesCorreo(await leerJson(res, "correo agencies"), destino.cp))
        : Promise.resolve([] as Sucursal[]);

      const [r, a] = await Promise.allSettled([rates, agencias]);
      if (r.status === "rejected") throw r.reason;
      const opciones: OpcionTransportista[] = [];
      if (r.value.domicilio) {
        opciones.push({ transportista: "correo_argentino", servicio: "domicilio", ...r.value.domicilio });
      }
      if (r.value.sucursal && a.status === "fulfilled") {
        for (const s of a.value) {
          opciones.push({ transportista: "correo_argentino", servicio: "sucursal", ...r.value.sucursal, sucursal: s });
        }
      }
      if (opciones.length === 0) throw new ErrorTransportista("correo: sin opciones para este destino");
      avisarParciales(ctx, "correo_argentino", [a]);
      return opciones;
    },
  };
}

// ----------------------------------------------------------------------------
// Orquestación.
// ----------------------------------------------------------------------------

export function transportistasActivos(
  env: (k: string) => string | undefined,
  cache: CacheTokens,
): Transportista[] {
  const lista: Transportista[] = [];
  const a = configAndreani(env);
  if (a) lista.push(crearAndreani(a, cache));
  const c = configCorreo(env);
  if (c) lista.push(crearCorreoArgentino(c, cache));
  return lista;
}

/**
 * Cotiza con todos los transportistas en paralelo. Cada uno tiene su propio
 * timeout (se aborta su fetch); si falla o tarda, se loguea y se omite.
 */
export async function cotizarTodos(
  transportistas: readonly Transportista[],
  paquete: Paquete,
  destino: Destino,
  opts: { fetch: Fetch; timeoutMs?: number; log?: (msg: string) => void },
): Promise<OpcionTransportista[]> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_TRANSPORTISTA_MS;
  const resultados = await Promise.all(transportistas.map(async (t) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const vencido = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ErrorTransportista(`timeout de ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        t.cotizar(paquete, destino, { fetch: opts.fetch, signal: controller.signal, log: opts.log }),
        vencido,
      ]);
    } catch (e) {
      opts.log?.(`${t.id} omitido: ${motivoDe(e)}`);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }));
  return resultados.flat();
}

// ----------------------------------------------------------------------------
// Respuesta.
// ----------------------------------------------------------------------------

export interface OpcionRespuesta {
  cotizacion_id: string;
  transportista: TransportistaId;
  servicio: Servicio;
  precio: number;
  plazo: string | null;
  /** Vencimiento de la cotización (ISO), tal como lo guardó la base. */
  expira_at: string | null;
  sucursal?: Sucursal;
}

export interface FilaCotizacion {
  id: string;
  cp_destino: string;
  provincia: string;
  transportista: TransportistaId;
  servicio: Servicio;
  sucursal_id: string | null;
  sucursal_detalle: string | null;
  precio: number;
  plazo: string | null;
  items: ItemCotizacion[];
}

/** Filas para cotizaciones_envio (ids generados antes de insertar). */
export function armarFilas(
  opciones: readonly OpcionTransportista[],
  pedido: PedidoCotizacion,
  nuevoId: () => string,
): FilaCotizacion[] {
  return opciones.map((o) => ({
    id: nuevoId(),
    cp_destino: pedido.cp,
    provincia: pedido.provincia,
    transportista: o.transportista,
    servicio: o.servicio,
    sucursal_id: o.sucursal ? o.sucursal.id : null,
    sucursal_detalle: o.sucursal
      ? (o.sucursal.direccion ? `${o.sucursal.nombre} (${o.sucursal.direccion})` : o.sucursal.nombre)
      : null,
    precio: o.precio,
    plazo: o.plazo,
    items: pedido.items,
  }));
}

/**
 * Opciones para la respuesta. `guardadas` son las filas que devolvió el
 * insert ({ id, expira_at }); una opción sin fila guardada se descarta (no se
 * podría usar en crear_pedido).
 */
export function opcionesRespuesta(
  opciones: readonly OpcionTransportista[],
  filas: readonly FilaCotizacion[],
  guardadas: readonly { id: string; expira_at: string | null }[],
): OpcionRespuesta[] {
  const expira = new Map(guardadas.map((g) => [g.id, g.expira_at]));
  const out: OpcionRespuesta[] = [];
  opciones.forEach((o, i) => {
    const id = filas[i]?.id;
    if (!id || !expira.has(id)) return;
    const vence = expira.get(id);
    out.push({
      cotizacion_id: id,
      transportista: o.transportista,
      servicio: o.servicio,
      precio: o.precio,
      plazo: o.plazo,
      expira_at: vence ? new Date(vence).toISOString() : null,
      ...(o.sucursal ? { sucursal: o.sucursal } : {}),
    });
  });
  return out;
}

/** Resultado de public.cotizar_envio -> { precio, nombre } | null. */
export function zonaDeRpc(data: unknown): { precio: number; nombre: string } | null {
  const d = data as Record<string, unknown> | null;
  if (!d || d.disponible !== true) return null;
  const precio = aNumero(d.costo);
  if (precio === null || typeof d.zona_nombre !== "string") return null;
  return { precio, nombre: d.zona_nombre };
}
