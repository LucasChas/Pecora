// ============================================================================
// Pecora — Lógica pura de gestionar-equipo.
//
// Todo lo que no toca la red, la base ni Deno.env vive acá, para poder
// testearlo con Vitest en Node (logica.test.ts). Reutiliza helpers de
// enviar-recibo-pedido (Bearer, validación de emails), que tampoco tienen
// imports remotos.
// ============================================================================

import { esEmailSeguro } from "../enviar-recibo-pedido/logica.ts";

export { bearerToken } from "../enviar-recibo-pedido/logica.ts";

export type Rol = "cliente" | "empleado" | "admin";

export type Accion =
  | { accion: "listar" }
  | { accion: "invitar"; email: string; nombre: string }
  | { accion: "revocar"; userId: string };

/** Error para responder: status HTTP + código estable + mensaje en español. */
export interface ErrorEquipo {
  status: number;
  codigo: string;
  mensaje: string;
}

export function error(status: number, codigo: string, mensaje: string): ErrorEquipo {
  return { status, codigo, mensaje };
}

/**
 * Cuerpo de una respuesta de error. El panel muestra `error` tal cual
 * (src/lib/equipo.ts, mensajeDeError), por eso es el mensaje en español; el
 * código estable va aparte.
 */
export function cuerpoError(e: ErrorEquipo): { ok: false; error: string; codigo: string } {
  return { ok: false, error: e.mensaje, codigo: e.codigo };
}

// ----------------------------------------------------------------------------
// CORS: solo los orígenes del panel (ADMIN_ORIGIN, separados por coma).
// ----------------------------------------------------------------------------

/** "https://a.com/, https://b.com" -> ["https://a.com", "https://b.com"]. */
export function parseOrigenes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter((s) => /^https?:\/\/[^\s/]+$/i.test(s))
    .map((s) => s.toLowerCase());
}

export function origenPermitido(origin: string | null, permitidos: readonly string[]): boolean {
  if (!origin) return false;
  return permitidos.includes(origin.trim().replace(/\/+$/, "").toLowerCase());
}

/**
 * Headers CORS para la respuesta. Solo se refleja el Origin si está en la
 * lista; si no, el navegador bloquea la lectura de la respuesta.
 */
export function corsHeaders(origin: string | null, permitidos: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && origenPermitido(origin, permitidos)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

// ----------------------------------------------------------------------------
// Body.
// ----------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOMBRE_MAX = 80;
export const EMAIL_MAX = 254;

/**
 * Valida el body: { accion: 'listar' } | { accion: 'invitar', email, nombre }
 * | { accion: 'revocar', user_id }. El email se normaliza (trim + minúsculas).
 */
export function parseAccion(body: unknown): Accion | ErrorEquipo {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return error(400, "invalid_body", "El pedido no tiene el formato esperado.");
  }
  const b = body as Record<string, unknown>;

  switch (b.accion) {
    case "listar":
      return { accion: "listar" };

    case "invitar": {
      const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
      const nombre = typeof b.nombre === "string" ? b.nombre.trim().replace(/\s+/g, " ") : "";
      if (!email) return error(400, "missing_email", "Completá el email.");
      if (email.length > EMAIL_MAX || !esEmailSeguro(email)) {
        return error(400, "invalid_email", "El email no parece válido.");
      }
      if (!nombre) return error(400, "missing_nombre", "Completá el nombre.");
      if (nombre.length > NOMBRE_MAX) {
        return error(400, "invalid_nombre", "El nombre es demasiado largo.");
      }
      return { accion: "invitar", email, nombre };
    }

    case "revocar": {
      const userId = typeof b.user_id === "string" ? b.user_id.trim() : "";
      if (!UUID_RE.test(userId)) {
        return error(400, "invalid_user_id", "Falta indicar a quién quitarle el acceso.");
      }
      return { accion: "revocar", userId: userId.toLowerCase() };
    }

    default:
      return error(400, "invalid_accion", "Acción desconocida.");
  }
}

export function esError(x: unknown): x is ErrorEquipo {
  return !!x && typeof x === "object" && "codigo" in x && "status" in x;
}

// ----------------------------------------------------------------------------
// Reglas.
// ----------------------------------------------------------------------------

/** Solo una admin gestiona el equipo. */
export function verificarAdmin(rol: string | null | undefined): ErrorEquipo | null {
  return rol === "admin"
    ? null
    : error(403, "forbidden", "Solo una admin puede gestionar el equipo.");
}

/**
 * Qué hacer al invitar un email:
 *   - no hay cuenta              -> "invitar" (mail de invitación + rol empleado)
 *   - cuenta con rol cliente     -> "promover" (rol empleado, sin mail)
 *   - ya es empleado             -> "sin_cambios"
 *   - es admin                   -> error (no se baja a una admin)
 */
export function decidirInvitacion(
  existente: { id: string; rol: string | null } | null,
): "invitar" | "promover" | "sin_cambios" | ErrorEquipo {
  if (!existente) return "invitar";
  if (existente.rol === "admin") {
    return error(409, "already_admin", "Esa cuenta ya es admin.");
  }
  if (existente.rol === "empleado") return "sin_cambios";
  return "promover";
}

/**
 * Revocar = volver a rol cliente. No se puede con una misma ni con otra admin,
 * y solo tiene sentido con un empleado.
 */
export function validarRevocacion(
  callerId: string,
  objetivo: { id: string; rol: string | null } | null,
): ErrorEquipo | null {
  if (!objetivo) return error(404, "not_found", "Esa cuenta no existe.");
  if (objetivo.id.toLowerCase() === callerId.toLowerCase()) {
    return error(400, "self", "No podés quitarte el acceso a vos misma.");
  }
  if (objetivo.rol === "admin") {
    return error(403, "admin", "No se le puede quitar el acceso a una admin.");
  }
  if (objetivo.rol !== "empleado") {
    return error(409, "not_staff", "Esa cuenta no es parte del equipo.");
  }
  return null;
}

// ----------------------------------------------------------------------------
// Link de la invitación (PUBLIC_ADMIN_URL).
//
// Si el redirect no es una URL válida o no está en la lista de Redirect URLs
// de Supabase Auth, el mail igual sale pero el link lleva a la Site URL (la
// tienda pública) y la invitada nunca llega al panel. Por eso se valida
// estricto ANTES de invitar: https (http solo en localhost / 127.0.0.1), sin
// credenciales, y con el mismo origen que el panel (ADMIN_ORIGIN, que es el
// origen desde el que la admin está usando la función).
// ----------------------------------------------------------------------------

export type RedirectInvitacion =
  | { ok: true; url: string; origen: string }
  | { ok: false; secreto: "PUBLIC_ADMIN_URL" | "ADMIN_ORIGIN"; motivo: string };

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1"]);

function urlSegura(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === "https:") return u;
  if (u.protocol === "http:" && HOSTS_LOCALES.has(u.hostname)) return u;
  return null;
}

/**
 * Valida PUBLIC_ADMIN_URL contra los orígenes del panel (parseOrigenes de
 * ADMIN_ORIGIN). Devuelve la URL sin barra final y su origen, o qué secreto
 * está mal. El motivo solo incluye orígenes, nunca el valor completo.
 */
export function redirectInvitacion(
  raw: string | undefined,
  origenesPanel: readonly string[],
): RedirectInvitacion {
  const texto = (raw ?? "").trim().replace(/\/+$/, "");
  if (!texto) {
    return { ok: false, secreto: "PUBLIC_ADMIN_URL", motivo: "falta el secreto" };
  }
  const url = /\s/.test(texto) ? null : urlSegura(texto);
  if (!url) {
    return {
      ok: false,
      secreto: "PUBLIC_ADMIN_URL",
      motivo: "no es una URL https válida (http solo para localhost / 127.0.0.1)",
    };
  }
  const origen = url.origin.toLowerCase();

  // Se normalizan también los orígenes del panel (ej. puerto por defecto).
  const permitidos = origenesPanel
    .map((o) => urlSegura(o)?.origin.toLowerCase())
    .filter((o): o is string => !!o);
  if (permitidos.length === 0) {
    return {
      ok: false,
      secreto: "ADMIN_ORIGIN",
      motivo: "falta o no tiene ningún origen https válido",
    };
  }
  if (!permitidos.includes(origen)) {
    return {
      ok: false,
      secreto: "PUBLIC_ADMIN_URL",
      motivo: `su origen (${origen}) no coincide con ADMIN_ORIGIN (${permitidos.join(", ")})`,
    };
  }
  return { ok: true, url: texto, origen };
}

/** Error para el panel cuando el link de la invitación está mal configurado. */
export function errorConfigInvitacion(): ErrorEquipo {
  return error(
    500,
    "config_invalida",
    "No se mandó la invitación: la dirección del panel está mal configurada. " +
      "Revisá los secretos PUBLIC_ADMIN_URL y ADMIN_ORIGIN de la función y las Redirect URLs de Supabase Auth.",
  );
}

export interface MiembroEquipo {
  id: string;
  email: string;
  nombre: string | null;
  rol: Rol;
  ultimo_ingreso: string | null;
}

/** Filas de equipo_listar() -> miembros (solo admin y empleado). */
export function armarMiembros(filas: unknown): MiembroEquipo[] {
  if (!Array.isArray(filas)) return [];
  return filas
    .map((f) => (f ?? {}) as Record<string, unknown>)
    .filter((f) => typeof f.id === "string" && (f.rol === "admin" || f.rol === "empleado"))
    .map((f) => ({
      id: f.id as string,
      email: typeof f.email === "string" ? f.email : "",
      nombre: typeof f.nombre === "string" && f.nombre.trim() ? f.nombre : null,
      rol: f.rol as Rol,
      ultimo_ingreso: typeof f.ultimo_ingreso === "string" ? f.ultimo_ingreso : null,
    }));
}

/**
 * ¿El error de inviteUserByEmail es "ya existe una cuenta con ese email"?
 * (carrera: la cuenta se creó entre la búsqueda y la invitación).
 */
export function esEmailYaRegistrado(err: { status?: number; code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "email_exists" || err.code === "user_already_exists") return true;
  return /already (been )?registered|already exists/i.test(err.message ?? "");
}
