// ============================================================================
// Pecora — Envío de mails desde las Edge Functions (Deno).
//
// Qué vía se usa lo decide leerConfigCorreo (correoConfig.ts): SMTP de Gmail
// con contraseña de aplicación si está GMAIL_APP_PASSWORD; si no, la API de
// Gmail con OAuth. Las funciones arman el mensaje MIME completo (encabezados,
// HTML, link de baja) y acá solo se entrega.
//
// Uso:
//   const apertura = await abrirCorreo(Deno.env.get);
//   if (!apertura.ok) ...                     // falta config / OAuth vencido
//   const r = await apertura.correo.enviar(destinatarios, mime);
//   apertura.correo.cerrar();                 // siempre, al terminar
//
// Nunca lanza: los errores vuelven como { ok: false, error } con un texto
// para los logs (sin la contraseña ni tokens).
// ============================================================================

import nodemailer from "npm:nodemailer@6.9.16";
import {
  base64UrlUtf8,
  completarEncabezados,
  type ConfigCorreo,
  explicarErrorSmtp,
  type LeerEnv,
  leerConfigCorreo,
  MENSAJE_FALTAN_SECRETOS,
} from "./correoConfig.ts";

export type ResultadoEnvio = { ok: true } | { ok: false; error: string };

export interface Correo {
  via: ConfigCorreo["via"];
  /** Dirección de GMAIL_SENDER (para armar el encabezado From). */
  remitente: string;
  /** Uno o varios destinatarios (los mismos que van en el encabezado To). */
  enviar(destinatarios: string | readonly string[], mime: string): Promise<ResultadoEnvio>;
  cerrar(): void;
}

export type AperturaCorreo =
  | { ok: true; correo: Correo }
  | { ok: false; motivo: "sin_configurar" | "oauth_vencido"; detalle: string };

/** Tope por llamada: una respuesta colgada no deja la función esperando. */
const TIMEOUT_MS = 15_000;

function conTimeout(init: RequestInit = {}): RequestInit {
  return { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) };
}

// ---- SMTP (contraseña de aplicación) ----------------------------------------

export function correoSmtp(
  config: Extract<ConfigCorreo, { via: "smtp" }>,
  // Solo para pruebas locales contra un servidor con certificado propio.
  tls?: { rejectUnauthorized: boolean },
): Correo {
  // Una sola conexión reutilizada para todos los mails de la invocación.
  const transporte = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: true,
    pool: true,
    maxConnections: 1,
    auth: { user: config.usuario, pass: config.contrasena },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
    ...(tls ? { tls } : {}),
  });
  return {
    via: "smtp",
    remitente: config.remitente,
    async enviar(destinatarios, mime) {
      try {
        // El mensaje ya viene armado: se manda tal cual ("raw"). El sobre
        // SMTP lleva el remitente y los destinatarios reales.
        await transporte.sendMail({
          envelope: {
            from: config.remitente,
            to: typeof destinatarios === "string" ? [destinatarios] : [...destinatarios],
          },
          raw: completarEncabezados(mime, config.remitente, new Date(), crypto.randomUUID()),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `SMTP ${explicarErrorSmtp(err)}` };
      }
    },
    cerrar() {
      transporte.close();
    },
  };
}

// ---- API de Gmail (OAuth) ----------------------------------------------------

async function pedirAccessToken(
  config: Extract<ConfigCorreo, { via: "gmail_api" }>,
): Promise<{ token: string } | { error: string }> {
  try {
    const res = await fetch(
      "https://oauth2.googleapis.com/token",
      conTimeout({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: config.refreshToken,
        }).toString(),
      }),
    );
    if (!res.ok) return { error: `Google respondió ${res.status}: ${await res.text()}` };
    const data = await res.json();
    if (!data || typeof data.access_token !== "string" || !data.access_token) {
      return { error: "respuesta de Google sin access_token" };
    }
    return { token: data.access_token };
  } catch (err) {
    return { error: `excepción llamando a oauth2.googleapis.com: ${String(err)}` };
  }
}

function correoGmailApi(remitente: string, accessToken: string): Correo {
  return {
    via: "gmail_api",
    remitente,
    async enviar(_destinatarios, mime) {
      try {
        const res = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          conTimeout({
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ raw: base64UrlUtf8(mime) }),
          }),
        );
        if (!res.ok) return { ok: false, error: `Gmail API respondió ${res.status}: ${await res.text()}` };
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `excepción llamando a Gmail API: ${String(err)}` };
      }
    },
    cerrar() {},
  };
}

// ---- Apertura ----------------------------------------------------------------

export async function abrirCorreo(env: LeerEnv): Promise<AperturaCorreo> {
  const config = leerConfigCorreo(env);
  if (!config) return { ok: false, motivo: "sin_configurar", detalle: MENSAJE_FALTAN_SECRETOS };
  if (config.via === "smtp") return { ok: true, correo: correoSmtp(config) };

  const acceso = await pedirAccessToken(config);
  if ("error" in acceso) {
    return {
      ok: false,
      motivo: "oauth_vencido",
      detalle:
        `no se pudo renovar el acceso a Gmail (${acceso.error}). Si dice "invalid_grant", el ` +
        `refresh token venció (la app de Google Cloud en modo "Testing" lo vence a los 7 días). ` +
        `Arreglo recomendado: pasar a contraseña de aplicación (GMAIL_APP_PASSWORD), ver ` +
        `supabase/functions/README.md.`,
    };
  }
  return { ok: true, correo: correoGmailApi(config.remitente, acceso.token) };
}
