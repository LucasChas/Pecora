// ============================================================================
// Pecora — Configuración del envío de mails (lógica pura, sin imports de Deno:
// la testea Vitest en correoConfig.test.ts).
//
// Dos formas de mandar, desde la misma cuenta de Gmail:
//   * SMTP con "contraseña de aplicación" (GMAIL_APP_PASSWORD). La preferida:
//     no vence (salvo que se cambie la contraseña de Google o se borre la
//     contraseña de aplicación). Hasta ~500 mails por día.
//   * API de Gmail con OAuth (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET /
//     GMAIL_REFRESH_TOKEN). Queda como respaldo: si la app de Google Cloud
//     está en modo "Testing", el refresh token vence cada 7 días.
// Si están las dos, se usa SMTP. En ambos casos el remitente es GMAIL_SENDER.
// ============================================================================

export type ConfigCorreo =
  | {
      via: "smtp";
      remitente: string;
      host: string;
      port: number;
      usuario: string;
      contrasena: string;
    }
  | {
      via: "gmail_api";
      remitente: string;
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    };

export type LeerEnv = (nombre: string) => string | undefined;

/** Lo que falta configurar, para el log (nunca incluye valores). */
export const MENSAJE_FALTAN_SECRETOS =
  "faltan los secretos de mail: GMAIL_SENDER y GMAIL_APP_PASSWORD (contraseña de aplicación " +
  "de Google), o GMAIL_SENDER + GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN (OAuth). " +
  "Ver supabase/functions/README.md.";

function limpio(valor: string | undefined): string {
  return (valor ?? "").trim();
}

/**
 * Elige cómo mandar según los secretos cargados. null = no hay forma (falta
 * el remitente o las credenciales).
 */
export function leerConfigCorreo(env: LeerEnv): ConfigCorreo | null {
  const remitente = limpio(env("GMAIL_SENDER"));
  if (!remitente) return null;

  // Google muestra la contraseña de aplicación en grupos ("abcd efgh ijkl
  // mnop"): se aceptan con o sin espacios.
  const contrasena = limpio(env("GMAIL_APP_PASSWORD")).replace(/\s+/g, "");
  if (contrasena) {
    const puerto = Number(limpio(env("SMTP_PORT")) || 465);
    return {
      via: "smtp",
      remitente,
      host: limpio(env("SMTP_HOST")) || "smtp.gmail.com",
      // Supabase bloquea las conexiones salientes a los puertos 25 y 587: se
      // usa 465 (TLS directo).
      port: Number.isInteger(puerto) && puerto > 0 ? puerto : 465,
      usuario: limpio(env("SMTP_USER")) || remitente,
      contrasena,
    };
  }

  const clientId = limpio(env("GMAIL_CLIENT_ID"));
  const clientSecret = limpio(env("GMAIL_CLIENT_SECRET"));
  const refreshToken = limpio(env("GMAIL_REFRESH_TOKEN"));
  if (clientId && clientSecret && refreshToken) {
    return { via: "gmail_api", remitente, clientId, clientSecret, refreshToken };
  }
  return null;
}

/** Texto (UTF-8) a base64url, como lo pide la API de Gmail. */
export function base64UrlUtf8(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mensaje de error de SMTP sin datos sensibles y con la pista más común. */
export function explicarErrorSmtp(error: unknown): string {
  const e = (error ?? {}) as { code?: string; responseCode?: number; message?: string };
  const base = `${e.code ?? "error"}${e.responseCode ? ` ${e.responseCode}` : ""}: ${e.message ?? String(error)}`;
  if (e.code === "EAUTH" || e.responseCode === 535 || e.responseCode === 534) {
    return (
      `${base} — Gmail rechazó el usuario o la contraseña de aplicación. Revisar que ` +
      `GMAIL_SENDER sea la cuenta que creó la contraseña y que GMAIL_APP_PASSWORD esté ` +
      `bien copiada (16 letras), y que la verificación en dos pasos siga activa.`
    );
  }
  return base;
}

/**
 * Agrega Date y Message-ID si el mensaje no los trae. La API de Gmail los
 * pone sola; por SMTP hay que mandarlos (sin ellos el mail tiene más chances
 * de ir a spam).
 */
export function completarEncabezados(mime: string, remitente: string, fecha: Date, id: string): string {
  const fin = mime.indexOf("\r\n\r\n");
  const encabezados = fin === -1 ? mime : mime.slice(0, fin);
  const extra: string[] = [];
  if (!/^date:/im.test(encabezados)) extra.push(`Date: ${fecha.toUTCString().replace("GMT", "+0000")}`);
  if (!/^message-id:/im.test(encabezados)) {
    const dominio = remitente.split("@")[1] || "localhost";
    extra.push(`Message-ID: <${id}@${dominio}>`);
  }
  return extra.length ? `${extra.join("\r\n")}\r\n${mime}` : mime;
}
