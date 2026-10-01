-- ============================================================================
-- pgTAP tests for migration *_envios_transportistas.sql
--   * productos: peso_g / medidas (> 0, nullable)
--   * cotizaciones_envio: schema, RLS without policies, no access for
--     anon / authenticated, service_role can write
--   * pedidos: transportista / servicio_envio checks
--   * crear_pedido(..., p_cotizacion_envio): valid quote, expired, used,
--     CP / province / items mismatch, free-shipping coupon, entrega =
--     coordinar, idempotency, null -> zone logic unchanged
--
-- Run locally with:  supabase test db --local
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(41);

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres).
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'uno@transportistas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Uno"}', now(), now());

insert into public.productos (id, nombre, precio, stock) values
  ('b5000000-0000-4000-8000-000000000001', 'Producto A transportistas', 1000, 100),
  ('b5000000-0000-4000-8000-000000000002', 'Producto B transportistas', 500, 100);

update public.zonas_envio set activo = false;
insert into public.zonas_envio (id, nombre, provincias, cp_prefijos, precio, activo)
values ('e5000000-0000-4000-8000-000000000001', 'Córdoba', '{"Córdoba"}', '{}', 2000, true);

insert into public.cupones (id, codigo, tipo, valor, usos_por_cliente)
values ('f5000000-0000-4000-8000-000000000001', 'ENVIOGRATIST', 'envio_gratis', 0, null);

-- Quotes: c...01 valid home delivery, c...02 expired, c...03 used,
-- c...04 valid branch (for items A x2 + B x1), c...05 valid for coupon test,
-- c...06 valid for idempotency test, c...07 valid for coordinar test,
-- c...08 valid for mismatch tests (never consumed).
insert into public.cotizaciones_envio
  (id, expira_at, cp_destino, provincia, transportista, servicio, sucursal_id,
   sucursal_detalle, precio, plazo, items, usada_at)
values
  ('c5000000-0000-4000-8000-000000000001', now() + interval '30 minutes', '5000', 'Córdoba',
   'andreani', 'domicilio', null, null, 4321.50, '3 a 5 días hábiles',
   '[{"producto_id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]', null),
  ('c5000000-0000-4000-8000-000000000002', now() - interval '1 minute', '5000', 'Córdoba',
   'andreani', 'domicilio', null, null, 4000,
   null, '[{"producto_id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]', null),
  ('c5000000-0000-4000-8000-000000000003', now() + interval '30 minutes', '5000', 'Córdoba',
   'correo_argentino', 'domicilio', null, null, 3000,
   null, '[{"producto_id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]', now()),
  ('c5000000-0000-4000-8000-000000000004', now() + interval '30 minutes', '5000', 'Córdoba',
   'correo_argentino', 'sucursal', 'X0001', 'Córdoba Centro (Av. Colón 100)', 2500, null,
   '[{"producto_id":"b5000000-0000-4000-8000-000000000001","cantidad":2},
     {"producto_id":"b5000000-0000-4000-8000-000000000002","cantidad":1}]', null),
  ('c5000000-0000-4000-8000-000000000005', now() + interval '30 minutes', '5000', 'Córdoba',
   'andreani', 'domicilio', null, null, 5000,
   null, '[{"producto_id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]', null),
  ('c5000000-0000-4000-8000-000000000006', now() + interval '30 minutes', '5000', 'Córdoba',
   'andreani', 'domicilio', null, null, 6000,
   null, '[{"producto_id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]', null),
  ('c5000000-0000-4000-8000-000000000007', now() + interval '30 minutes', '5000', 'Córdoba',
   'andreani', 'domicilio', null, null, 7000,
   null, '[{"producto_id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]', null),
  ('c5000000-0000-4000-8000-000000000008', now() + interval '30 minutes', '5000', 'Córdoba',
   'andreani', 'domicilio', null, null, 8000,
   null, '[{"producto_id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]', null);

-- ----------------------------------------------------------------------------
-- Schema.
-- ----------------------------------------------------------------------------
-- 1
select has_column('public', 'productos', 'peso_g', 'productos.peso_g exists');
-- 2
select col_type_is('public', 'productos', 'alto_cm', 'numeric(6,1)', 'productos.alto_cm is numeric(6,1)');
-- 3
select throws_ok(
  $$ update public.productos set peso_g = 0 where id = 'b5000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'peso_g must be > 0'
);
-- 4
select throws_ok(
  $$ update public.productos set largo_cm = -1 where id = 'b5000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'dimensions must be > 0'
);
-- 5
select lives_ok(
  $$ update public.productos set peso_g = 250, alto_cm = 10.5, ancho_cm = 20, largo_cm = 30
      where id = 'b5000000-0000-4000-8000-000000000002' $$,
  'weight and dimensions can be set'
);
-- 6
select throws_ok(
  $$ insert into public.pedidos (nombre, telefono, items, subtotal, transportista)
     values ('x', '1', '[]', 0, 'oca') $$,
  '23514', null, 'pedidos.transportista only accepts andreani / correo_argentino'
);
-- 7
select throws_ok(
  $$ insert into public.pedidos (nombre, telefono, items, subtotal, servicio_envio)
     values ('x', '1', '[]', 0, 'express') $$,
  '23514', null, 'pedidos.servicio_envio only accepts domicilio / sucursal'
);
-- 8
select is(
  (select relrowsecurity from pg_class where oid = 'public.cotizaciones_envio'::regclass),
  true, 'RLS is enabled on cotizaciones_envio'
);
-- 9
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'cotizaciones_envio'),
  0, 'cotizaciones_envio has no policies'
);
-- 10
select results_eq(
  $$ select r.rol::text, p.priv::text, has_table_privilege(r.rol, 'public.cotizaciones_envio', p.priv)
       from (values ('anon'), ('authenticated')) r(rol),
            (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
      where has_table_privilege(r.rol, 'public.cotizaciones_envio', p.priv) $$,
  $$ select null::text, null::text, null::boolean where false $$,
  'anon and authenticated have no privileges on cotizaciones_envio'
);
-- 11
select throws_ok(
  $$ insert into public.cotizaciones_envio
       (cp_destino, provincia, transportista, servicio, precio, items)
     values ('5000', 'Córdoba', 'andreani', 'sucursal', 1, '[{"producto_id":"x","cantidad":1}]') $$,
  '23514', null, 'a branch quote needs sucursal_id'
);
-- 12
select throws_ok(
  $$ insert into public.cotizaciones_envio
       (cp_destino, provincia, transportista, servicio, precio, items)
     values ('X5000', 'Córdoba', 'andreani', 'domicilio', 1, '[{"producto_id":"x","cantidad":1}]') $$,
  '23514', null, 'cp_destino must be the 4-digit code'
);
-- 13
select has_function(
  'public', 'crear_pedido',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
        'jsonb', 'numeric', 'text', 'text', 'uuid', 'text', 'uuid'],
  'crear_pedido has the 15-argument signature (p_cotizacion_envio last)'
);
-- 14
select hasnt_function(
  'public', 'crear_pedido',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
        'jsonb', 'numeric', 'text', 'text', 'uuid', 'text'],
  'the 14-argument crear_pedido is gone (no ambiguous overload for PostgREST)'
);
-- 15
select results_eq(
  $$ select r.rol::text, has_function_privilege(r.rol,
            'public.crear_pedido(text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text, uuid)',
            'EXECUTE')
       from (values ('anon'), ('authenticated')) r(rol) order by 1 $$,
  $$ values ('anon'::text, false), ('authenticated', true) $$,
  'crear_pedido: authenticated only'
);

-- ----------------------------------------------------------------------------
-- service_role (the Edge Function) can write and read.
-- ----------------------------------------------------------------------------
set local role service_role;
-- 16
select lives_ok(
  $$ insert into public.cotizaciones_envio
       (cp_destino, provincia, transportista, servicio, precio, items)
     values ('5000', 'Córdoba', 'correo_argentino', 'domicilio', 1234.5,
             '[{"producto_id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]') $$,
  'service_role can insert quotes'
);
-- 17
select is(
  (select expira_at - created_at from public.cotizaciones_envio
    where transportista = 'correo_argentino' and precio = 1234.5),
  interval '30 minutes',
  'a quote expires 30 minutes after it is created by default'
);
reset role;

-- ----------------------------------------------------------------------------
-- As anon.
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';
-- 18
select throws_ok(
  $$ select * from public.cotizaciones_envio $$,
  '42501', null, 'anon cannot read cotizaciones_envio'
);
-- 19
select throws_ok(
  $$ insert into public.cotizaciones_envio
       (cp_destino, provincia, transportista, servicio, precio, items)
     values ('5000', 'Córdoba', 'andreani', 'domicilio', 0, '[{"producto_id":"x","cantidad":1}]') $$,
  '42501', null, 'anon cannot insert cotizaciones_envio'
);
reset role;

-- ----------------------------------------------------------------------------
-- As a customer.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000001';

-- 20
select throws_ok(
  $$ select * from public.cotizaciones_envio $$,
  '42501', null, 'a customer cannot read cotizaciones_envio'
);
-- 21
select throws_ok(
  $$ update public.cotizaciones_envio set precio = 0 $$,
  '42501', null, 'a customer cannot update cotizaciones_envio'
);

-- 22: valid home-delivery quote. CPA and province spelling differ but match.
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', 'X5000ABC', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'CORDOBA', 'd5000000-0000-4000-8000-000000000001', null,
       'c5000000-0000-4000-8000-000000000001') $$,
  'order with a valid carrier quote'
);
-- 23
select results_eq(
  $$ select costo_envio, total, transportista, servicio_envio, sucursal_envio,
            cotizacion_envio_id, zona_id
       from public.pedidos where idempotency_key = 'd5000000-0000-4000-8000-000000000001' $$,
  $$ values (4321.50::numeric, 5321.50::numeric, 'andreani'::text, 'domicilio'::text,
             null::text, 'c5000000-0000-4000-8000-000000000001'::uuid, null::uuid) $$,
  'the quote price and carrier are stored (no zone)'
);
-- 24: branch quote, items in another order and with a repeated product.
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', null, 'Córdoba', '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000002","cantidad":1},
         {"id":"b5000000-0000-4000-8000-000000000001","cantidad":1},
         {"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', 'd5000000-0000-4000-8000-000000000002', null,
       'c5000000-0000-4000-8000-000000000004') $$,
  'order with a branch quote (items grouped, any order)'
);
-- 25
select results_eq(
  $$ select costo_envio, transportista, servicio_envio, sucursal_envio
       from public.pedidos where idempotency_key = 'd5000000-0000-4000-8000-000000000002' $$,
  $$ values (2500::numeric, 'correo_argentino'::text, 'sucursal'::text,
             'X0001 — Córdoba Centro (Av. Colón 100)'::text) $$,
  'the branch snapshot is stored in sucursal_envio'
);
-- 26: expired
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', null, null, 'c5000000-0000-4000-8000-000000000002') $$,
  '22023', 'La cotización del envío venció. Volvé a cotizar el envío.',
  'an expired quote is rejected'
);
-- 27: already used (by another order)
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', null, null, 'c5000000-0000-4000-8000-000000000003') $$,
  '22023', 'La cotización del envío ya se usó en otro pedido. Volvé a cotizar el envío.',
  'a used quote is rejected'
);
-- 28: the quote from test 22 cannot be reused by a new order
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', null, null, 'c5000000-0000-4000-8000-000000000001') $$,
  '22023', null,
  'a quote is consumed by the order that used it'
);
-- 29: unknown quote
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', null, null, 'c5000000-0000-4000-8000-0000000000ff') $$,
  '22023', 'La cotización del envío no es válida. Volvé a cotizar el envío.',
  'an unknown quote is rejected'
);
-- 30: CP mismatch
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5001', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', null, null, 'c5000000-0000-4000-8000-000000000008') $$,
  '22023', 'El código postal o la provincia no coinciden con los del envío cotizado. Volvé a cotizar el envío.',
  'a CP mismatch is rejected'
);
-- 31: province mismatch
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Santa Fe', null, null, 'c5000000-0000-4000-8000-000000000008') $$,
  '22023', null,
  'a province mismatch is rejected'
);
-- 32: quantity mismatch
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":2}]'::jsonb,
       0, 'checkout', 'Córdoba', null, null, 'c5000000-0000-4000-8000-000000000008') $$,
  '22023', 'Tu carrito cambió desde que cotizaste el envío. Volvé a cotizar el envío.',
  'a quantity mismatch is rejected'
);
-- 33: extra product
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1},
         {"id":"b5000000-0000-4000-8000-000000000002","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', null, null, 'c5000000-0000-4000-8000-000000000008') $$,
  '22023', null,
  'a product mismatch is rejected'
);
reset role;
-- 34: failed attempts left the quote unused and the stock untouched
select results_eq(
  $$ select (select usada_at is null from public.cotizaciones_envio
              where id = 'c5000000-0000-4000-8000-000000000008'),
            (select stock from public.productos
              where id = 'b5000000-0000-4000-8000-000000000001') $$,
  $$ values (true, 97) $$,
  'a rejected quote rolls back everything (quote unused, stock restored)'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000001';
-- 35: free-shipping coupon still zeroes the carrier price
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', 'd5000000-0000-4000-8000-000000000005', 'enviogratist',
       'c5000000-0000-4000-8000-000000000005') $$,
  'order with a carrier quote and a free-shipping coupon'
);
-- 36
select results_eq(
  $$ select costo_envio, transportista, cotizacion_envio_id
       from public.pedidos where idempotency_key = 'd5000000-0000-4000-8000-000000000005' $$,
  $$ values (0::numeric, 'andreani'::text, 'c5000000-0000-4000-8000-000000000005'::uuid) $$,
  'free-shipping coupon: costo_envio = 0, carrier still recorded'
);
-- 37: idempotency: a retry with the same key returns the same order, even
-- though the quote is already used.
select is(
  public.crear_pedido(
    'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
    '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
    0, 'checkout', 'Córdoba', 'd5000000-0000-4000-8000-000000000006', null,
    'c5000000-0000-4000-8000-000000000006'),
  public.crear_pedido(
    'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
    '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
    0, 'checkout', 'Córdoba', 'd5000000-0000-4000-8000-000000000006', null,
    'c5000000-0000-4000-8000-000000000006'),
  'a retry with the same idempotency key returns the same order'
);
-- 38: entrega = coordinar ignores the quote (not consumed, no carrier)
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'coordinar', null, null, '5000', null,
       '[{"id":"b5000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', 'd5000000-0000-4000-8000-000000000007', null,
       'c5000000-0000-4000-8000-000000000007') $$,
  'entrega = coordinar with a quote id'
);
reset role;
-- 39
select results_eq(
  $$ select costo_envio, transportista, cotizacion_envio_id,
            (select usada_at is null from public.cotizaciones_envio
              where id = 'c5000000-0000-4000-8000-000000000007')
       from public.pedidos where idempotency_key = 'd5000000-0000-4000-8000-000000000007' $$,
  $$ values (0::numeric, null::text, null::uuid, true) $$,
  'entrega = coordinar: no shipping cost, quote not consumed'
);
-- This file creates more checkout orders for one account than the rate limit
-- of 20261001050000_pedidos_limites allows (5 per 10 minutes). The limit is
-- not under test here, so the earlier orders are moved two days back.
update public.pedidos set created_at = created_at - interval '2 days'
 where user_id = 'a5000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000001';
-- 40: no quote -> the zone logic is unchanged
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', '5800', null,
       '[{"id":"b5000000-0000-4000-8000-000000000002","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', 'd5000000-0000-4000-8000-000000000008') $$,
  'order without a quote'
);
-- 41
select results_eq(
  $$ select costo_envio, zona_nombre, transportista, cotizacion_envio_id
       from public.pedidos where idempotency_key = 'd5000000-0000-4000-8000-000000000008' $$,
  $$ values (2000::numeric, 'Córdoba'::text, null::text, null::uuid) $$,
  'without a quote, crear_pedido uses the shipping zone as before'
);

select * from finish();

rollback;
