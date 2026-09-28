import { describe, expect, it, vi } from "vitest";
import {
  armarFilas,
  armarPaquete,
  codigoProvinciaCorreo,
  configAndreani,
  configCorreo,
  corsHeaders,
  cotizarTodos,
  crearAndreani,
  crearCorreoArgentino,
  crearLimitador,
  DEFAULTS,
  esError,
  type Fetch,
  formatearPlazo,
  ipDeRequest,
  leerDefaults,
  normalizarCp,
  opcionesRespuesta,
  origenesPermitidos,
  type Paquete,
  parseAgenciesCorreo,
  parsePedido,
  parseRatesCorreo,
  parseSucursalesAndreani,
  parseTarifaAndreani,
  type Transportista,
  transportistasActivos,
  venceTokenCorreo,
  zonaDeRpc,
} from "./logica";

const P1 = "b5000000-0000-4000-8000-000000000001";
const P2 = "a5000000-0000-4000-8000-000000000002";

const envDe = (vars: Record<string, string>) => (k: string) => vars[k];

// ---- Fixtures con la forma documentada de cada API -------------------------

// Andreani GET /v1/tarifas (plugin oficial de Magento lee tarifaConIva.total).
const TARIFA_ANDREANI = {
  pesoAforado: "1.5",
  tarifaSinIva: { seguroDistribucion: "10.00", distribucion: "3561.98", total: "3571.98" },
  tarifaConIva: { seguroDistribucion: "12.10", distribucion: "4310.00", total: "4322.10" },
};

// Andreani GET /v2/sucursales.
const SUCURSALES_ANDREANI = [
  {
    id: "123",
    descripcion: "Córdoba Centro",
    direccion: { calle: "Av. Colón", numero: "100", localidad: "Córdoba", provincia: "Córdoba", codigoPostal: "5000" },
  },
  {
    id: 456,
    descripcion: "Córdoba Norte",
    direccion: { calle: "Monseñor Pablo Cabrera", numero: "2000", localidad: "Córdoba", codigoPostal: "5008" },
  },
];

// MiCorreo POST /rates (sin deliveredType: devuelve las dos).
const RATES_CORREO = {
  customerId: "0000550997",
  validTo: "2022-06-07T10:31:27.881-03:00",
  rates: [
    { deliveredType: "D", productType: "CP", productName: "Paq.ar Clásico", price: 498.06 },
    { deliveredType: "S", productType: "CP", productName: "Paq.ar Clásico", price: 398.06 },
  ],
};

// MiCorreo GET /agencies.
function agencia(code: string, name: string, postalCode: string, extra: Record<string, unknown> = {}) {
  return {
    code,
    name,
    services: { packageReception: true, pickupAvailability: true },
    location: {
      address: {
        streetName: "Calle", streetNumber: "1", locality: name, city: "Ciudad",
        province: "Córdoba", provinceCode: "X", postalCode,
      },
      latitude: "-31.4", longitude: "-64.1",
    },
    status: "ACTIVE",
    ...extra,
  };
}

const PAQUETE: Paquete = { peso_g: 1500, alto_cm: 10, ancho_cm: 20, largo_cm: 30, valor_declarado: 12000 };
const DESTINO = { cp: "5000", provincia: "Córdoba" };

function respuesta(body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

/** fetch falso: responde según el path; guarda cada llamada. */
function fakeFetch(rutas: Record<string, () => Response | Promise<Response>>) {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  const f: Fetch = async (url, init) => {
    llamadas.push({ url, init });
    const path = new URL(url).pathname;
    const clave = Object.keys(rutas).find((k) => path.endsWith(k));
    if (!clave) return new Response("not found", { status: 404 });
    return rutas[clave]();
  };
  return { f, llamadas };
}

const ctx = (f: Fetch) => ({ fetch: f, signal: new AbortController().signal });

// ---------------------------------------------------------------------------

describe("normalizarCp", () => {
  it("acepta 4 dígitos y el CPA", () => {
    expect(normalizarCp("5000")).toBe("5000");
    expect(normalizarCp(" x5000abc ")).toBe("5000");
    expect(normalizarCp("B1842ZAB")).toBe("1842");
  });
  it("rechaza lo demás", () => {
    for (const cp of ["500", "50000", "X5000AB", "5000ABC", "", "abcd", null, 5000]) {
      expect(normalizarCp(cp)).toBeNull();
    }
  });
});

describe("parsePedido", () => {
  const base = { cp: "X5000ABC", provincia: " Córdoba ", items: [{ producto_id: P1, cantidad: 1 }] };

  it("normaliza CP, provincia e ítems (agrupa y ordena)", () => {
    const r = parsePedido({
      ...base,
      items: [
        { producto_id: P1.toUpperCase(), cantidad: 1 },
        { producto_id: P2, cantidad: 3 },
        { producto_id: P1, cantidad: 2 },
      ],
    });
    expect(r).toEqual({
      cp: "5000",
      cpOriginal: "X5000ABC",
      provincia: "Córdoba",
      items: [{ producto_id: P2, cantidad: 3 }, { producto_id: P1, cantidad: 3 }],
    });
  });

  it.each([
    [null, "invalid_body"],
    [[], "invalid_body"],
    [{ ...base, cp: "123" }, "invalid_cp"],
    [{ ...base, provincia: "" }, "invalid_provincia"],
    [{ ...base, provincia: "x".repeat(61) }, "invalid_provincia"],
    [{ ...base, items: [] }, "invalid_items"],
    [{ ...base, items: "x" }, "invalid_items"],
    [{ ...base, items: Array.from({ length: 51 }, () => ({ producto_id: P1, cantidad: 1 })) }, "invalid_items"],
    [{ ...base, items: [{ producto_id: "no-uuid", cantidad: 1 }] }, "invalid_items"],
    [{ ...base, items: [{ producto_id: P1, cantidad: 0 }] }, "invalid_items"],
    [{ ...base, items: [{ producto_id: P1, cantidad: 100 }] }, "invalid_items"],
    [{ ...base, items: [{ producto_id: P1, cantidad: 1.5 }] }, "invalid_items"],
    [{ ...base, items: [{ producto_id: P1, cantidad: "2" }] }, "invalid_items"],
  ])("rechaza %j", (body, codigo) => {
    const r = parsePedido(body);
    expect(esError(r) && r.codigo).toBe(codigo);
    expect(esError(r) && r.status).toBe(400);
  });

  it("acepta 50 ítems y cantidad 99", () => {
    const items = Array.from({ length: 50 }, () => ({ producto_id: P1, cantidad: 99 }));
    expect(esError(parsePedido({ ...base, items }))).toBe(false);
  });
});

describe("armarPaquete", () => {
  const productos = [
    { id: P1, precio: "1000.50", peso_g: 200, alto_cm: "5.5", ancho_cm: null, largo_cm: 40 },
    { id: P2, precio: 500, peso_g: null, alto_cm: null, ancho_cm: null, largo_cm: null },
  ];

  it("suma pesos, toma el máximo de cada lado y el subtotal", () => {
    const r = armarPaquete(
      [{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 3 }],
      productos,
      DEFAULTS,
    );
    expect(r).toEqual({
      peso_g: 200 * 2 + DEFAULTS.peso_g * 3,
      alto_cm: DEFAULTS.alto_cm, // max(5.5, default 10)
      ancho_cm: DEFAULTS.ancho_cm,
      largo_cm: 40,
      valor_declarado: 3501,
    });
  });

  it("falla si un producto ya no existe", () => {
    const r = armarPaquete([{ producto_id: "c0000000-0000-4000-8000-000000000000", cantidad: 1 }], productos, DEFAULTS);
    expect(esError(r) && r.codigo).toBe("producto_no_disponible");
  });

  it("leerDefaults usa los secretos válidos y si no los defaults", () => {
    expect(leerDefaults(envDe({ DEFAULT_PESO_G: "500", DEFAULT_ALTO_CM: "-1", DEFAULT_LARGO_CM: "x" }))).toEqual({
      ...DEFAULTS,
      peso_g: 500,
    });
  });
});

describe("CORS y origen", () => {
  const permitidos = origenesPermitidos("https://tienda.com/, https://www.tienda.com", "https://panel.tienda.com");

  it("une catálogo y panel sin repetidos", () => {
    expect(permitidos).toEqual(["https://tienda.com", "https://www.tienda.com", "https://panel.tienda.com"]);
    expect(origenesPermitidos("https://a.com", "https://a.com")).toEqual(["https://a.com"]);
  });
  it("refleja solo orígenes permitidos", () => {
    expect(corsHeaders("https://tienda.com", permitidos)["Access-Control-Allow-Origin"]).toBe("https://tienda.com");
    expect(corsHeaders("https://tienda.com", permitidos)["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS");
    expect(corsHeaders("https://malo.com", permitidos)).toEqual({ Vary: "Origin" });
    expect(corsHeaders(null, permitidos)).toEqual({ Vary: "Origin" });
  });
});

describe("límite por IP", () => {
  it("permite 20 por minuto y reinicia la ventana", () => {
    let t = 0;
    const permitir = crearLimitador(20, 60_000, () => t);
    for (let i = 0; i < 20; i++) expect(permitir("1.1.1.1")).toBe(true);
    expect(permitir("1.1.1.1")).toBe(false);
    expect(permitir("2.2.2.2")).toBe(true);
    t = 60_000;
    expect(permitir("1.1.1.1")).toBe(true);
  });
  it("toma la primera IP de x-forwarded-for", () => {
    expect(ipDeRequest(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(ipDeRequest(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(ipDeRequest(new Headers())).toBe("desconocida");
  });
});

describe("configuración de transportistas", () => {
  it("sin secretos no hay transportistas", () => {
    expect(configAndreani(envDe({}))).toBeNull();
    expect(configCorreo(envDe({}))).toBeNull();
    expect(transportistasActivos(envDe({}), new Map())).toEqual([]);
  });
  it("Andreani necesita cliente y al menos un contrato", () => {
    expect(configAndreani(envDe({ ANDREANI_CLIENTE: "CL1" }))).toBeNull();
    expect(configAndreani(envDe({ ANDREANI_CONTRATO_DOMICILIO: "1" }))).toBeNull();
    expect(configAndreani(envDe({ ANDREANI_CLIENTE: "CL1", ANDREANI_CONTRATO_SUCURSAL: "2" }))).toMatchObject({
      baseUrl: "https://apis.andreani.com",
      contratoDomicilio: null,
      contratoSucursal: "2",
    });
  });
  it("Correo necesita usuario, contraseña, customerId y un ORIGEN_CP válido", () => {
    const completo = { CORREO_USER: "u", CORREO_PASSWORD: "p", CORREO_CUSTOMER_ID: "0001", ORIGEN_CP: "X5000ABC" };
    expect(configCorreo(envDe(completo))).toMatchObject({ cpOrigen: "5000" });
    expect(configCorreo(envDe({ ...completo, ORIGEN_CP: "5" }))).toBeNull();
    expect(configCorreo(envDe({ ...completo, CORREO_PASSWORD: " " }))).toBeNull();
  });
  it("transportistasActivos devuelve solo los configurados", () => {
    const ids = transportistasActivos(
      envDe({ CORREO_USER: "u", CORREO_PASSWORD: "p", CORREO_CUSTOMER_ID: "1", ORIGEN_CP: "5000" }),
      new Map(),
    ).map((t) => t.id);
    expect(ids).toEqual(["correo_argentino"]);
  });
});

describe("parseo de respuestas", () => {
  it("Andreani tarifa: objeto con total o número", () => {
    expect(parseTarifaAndreani(TARIFA_ANDREANI)).toEqual({ precio: 4322.1, plazo: null });
    expect(parseTarifaAndreani({ tarifaConIva: 1500, plazoEntrega: { minimo: 2, maximo: 4 } }))
      .toEqual({ precio: 1500, plazo: "2 a 4 días hábiles" });
    expect(() => parseTarifaAndreani({ tarifaSinIva: { total: "1" } })).toThrow();
    expect(() => parseTarifaAndreani(null)).toThrow();
  });
  it("Andreani sucursales", () => {
    expect(parseSucursalesAndreani(SUCURSALES_ANDREANI)).toEqual([
      { id: "123", nombre: "Córdoba Centro", direccion: "Av. Colón 100, Córdoba, Córdoba" },
      { id: "456", nombre: "Córdoba Norte", direccion: "Monseñor Pablo Cabrera 2000, Córdoba" },
    ]);
    const muchas = Array.from({ length: 8 }, (_, i) => ({ id: String(i), descripcion: `S${i}` }));
    expect(parseSucursalesAndreani(muchas)).toHaveLength(5);
    expect(() => parseSucursalesAndreani({})).toThrow();
  });
  it("Correo rates: la más barata por tipo", () => {
    expect(parseRatesCorreo(RATES_CORREO)).toEqual({
      domicilio: { precio: 498.06, plazo: null },
      sucursal: { precio: 398.06, plazo: null },
    });
    expect(parseRatesCorreo({
      rates: [
        { deliveredType: "D", price: 900, deliveryTimeMin: "2", deliveryTimeMax: "5" },
        { deliveredType: "D", price: 700, deliveryTimeMin: 3, deliveryTimeMax: 3 },
        { deliveredType: "X", price: 1 },
      ],
    })).toEqual({ domicilio: { precio: 700, plazo: "3 días hábiles" } });
    expect(() => parseRatesCorreo({ code: "402", message: "Cliente FAP no identificado" })).toThrow();
  });
  it("Correo agencies: activas con retiro, más cercanas por CP, hasta 5", () => {
    const lista = [
      agencia("X0003", "Lejos", "X5800AAA"),
      agencia("X0001", "Centro", "X5000AAA"),
      agencia("X0002", "Cerca", "X5001AAA"),
      agencia("X0004", "Inactiva", "X5000AAA", { status: "INACTIVE" }),
      agencia("X0005", "Sin retiro", "X5000AAA", { services: { pickupAvailability: false } }),
      agencia("X0006", "A", "X5100AAA"),
      agencia("X0007", "B", "X5200AAA"),
      agencia("X0008", "C", "X5300AAA"),
    ];
    const r = parseAgenciesCorreo(lista, "5000");
    expect(r.map((s) => s.id)).toEqual(["X0001", "X0002", "X0006", "X0007", "X0008"]);
    expect(r[0]).toEqual({ id: "X0001", nombre: "Centro", direccion: "Calle 1, Centro" });
  });
  it("códigos de provincia de MiCorreo", () => {
    expect(codigoProvinciaCorreo("Córdoba")).toBe("X");
    expect(codigoProvinciaCorreo("Ciudad Autónoma de Buenos Aires")).toBe("C");
    expect(codigoProvinciaCorreo("Tierra del Fuego, Antártida e Islas del Atlántico Sur")).toBe("V");
    expect(codigoProvinciaCorreo("Narnia")).toBeNull();
  });
  it("vencimiento del token de MiCorreo (hora de Argentina)", () => {
    expect(venceTokenCorreo("2022-04-26 21:16:20")).toBe(Date.parse("2022-04-27T00:16:20Z"));
    expect(venceTokenCorreo("mañana")).toBeNull();
  });
  it("formatearPlazo", () => {
    expect(formatearPlazo(1, 1)).toBe("1 día hábil");
    expect(formatearPlazo(5, 2)).toBe("2 a 5 días hábiles");
    expect(formatearPlazo(undefined, undefined)).toBeNull();
  });
  it("zona de cotizar_envio", () => {
    expect(zonaDeRpc({ disponible: true, costo: 1500, zona_nombre: "Córdoba" })).toEqual({ precio: 1500, nombre: "Córdoba" });
    expect(zonaDeRpc({ disponible: false, costo: 0, zona_nombre: null })).toBeNull();
    expect(zonaDeRpc(null)).toBeNull();
  });
});

describe("adaptador Andreani", () => {
  const config = configAndreani(envDe({
    ANDREANI_CLIENTE: "CL0001",
    ANDREANI_CONTRATO_DOMICILIO: "300001",
    ANDREANI_CONTRATO_SUCURSAL: "300002",
    ANDREANI_SUCURSAL_ORIGEN: "COR",
    ANDREANI_USUARIO: "user",
    ANDREANI_PASSWORD: "secret",
  }))!;

  it("hace login, cotiza domicilio y una opción por sucursal", async () => {
    const { f, llamadas } = fakeFetch({
      "/login": () => new Response("", { status: 200, headers: { "x-authorization-token": "TK" } }),
      "/v1/tarifas": () => respuesta(TARIFA_ANDREANI),
      "/v2/sucursales": () => respuesta(SUCURSALES_ANDREANI),
    });
    const cache = new Map();
    const r = await crearAndreani(config, cache).cotizar(PAQUETE, DESTINO, ctx(f));
    expect(r.map((o) => [o.servicio, o.precio, o.sucursal?.id ?? null])).toEqual([
      ["domicilio", 4322.1, null],
      ["sucursal", 4322.1, "123"],
      ["sucursal", 4322.1, "456"],
    ]);

    const login = llamadas.find((l) => l.url.endsWith("/login"))!;
    expect((login.init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("user:secret")}`);
    const tarifa = new URL(llamadas.find((l) => l.url.includes("/v1/tarifas"))!.url);
    expect(Object.fromEntries(tarifa.searchParams)).toMatchObject({
      cpDestino: "5000",
      cliente: "CL0001",
      sucursalOrigen: "COR",
      "bultos[0][kilos]": "1.5",
      "bultos[0][volumen]": "6000",
      "bultos[0][valorDeclarado]": "12000",
      "bultos[0][altoCm]": "10",
    });
    expect(llamadas.filter((l) => l.url.includes("/v1/tarifas")).map((l) => new URL(l.url).searchParams.get("contrato")))
      .toEqual(["300001", "300002"]);

    // El token queda en caché: la segunda cotización no vuelve a loguearse.
    await crearAndreani(config, cache).cotizar(PAQUETE, DESTINO, ctx(f));
    expect(llamadas.filter((l) => l.url.endsWith("/login"))).toHaveLength(1);
  });

  it("si fallan las sucursales, queda solo domicilio", async () => {
    const { f } = fakeFetch({
      "/login": () => new Response("", { headers: { "x-authorization-token": "TK" } }),
      "/v1/tarifas": () => respuesta(TARIFA_ANDREANI),
      "/v2/sucursales": () => new Response("boom", { status: 500 }),
    });
    const log = vi.fn();
    const r = await crearAndreani(config, new Map()).cotizar(PAQUETE, DESTINO, { ...ctx(f), log });
    expect(r.map((o) => o.servicio)).toEqual(["domicilio"]);
    expect(log).toHaveBeenCalledWith("andreani parcial: andreani sucursales: HTTP 500");
  });

  it("sin ninguna opción, lanza el error", async () => {
    const { f } = fakeFetch({
      "/login": () => new Response("", { headers: { "x-authorization-token": "TK" } }),
      "/v1/tarifas": () => new Response("{}", { status: 400 }),
      "/v2/sucursales": () => respuesta([]),
    });
    await expect(crearAndreani(config, new Map()).cotizar(PAQUETE, DESTINO, ctx(f))).rejects.toThrow(/HTTP 400/);
  });
});

describe("adaptador Correo Argentino", () => {
  const config = configCorreo(envDe({
    CORREO_USER: "user", CORREO_PASSWORD: "secret", CORREO_CUSTOMER_ID: "0000550997", ORIGEN_CP: "5000",
  }))!;

  it("pide token, cotiza y arma opciones por sucursal", async () => {
    const { f, llamadas } = fakeFetch({
      "/token": () => respuesta({ token: "JWT", expires: "2099-01-01 00:00:00" }),
      "/rates": () => respuesta(RATES_CORREO),
      "/agencies": () => respuesta([agencia("X0001", "Centro", "X5000AAA"), agencia("X0002", "Cerca", "X5001AAA")]),
    });
    const r = await crearCorreoArgentino(config, new Map()).cotizar(PAQUETE, DESTINO, ctx(f));
    expect(r.map((o) => [o.servicio, o.precio, o.sucursal?.id ?? null])).toEqual([
      ["domicilio", 498.06, null],
      ["sucursal", 398.06, "X0001"],
      ["sucursal", 398.06, "X0002"],
    ]);
    const rates = llamadas.find((l) => l.url.endsWith("/rates"))!;
    expect(JSON.parse(String(rates.init?.body))).toEqual({
      customerId: "0000550997",
      postalCodeOrigin: "5000",
      postalCodeDestination: "5000",
      dimensions: { weight: 1500, height: 10, width: 20, length: 30 },
    });
    expect((rates.init?.headers as Record<string, string>).Authorization).toBe("Bearer JWT");
    const agencies = new URL(llamadas.find((l) => l.url.includes("/agencies"))!.url);
    expect(agencies.searchParams.get("provinceCode")).toBe("X");
  });

  it("rechaza paquetes fuera de los límites sin llamar a la API", async () => {
    const { f, llamadas } = fakeFetch({});
    await expect(
      crearCorreoArgentino(config, new Map()).cotizar({ ...PAQUETE, peso_g: 25001 }, DESTINO, ctx(f)),
    ).rejects.toThrow(/peso/);
    expect(llamadas).toHaveLength(0);
  });

  it("un 401 del token hace fallar la cotización", async () => {
    const { f } = fakeFetch({ "/token": () => respuesta({ code: "401", message: "Unauthorized" }, { status: 401 }) });
    await expect(crearCorreoArgentino(config, new Map()).cotizar(PAQUETE, DESTINO, ctx(f))).rejects.toThrow(/HTTP 401/);
  });
});

describe("cotizarTodos", () => {
  const ok = (id: Transportista["id"], precio: number): Transportista => ({
    id,
    cotizar: async () => [{ transportista: id, servicio: "domicilio", precio, plazo: null }],
  });

  it("junta las opciones y omite (y loguea) a los que fallan", async () => {
    const log = vi.fn();
    const falla: Transportista = { id: "correo_argentino", cotizar: async () => { throw new Error("red caída"); } };
    const r = await cotizarTodos([ok("andreani", 100), falla], PAQUETE, DESTINO, { fetch: fetch, log });
    expect(r).toEqual([{ transportista: "andreani", servicio: "domicilio", precio: 100, plazo: null }]);
    expect(log).toHaveBeenCalledWith("correo_argentino omitido: Error: red caída");
  });

  it("omite al que tarda más que el timeout y aborta su fetch", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const lento: Transportista = {
        id: "andreani",
        cotizar: (_p, _d, c) => {
          signal = c.signal;
          return new Promise(() => {});
        },
      };
      const log = vi.fn();
      const prom = cotizarTodos([lento, ok("correo_argentino", 50)], PAQUETE, DESTINO, { fetch, log, timeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(5000);
      const r = await prom;
      expect(r.map((o) => o.transportista)).toEqual(["correo_argentino"]);
      expect(signal?.aborted).toBe(true);
      expect(log).toHaveBeenCalledWith("andreani omitido: timeout de 5000 ms");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin transportistas devuelve []", async () => {
    expect(await cotizarTodos([], PAQUETE, DESTINO, { fetch })).toEqual([]);
  });

  it("los logs no incluyen secretos", async () => {
    const config = configCorreo(envDe({
      CORREO_USER: "usuario-secreto", CORREO_PASSWORD: "clave-secreta", CORREO_CUSTOMER_ID: "1", ORIGEN_CP: "5000",
    }))!;
    const { f } = fakeFetch({ "/token": () => new Response("clave-secreta inválida", { status: 401 }) });
    const log = vi.fn();
    await cotizarTodos([crearCorreoArgentino(config, new Map())], PAQUETE, DESTINO, { fetch: f, log });
    const texto = log.mock.calls.flat().join(" ");
    expect(texto).toContain("correo_argentino omitido");
    expect(texto).not.toMatch(/secret|usuario-secreto/);
  });
});

describe("filas y respuesta", () => {
  it("una fila por opción, con la sucursal como detalle", () => {
    const pedido = { cp: "5000", cpOriginal: "5000", provincia: "Córdoba", items: [{ producto_id: P1, cantidad: 2 }] };
    const opciones = [
      { transportista: "andreani" as const, servicio: "domicilio" as const, precio: 10, plazo: null },
      {
        transportista: "correo_argentino" as const, servicio: "sucursal" as const, precio: 5, plazo: "2 días hábiles",
        sucursal: { id: "X1", nombre: "Centro", direccion: "Calle 1" },
      },
    ];
    let n = 0;
    const filas = armarFilas(opciones, pedido, () => `id-${++n}`);
    expect(filas[1]).toEqual({
      id: "id-2", cp_destino: "5000", provincia: "Córdoba", transportista: "correo_argentino",
      servicio: "sucursal", sucursal_id: "X1", sucursal_detalle: "Centro (Calle 1)", precio: 5,
      plazo: "2 días hábiles", items: [{ producto_id: P1, cantidad: 2 }],
    });
    const guardadas = [
      { id: "id-2", expira_at: "2026-09-28T16:30:00.123-03:00" },
      { id: "id-1", expira_at: "2026-09-28T19:30:00.123+00:00" },
    ];
    expect(opcionesRespuesta(opciones, filas, guardadas)).toEqual([
      {
        cotizacion_id: "id-1", transportista: "andreani", servicio: "domicilio", precio: 10, plazo: null,
        expira_at: "2026-09-28T19:30:00.123Z",
      },
      {
        cotizacion_id: "id-2", transportista: "correo_argentino", servicio: "sucursal", precio: 5,
        plazo: "2 días hábiles", expira_at: "2026-09-28T19:30:00.123Z",
        sucursal: { id: "X1", nombre: "Centro", direccion: "Calle 1" },
      },
    ]);
    // Sin fila guardada, la opción no se devuelve.
    expect(opcionesRespuesta(opciones, filas, [guardadas[1]]).map((o) => o.cotizacion_id)).toEqual(["id-1"]);
  });
});
