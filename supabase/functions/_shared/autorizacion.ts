// ============================================================================
// Pecora — ¿La llamada viene de la base (trigger) y no de cualquiera?
//
// Las funciones de mail las invoca la base (pg_net) con el secreto de Vault
// 'pecora_email_function_token', que tiene que ser la service_role key.
//
// Antes se comparaba ese token con SUPABASE_SERVICE_ROLE_KEY carácter por
// carácter. Con las claves nuevas de Supabase, la variable que recibe la
// función puede ser otra versión de la service_role que la que se copia del
// dashboard, y entonces toda llamada daba 401 aunque la clave fuera correcta.
//
// Ahora se acepta si:
//   1) es igual a SUPABASE_SERVICE_ROLE_KEY (como antes), o
//   2) es un JWT con role "service_role" Y Supabase lo confirma: se llama a un
//      endpoint de administración de Auth que solo responde a una service_role
//      válida (firma incluida). Así no alcanza con fabricar un token.
// La anon key (pública, está en el front) tiene role "anon": se rechaza.
//
// Sin imports de Deno: los tests (Vitest) le pasan un fetch simulado.
// ============================================================================

export type LeerEnv = (nombre: string) => string | undefined;

export type ResultadoAutorizacion =
  | { ok: true; via: "clave_igual" | "verificada" }
  | { ok: false; motivo: string };

const TIMEOUT_MS = 10_000;
const VIGENCIA_MS = 10 * 60_000;

// Última clave verificada (como hash) y hasta cuándo vale: varias llamadas
// seguidas a la misma instancia no repiten la consulta a Auth.
let verificada: { hash: string; hasta: number } | null = null;

async function sha256(texto: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

/** Comparación en tiempo constante (sobre los SHA-256). */
export async function iguales(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** El "role" del payload de un JWT, sin verificar la firma. null si no es un JWT. */
export function rolDelJwt(token: string): string | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** Solo para los tests. */
export function olvidarVerificacion(): void {
  verificada = null;
}

export async function esLlamadaInterna(
  token: string,
  env: LeerEnv,
  fetchFn: typeof fetch = fetch,
  ahora: () => number = Date.now,
): Promise<ResultadoAutorizacion> {
  const clave = env("SUPABASE_SERVICE_ROLE_KEY");
  if (clave && (await iguales(token, clave))) return { ok: true, via: "clave_igual" };

  const rol = rolDelJwt(token);
  if (rol !== "service_role") {
    return {
      ok: false,
      motivo: `el token no es la service_role key (role: ${rol ?? "no es un JWT"}). Revisar el secreto de Vault 'pecora_email_function_token'.`,
    };
  }

  const hash = Array.from(await sha256(token), (b) => b.toString(16).padStart(2, "0")).join("");
  if (verificada && verificada.hash === hash && verificada.hasta > ahora()) {
    return { ok: true, via: "verificada" };
  }

  const url = (env("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!url) return { ok: false, motivo: "falta SUPABASE_URL para verificar el token" };
  try {
    const res = await fetchFn(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: false,
        motivo: `Supabase no aceptó el token como service_role (${res.status}). Revisar el secreto de Vault 'pecora_email_function_token'.`,
      };
    }
  } catch (err) {
    return { ok: false, motivo: `no se pudo verificar el token con Supabase: ${String(err)}` };
  }
  verificada = { hash, hasta: ahora() + VIGENCIA_MS };
  return { ok: true, via: "verificada" };
}
