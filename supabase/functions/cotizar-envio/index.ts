// ============================================================================
// Pecora — Edge Function: cotizar-envio
//
// Cotiza el envío del carrito con Andreani y Correo Argentino (MiCorreo) y
// guarda cada opción en public.cotizaciones_envio (vence a los 30 min). El
// checkout manda el id elegido a crear_pedido (p_cotizacion_envio), que toma
// el precio de esa fila: el navegador nunca decide el costo.
//
// POST con el JWT de la sesión (el checkout exige cuenta):
//   { cp: "5000" | "X5000ABC", provincia: "Córdoba",
//     items: [{ producto_id: uuid, cantidad: 1..99 }] }   (1 a 50 ítems)
//   -> 200 { opciones: [{ cotizacion_id, transportista, servicio, precio,
//                          plazo, expira_at, sucursal?: { id, nombre, direccion } }],
//            zona: { precio, nombre } | null,
//            transportistas_activos: string[] }
//      Envío a sucursal: una opción por sucursal (hasta 5), cada una con su
//      cotizacion_id. Si un transportista falla o tarda más de 5 s, se omite.
//      `zona` es la tarifa por zona de siempre (cotizar_envio), como respaldo.
// GET ?estado=1 (alcanza la anon key) -> 200 { transportistas_activos: string[] }
// Errores: { error: <mensaje en español>, codigo } con 400/401/403/405/429/500.
//
// Límite: 20 pedidos por minuto por IP, en memoria de cada instancia (best
// effort: se reinicia con la instancia y no se comparte entre instancias).
//
// CORS: orígenes de CATALOG_ORIGIN y ADMIN_ORIGIN (separados por coma). Un
// navegador en otro origen recibe 403.
//
// La lógica pura está en logica.ts, con tests en logica.test.ts.
// Secretos: ver supabase/functions/README.md (sección cotizar-envio).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  armarFilas,
  armarPaquete,
  type CacheTokens,
  corsHeaders,
  cotizarTodos,
  crearLimitador,
  cuerpoError,
  error,
  type ErrorCotizacion,
  esError,
  ipDeRequest,
  leerDefaults,
  opcionesRespuesta,
  origenesPermitidos,
  origenPermitido,
  parsePedido,
  type ProductoEnvio,
  transportistasActivos,
  zonaDeRpc,
} from "./logica.ts";

const LOG_PREFIX = "[cotizar-envio]";

// Estado por instancia (se pierde al reciclarla).
const tokens: CacheTokens = new Map();
const permitir = crearLimitador(20, 60_000);

const env = (k: string) => Deno.env.get(k);

Deno.serve(async (req: Request) => {
  const permitidos = origenesPermitidos(env("CATALOG_ORIGIN"), env("ADMIN_ORIGIN"));
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin, permitidos);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  const fallo = (e: ErrorCotizacion) => json(cuerpoError(e), e.status);

  if (origin && !origenPermitido(origin, permitidos)) {
    if (permitidos.length === 0) {
      console.error(`${LOG_PREFIX} falta el secreto CATALOG_ORIGIN: se rechazan todos los navegadores`);
    }
    return fallo(error(403, "origin_not_allowed", "Origen no permitido."));
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return fallo(error(405, "method_not_allowed", "Método no permitido."));
  }

  if (!permitir(ipDeRequest(req.headers))) {
    return fallo(error(429, "rate_limited", "Hiciste muchas consultas seguidas. Esperá un minuto y volvé a intentar."));
  }

  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`${LOG_PREFIX} faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY`);
    return fallo(error(500, "missing_supabase_env", "La función no está configurada."));
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const transportistas = transportistasActivos(env, tokens);
  const activos = transportistas.map((t) => t.id);

  // GET ?estado=1: solo qué transportistas están configurados (sin secretos).
  // Alcanza con la anon key (la plataforma verifica el JWT antes).
  if (req.method === "GET") {
    if (new URL(req.url).searchParams.get("estado") !== "1") {
      return fallo(error(400, "invalid_query", "Consulta no válida."));
    }
    return json({ transportistas_activos: activos });
  }

  // ---- POST. Se puede comprar sin cuenta (migración *_compra_invitada), así
  // que alcanza con la anon key: la plataforma ya verificó el JWT antes de
  // llegar acá. La cotización solo devuelve precios; no expone datos.

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fallo(error(400, "invalid_body", "El pedido no tiene el formato esperado."));
    }
    const pedido = parsePedido(body);
    if (esError(pedido)) return fallo(pedido);

    const { data: productos, error: errProd } = await supabase
      .from("productos")
      .select("id, precio, peso_g, alto_cm, ancho_cm, largo_cm")
      .in("id", pedido.items.map((i) => i.producto_id));
    if (errProd) throw new Error(`leyendo productos: ${errProd.message}`);

    const paquete = armarPaquete(pedido.items, (productos ?? []) as ProductoEnvio[], leerDefaults(env));
    if (esError(paquete)) return fallo(paquete);

    const destino = { cp: pedido.cp, provincia: pedido.provincia };
    const [opciones, zonaRpc] = await Promise.all([
      cotizarTodos(transportistas, paquete, destino, {
        fetch: (input, init) => fetch(input, init),
        log: (msg) => console.warn(`${LOG_PREFIX} ${msg}`),
      }),
      supabase.rpc("cotizar_envio", {
        p_provincia: pedido.provincia,
        p_cp: pedido.cpOriginal,
        p_subtotal: paquete.valor_declarado,
      }),
    ]);
    if (zonaRpc.error) console.warn(`${LOG_PREFIX} cotizar_envio falló: ${zonaRpc.error.message}`);
    const zona = zonaRpc.error ? null : zonaDeRpc(zonaRpc.data);

    const filas = armarFilas(opciones, pedido, () => crypto.randomUUID());
    let guardadas: { id: string; expira_at: string | null }[] = [];
    if (filas.length > 0) {
      const { data: ins, error: errIns } = await supabase
        .from("cotizaciones_envio")
        .insert(filas)
        .select("id, expira_at");
      if (errIns) {
        // Sin fila guardada la opción no se puede usar en crear_pedido.
        console.error(`${LOG_PREFIX} guardando cotizaciones: ${errIns.message}`);
      } else {
        guardadas = (ins ?? []) as typeof guardadas;
      }
    }
    const respuesta = opcionesRespuesta(opciones, filas, guardadas);

    // Limpieza ocasional de cotizaciones viejas sin usar (best effort).
    if (Math.random() < 0.02) {
      const hace1Dia = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { error: errDel } = await supabase
        .from("cotizaciones_envio")
        .delete()
        .lt("expira_at", hace1Dia)
        .is("usada_at", null);
      if (errDel) console.warn(`${LOG_PREFIX} limpieza de cotizaciones: ${errDel.message}`);
    }

    return json({ opciones: respuesta, zona, transportistas_activos: activos });
  } catch (err) {
    console.error(`${LOG_PREFIX} error inesperado:`, err instanceof Error ? err.message : err);
    return fallo(error(500, "internal_error", "No pudimos cotizar el envío. Probá de nuevo en un rato."));
  }
});
