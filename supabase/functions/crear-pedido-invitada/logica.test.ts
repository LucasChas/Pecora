import { describe, expect, it } from "vitest";
import { errorDeRpc, esError, hashIp, ipConfiable, numeroDePedido, parseCuerpo, turnstileValido } from "./logica.ts";

const ID = "c3b00000-0000-4000-8000-000000000001";
const TALLE = "c3d00000-0000-4000-8000-000000000001";
const CLAVE = "c3e00000-0000-4000-8000-000000000001";

function pedido(extra: Record<string, unknown> = {}) {
  return {
    p_nombre: "Ana",
    p_telefono: "3515551234",
    p_email: "ana@ejemplo.com",
    p_entrega: "coordinar",
    p_direccion: null,
    p_localidad: null,
    p_cp: null,
    p_notas: null,
    p_items: [{ id: ID, nombre: "Body", precio: 1, cantidad: 2 }],
    p_subtotal: 2000,
    p_origen: "checkout",
    p_provincia: null,
    p_idempotency_key: CLAVE,
    ...extra,
  };
}

describe("parseCuerpo", () => {
  it("acepta un pedido válido y copia solo los parámetros conocidos", () => {
    const r = parseCuerpo({ turnstile_token: "tok", pedido: pedido({ p_cupon: "PROMO", p_origen: "admin", otro: 1 }) });
    expect(esError(r)).toBe(false);
    if (esError(r)) return;
    expect(r.token).toBe("tok");
    expect(r.params).not.toHaveProperty("p_cupon");
    expect(r.params).not.toHaveProperty("p_origen");
    expect(r.params).not.toHaveProperty("otro");
    expect(r.params.p_items).toEqual([{ id: ID, cantidad: 2 }]);
    expect(r.params.p_idempotency_key).toBe(CLAVE);
    expect(r.params.p_cotizacion_envio).toBeNull();
  });

  it("conserva el talle de cada ítem", () => {
    const r = parseCuerpo({ turnstile_token: "tok", pedido: pedido({ p_items: [{ id: ID, cantidad: 1, talle_id: TALLE }] }) });
    expect(esError(r) ? null : r.params.p_items).toEqual([{ id: ID, cantidad: 1, talle_id: TALLE }]);
  });

  it("sin token pide la verificación", () => {
    const r = parseCuerpo({ pedido: pedido() });
    expect(esError(r) && r.codigo).toBe("captcha_requerido");
  });

  it.each([
    ["sin pedido", { turnstile_token: "tok" }],
    ["sin nombre", { turnstile_token: "tok", pedido: pedido({ p_nombre: "" }) }],
    ["sin ítems", { turnstile_token: "tok", pedido: pedido({ p_items: [] }) }],
    ["más de 50 ítems", { turnstile_token: "tok", pedido: pedido({ p_items: Array(51).fill({ id: ID, cantidad: 1 }) }) }],
    ["id que no es uuid", { turnstile_token: "tok", pedido: pedido({ p_items: [{ id: "x", cantidad: 1 }] }) }],
    ["cantidad no entera", { turnstile_token: "tok", pedido: pedido({ p_items: [{ id: ID, cantidad: 1.5 }] }) }],
    ["cantidad 0", { turnstile_token: "tok", pedido: pedido({ p_items: [{ id: ID, cantidad: 0 }] }) }],
    ["texto que no es string", { turnstile_token: "tok", pedido: pedido({ p_notas: 5 }) }],
    ["texto muy largo", { turnstile_token: "tok", pedido: pedido({ p_notas: "a".repeat(2001) }) }],
    ["clave que no es uuid", { turnstile_token: "tok", pedido: pedido({ p_idempotency_key: "x" }) }],
    ["subtotal no numérico", { turnstile_token: "tok", pedido: pedido({ p_subtotal: "10" }) }],
  ])("rechaza %s", (_, body) => {
    const r = parseCuerpo(body);
    expect(esError(r) && r.codigo).toBe("invalid_body");
  });
});

describe("turnstileValido", () => {
  it("vale con success y la acción del checkout (o sin acción)", () => {
    expect(turnstileValido({ success: true, action: "checkout" })).toBe(true);
    expect(turnstileValido({ success: true })).toBe(true);
  });
  it("no vale si falla o si es de otra acción", () => {
    expect(turnstileValido({ success: false, action: "checkout" })).toBe(false);
    expect(turnstileValido({ success: true, action: "login" })).toBe(false);
    expect(turnstileValido(null)).toBe(false);
  });
});

describe("ipConfiable", () => {
  it("usa cf-connecting-ip y después x-real-ip", () => {
    expect(ipConfiable(new Headers({ "cf-connecting-ip": "1.2.3.4", "x-real-ip": "5.6.7.8" }))).toBe("1.2.3.4");
    expect(ipConfiable(new Headers({ "x-real-ip": "2001:DB8::1" }))).toBe("2001:db8::1");
  });
  it("ignora x-forwarded-for (lo puede escribir quien llama) y valores raros", () => {
    expect(ipConfiable(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBeNull();
    expect(ipConfiable(new Headers({ "cf-connecting-ip": "1.2.3.4, 5.6.7.8" }))).toBeNull();
  });
});

describe("hashIp", () => {
  it("no deja la IP y depende del secreto", async () => {
    const a = await hashIp("1.2.3.4", "s1");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("1.2.3.4");
    expect(await hashIp("1.2.3.4", "s1")).toBe(a);
    expect(await hashIp("1.2.3.4", "s2")).not.toBe(a);
  });
});

describe("errorDeRpc", () => {
  it("devuelve tal cual los mensajes de crear_pedido", () => {
    expect(errorDeRpc({ code: "P0001", message: "Sin stock" })).toEqual({ status: 400, codigo: "P0001", mensaje: "Sin stock" });
    expect(errorDeRpc({ code: "22023", message: "Volvé a cotizar" }).codigo).toBe("22023");
  });
  it("42501 avisa que falta la migración", () => {
    expect(errorDeRpc({ code: "42501", message: "permission denied" })).toMatchObject({ status: 503, codigo: "sin_permiso" });
  });
  it("lo demás es un error genérico, sin el detalle técnico", () => {
    const e = errorDeRpc({ code: "22P02", message: "invalid input syntax for type uuid" });
    expect(e.status).toBe(500);
    expect(e.mensaje).not.toContain("uuid");
  });
});

describe("numeroDePedido", () => {
  it("acepta número o texto entero positivo", () => {
    expect(numeroDePedido(12)).toBe(12);
    expect(numeroDePedido("12")).toBe(12);
    expect(numeroDePedido(0)).toBeNull();
    expect(numeroDePedido("x")).toBeNull();
  });
});
