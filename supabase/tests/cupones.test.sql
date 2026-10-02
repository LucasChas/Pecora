-- ============================================================================
-- pgTAP tests for migration 20260928122650_cupones_y_envios.sql (cupones)
--   * cupones / cupon_usos: schema, constraints, RLS and privileges
--   * validar_cupon: every coupon type, minimum, validity dates, usos_max,
--     usos_por_cliente, solo_primera_compra
--   * crear_pedido (14 args): coupon applied server-side, invalid coupon
--     leaves nothing behind, idempotent retry does not count usage twice,
--     old 13-param calls still work, total >= 0.
--   * manual orders (crear_pedido with origen 'admin' by an admin): no
--     per-customer checks, usos_max still enforced, cupon_usos.user_id null;
--     validar_cupon(p_pedido_manual) is ignored for customers.
--
-- Run locally with:  supabase db start && supabase test db --local
--
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(72);

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres): three customers, one admin, one product, one zone,
-- one coupon of each kind.
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'uno@cupones.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Uno"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dos@cupones.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Dos"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'tres@cupones.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Tres"}', now(), now()),
  ('a1000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@cupones.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

update public.profiles set rol = 'admin' where id = 'a1000000-0000-4000-8000-0000000000ad';

insert into public.productos (id, nombre, precio, stock) values
  ('b1000000-0000-4000-8000-000000000001', 'Producto cupones', 1000, 100);

-- Only this zone is active during the test.
update public.zonas_envio set activo = false;
insert into public.zonas_envio (id, nombre, cp_prefijos, precio, orden) values
  ('e1000000-0000-4000-8000-000000000001', 'Zona cupones', '{5000}', 1500, 0);

insert into public.cupones
  (id, codigo, tipo, valor, minimo_compra, desde, hasta, usos_max,
   usos_por_cliente, solo_primera_compra, activo)
values
  ('f1000000-0000-4000-8000-000000000001', ' diez ', 'porcentaje', 10, 0, null, null, null, null, false, true),
  ('f1000000-0000-4000-8000-000000000002', 'MONTO500', 'monto', 500, 0, null, null, null, null, false, true),
  ('f1000000-0000-4000-8000-000000000003', 'MONTOGRANDE', 'monto', 5000, 0, null, null, null, null, false, true),
  ('f1000000-0000-4000-8000-000000000004', 'ENVIOGRATIS', 'envio_gratis', 0, 0, null, null, null, null, false, true),
  ('f1000000-0000-4000-8000-000000000005', 'MINIMO', 'porcentaje', 10, 15000, null, null, null, null, false, true),
  ('f1000000-0000-4000-8000-000000000006', 'FUTURO', 'porcentaje', 10, 0, now() + interval '1 day', null, null, null, false, true),
  ('f1000000-0000-4000-8000-000000000007', 'VENCIDO', 'porcentaje', 10, 0, now() - interval '2 days', now() - interval '1 day', null, null, false, true),
  ('f1000000-0000-4000-8000-000000000008', 'INACTIVO', 'porcentaje', 10, 0, null, null, null, null, false, false),
  ('f1000000-0000-4000-8000-000000000009', 'UNUSO', 'monto', 100, 0, null, null, 1, null, false, true),
  ('f1000000-0000-4000-8000-00000000000a', 'UNOPORCLIENTE', 'monto', 100, 0, null, null, null, 1, false, true),
  ('f1000000-0000-4000-8000-00000000000b', 'BIENVENIDA', 'porcentaje', 15, 0, null, null, null, null, true, true),
  ('f1000000-0000-4000-8000-00000000000c', 'PCT33', 'porcentaje', 33.33, 0, null, null, null, null, false, true);

-- Coupons for the manual-order tests (other id prefix: not counted by 51/52).
insert into public.cupones
  (id, codigo, tipo, valor, minimo_compra, usos_max, usos_por_cliente, solo_primera_compra)
values
  ('f2000000-0000-4000-8000-000000000001', 'MBIENVENIDA', 'porcentaje', 10, 0, null, null, true),
  ('f2000000-0000-4000-8000-000000000002', 'MUNOCLI', 'monto', 100, 0, 2, 1, false),
  ('f2000000-0000-4000-8000-000000000003', 'MSOLOCLI', 'monto', 100, 0, null, 1, false);

-- ----------------------------------------------------------------------------
-- Schema, constraints and privileges (as postgres).
-- ----------------------------------------------------------------------------
-- 1
select has_table('public', 'cupones', 'cupones exists');
-- 2
select has_table('public', 'cupon_usos', 'cupon_usos exists');
-- 3
select results_eq(
  $$ select relname::text collate "default", relrowsecurity from pg_class
      where oid in ('public.cupones'::regclass, 'public.cupon_usos'::regclass)
      order by 1 $$,
  $$ values ('cupon_usos'::text, true), ('cupones', true) $$,
  'RLS is enabled on cupones and cupon_usos'
);
-- 4
select is(
  (select codigo from public.cupones where id = 'f1000000-0000-4000-8000-000000000001'),
  'DIEZ',
  'codigo is stored trimmed and upper case'
);
-- 5
select throws_ok(
  $$ insert into public.cupones (codigo, tipo, valor) values ('Diez', 'monto', 1) $$,
  '23505', null,
  'codigo is unique case-insensitively'
);
-- 6
select throws_ok(
  $$ insert into public.cupones (codigo, tipo, valor) values ('PCT101', 'porcentaje', 101) $$,
  '23514', null,
  'a percentage above 100 is rejected'
);
-- 7
select throws_ok(
  $$ insert into public.cupones (codigo, tipo, valor) values ('MONTO0', 'monto', 0) $$,
  '23514', null,
  'a fixed-amount coupon needs valor > 0'
);
-- 8
select lives_ok(
  $$ insert into public.cupones (codigo, tipo) values ('ENVIO2', 'envio_gratis') $$,
  'an envio_gratis coupon ignores valor (default 0)'
);
-- 9
select results_eq(
  $$ select column_name::text collate "default", data_type::text collate "default",
            is_nullable::text collate "default"
       from information_schema.columns
      where table_schema = 'public' and table_name = 'pedidos'
        and column_name in ('cupon_id', 'cupon_codigo', 'zona_id', 'zona_nombre')
      order by column_name $$,
  $$ values ('cupon_codigo'::text, 'text'::text, 'YES'::text),
            ('cupon_id', 'uuid', 'YES'),
            ('zona_id', 'uuid', 'YES'),
            ('zona_nombre', 'text', 'YES') $$,
  'pedidos has the nullable coupon and zone columns'
);
-- 10
select results_eq(
  $$ select r.rol::text, f.fn::text, has_function_privilege(r.rol, f.fn, 'EXECUTE')
       from (values ('anon'), ('authenticated')) r(rol),
            (values ('public.validar_cupon(text, numeric, boolean)'),
                    ('public.evaluar_cupon(text, numeric, uuid, boolean, boolean)')) f(fn)
      order by 1, 2 $$,
  $$ values ('anon'::text, 'public.evaluar_cupon(text, numeric, uuid, boolean, boolean)'::text, false),
            ('anon', 'public.validar_cupon(text, numeric, boolean)', false),
            ('authenticated', 'public.evaluar_cupon(text, numeric, uuid, boolean, boolean)', false),
            ('authenticated', 'public.validar_cupon(text, numeric, boolean)', true) $$,
  'only authenticated can execute validar_cupon; evaluar_cupon is internal'
);
-- 10a
select hasnt_function(
  'public', 'validar_cupon', array['text', 'numeric'],
  'the 2-argument validar_cupon is gone (no ambiguous overload for PostgREST)'
);
-- 11
select has_function(
  'public', 'crear_pedido',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
        'jsonb', 'numeric', 'text', 'text', 'uuid', 'text', 'uuid'],
  'crear_pedido has the 15-argument signature (p_cupon, then p_cotizacion_envio)'
);
-- 12
select hasnt_function(
  'public', 'crear_pedido',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
        'jsonb', 'numeric', 'text', 'text', 'uuid'],
  'the 13-argument crear_pedido is gone (no ambiguous overload for PostgREST)'
);
-- 13
select results_eq(
  $$ select r.rol::text, has_function_privilege(r.rol,
            'public.crear_pedido(text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text, uuid)',
            'EXECUTE')
       from (values ('anon'), ('authenticated')) r(rol) order by 1 $$,
  $$ values ('anon'::text, true), ('authenticated', true) $$,
  'crear_pedido: anon (guest checkout) and authenticated'
);

-- ----------------------------------------------------------------------------
-- As anon: coupons cannot be listed or validated.
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 14
select throws_ok($$ select 1 from public.cupones $$, '42501', null,
  'anon cannot read cupones');
-- 15
select throws_ok($$ select 1 from public.cupon_usos $$, '42501', null,
  'anon cannot read cupon_usos');
-- 16
select throws_ok($$ select public.validar_cupon('DIEZ', 1000) $$, '42501', null,
  'anon cannot call validar_cupon');

-- ----------------------------------------------------------------------------
-- As customer 1.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';

-- 17
select is_empty($$ select 1 from public.cupones $$,
  'a customer cannot list cupones');
-- 18
select throws_ok(
  $$ insert into public.cupones (codigo, tipo, valor) values ('HACK', 'porcentaje', 100) $$,
  '42501', null,
  'a customer cannot create cupones'
);
-- 19
select is(
  public.validar_cupon(' diez ', 2000),
  '{"valido":true,"codigo":"DIEZ","tipo":"porcentaje","descuento":200,
    "envio_gratis":false,"mensaje":"Cupón aplicado."}'::jsonb,
  'porcentaje: case-insensitive code, 10% of 2000 = 200'
);
-- 20
select is(
  ((public.validar_cupon('MONTO500', 2000))->>'descuento')::numeric, 500::numeric,
  'monto: fixed discount'
);
-- 21
select is(
  ((public.validar_cupon('MONTOGRANDE', 2000))->>'descuento')::numeric, 2000::numeric,
  'monto: the discount never exceeds the subtotal'
);
-- 22
select is(
  public.validar_cupon('enviogratis', 2000),
  '{"valido":true,"codigo":"ENVIOGRATIS","tipo":"envio_gratis","descuento":0,
    "envio_gratis":true,"mensaje":"Cupón aplicado."}'::jsonb,
  'envio_gratis: no discount, envio_gratis = true'
);
-- 23
select is(
  ((public.validar_cupon('PCT33', 999.99))->>'descuento')::numeric, 333.30::numeric,
  'porcentaje: rounded to 2 decimals'
);
-- 24
select is(
  public.validar_cupon('MINIMO', 14999)->>'mensaje',
  'Este cupón requiere una compra mínima de $ 15.000.',
  'minimo_compra: below the minimum is rejected with the amount'
);
-- 25
select is(
  public.validar_cupon('MINIMO', 15000)->>'valido', 'true',
  'minimo_compra: exactly the minimum is accepted'
);
-- 26
select results_eq(
  $$ select c, (public.validar_cupon(c, 2000))->>'valido',
            (public.validar_cupon(c, 2000))->>'mensaje'
       from (values ('FUTURO'), ('VENCIDO'), ('INACTIVO'), ('NOEXISTE')) v(c)
      order by c $$,
  $$ values ('FUTURO'::text, 'false'::text, 'El cupón no es válido o ya venció.'::text),
            ('INACTIVO', 'false', 'El cupón no es válido o ya venció.'),
            ('NOEXISTE', 'false', 'El cupón no es válido o ya venció.'),
            ('VENCIDO', 'false', 'El cupón no es válido o ya venció.') $$,
  'not started, expired, inactive and unknown coupons get the same generic message'
);
-- 27
select is(
  public.validar_cupon('  ', 2000)->>'mensaje', 'Ingresá un código de cupón.',
  'an empty code is rejected'
);

-- End to end: 2 units (2000) + zone 1500 - 10% (200) = 3300.
-- 28
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '111', 'uno@cupones.test', 'envio',
       'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":2,"precio":1}]'::jsonb,
       1, 'checkout', 'Córdoba', 'd1000000-0000-4000-8000-000000000001', 'diez') $$,
  'customer creates an order with a coupon'
);
-- 29
select results_eq(
  $$ select subtotal, descuento, costo_envio, total, cupon_id, cupon_codigo, zona_nombre
       from public.pedidos where idempotency_key = 'd1000000-0000-4000-8000-000000000001' $$,
  $$ values (2000::numeric, 200::numeric, 1500::numeric, 3300::numeric,
             'f1000000-0000-4000-8000-000000000001'::uuid, 'DIEZ'::text, 'Zona cupones'::text) $$,
  'order totals: subtotal 2000, descuento 200, envio 1500, total 3300'
);
-- 30
select is_empty($$ select 1 from public.cupon_usos $$,
  'a customer cannot read cupon_usos');

-- 31: same key again (with the coupon) returns the same order.
select is(
  public.crear_pedido(
    'Clienta Uno', '111', 'uno@cupones.test', 'envio',
    'Calle 1', 'Córdoba', '5000', null,
    '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":2}]'::jsonb,
    0, 'checkout', 'Córdoba', 'd1000000-0000-4000-8000-000000000001', 'DIEZ'),
  (select numero from public.pedidos
    where idempotency_key = 'd1000000-0000-4000-8000-000000000001'),
  'idempotent retry with a coupon returns the same numero'
);

-- 32: envio_gratis coupon on an order that would pay shipping.
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', 'd1000000-0000-4000-8000-000000000002', 'ENVIOGRATIS') $$,
  'order with an envio_gratis coupon'
);
-- 33
select results_eq(
  $$ select descuento, costo_envio, total, zona_nombre
       from public.pedidos where idempotency_key = 'd1000000-0000-4000-8000-000000000002' $$,
  $$ values (0::numeric, 0::numeric, 1000::numeric, 'Zona cupones'::text) $$,
  'envio_gratis coupon: costo_envio = 0 even though the zone costs 1500'
);
-- 34: an invalid coupon aborts the whole order.
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '111', null, 'envio', 'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":3}]'::jsonb,
       0, 'checkout', 'Córdoba', 'd1000000-0000-4000-8000-000000000003', 'NOEXISTE') $$,
  'P0001', 'El cupón no es válido o ya venció.',
  'crear_pedido with an invalid coupon raises the validation message'
);
-- 35
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '111', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', null, 'd1000000-0000-4000-8000-000000000004', 'MINIMO') $$,
  'P0001', 'Este cupón requiere una compra mínima de $ 15.000.',
  'crear_pedido checks minimo_compra against the DB subtotal'
);
-- 36
select is_empty(
  $$ select 1 from public.pedidos
      where idempotency_key in ('d1000000-0000-4000-8000-000000000003',
                                'd1000000-0000-4000-8000-000000000004') $$,
  'orders with an invalid coupon are not saved'
);
-- 37 (100 - 2 - 1 = 97: the failed orders did not touch the stock)
select is(
  (select stock from public.productos where id = 'b1000000-0000-4000-8000-000000000001'),
  97,
  'orders with an invalid coupon do not change stock'
);

-- usos_max = 1
-- 38
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '111', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', null, 'd1000000-0000-4000-8000-000000000005', 'UNUSO') $$,
  'first use of a usos_max = 1 coupon'
);
-- usos_por_cliente = 1
-- 39
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '111', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', null, 'd1000000-0000-4000-8000-000000000006', 'UNOPORCLIENTE') $$,
  'first use of a usos_por_cliente = 1 coupon'
);
-- 40
select is(
  public.validar_cupon('UNOPORCLIENTE', 2000)->>'mensaje', 'Ya usaste este cupón.',
  'usos_por_cliente: the same customer cannot use it again'
);
-- 41
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '111', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', null, 'd1000000-0000-4000-8000-000000000007', 'UNOPORCLIENTE') $$,
  'P0001', 'Ya usaste este cupón.',
  'usos_por_cliente is enforced by crear_pedido'
);
-- 42
select is(
  public.validar_cupon('BIENVENIDA', 2000)->>'mensaje',
  'Este cupón es solo para tu primera compra.',
  'solo_primera_compra: a customer with orders is rejected'
);
-- 42a: p_pedido_manual is ignored for a customer (no bypass).
select is(
  public.validar_cupon('UNOPORCLIENTE', 2000, true)->>'mensaje', 'Ya usaste este cupón.',
  'a customer cannot skip usos_por_cliente with p_pedido_manual'
);
-- 42b
select is(
  public.validar_cupon('BIENVENIDA', 2000, true)->>'mensaje',
  'Este cupón es solo para tu primera compra.',
  'a customer cannot skip solo_primera_compra with p_pedido_manual'
);
-- 42c: p_origen = admin from a customer is coerced to checkout, so the
-- per-customer checks still apply.
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '111', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'admin', null, 'd1000000-0000-4000-8000-00000000000b', 'UNOPORCLIENTE') $$,
  'P0001', 'Ya usaste este cupón.',
  'a customer passing p_origen = admin still gets the per-customer checks'
);

-- ----------------------------------------------------------------------------
-- As customer 2 (has no orders yet).
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';

-- 43
select is(
  public.validar_cupon('UNUSO', 2000)->>'mensaje', 'Este cupón ya no tiene usos disponibles.',
  'usos_max: no uses left for anyone'
);
-- 44
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta Dos', '222', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', null, 'd1000000-0000-4000-8000-000000000008', 'UNUSO') $$,
  'P0001', 'Este cupón ya no tiene usos disponibles.',
  'usos_max is enforced by crear_pedido (row lock on the coupon)'
);
-- 45
select is(
  public.validar_cupon('UNOPORCLIENTE', 2000)->>'valido', 'true',
  'usos_por_cliente counts per customer: another customer can use it'
);
-- 46: the old 13-parameter call (named, as PostgREST does) still works.
select lives_ok(
  $$ select public.crear_pedido(
       p_nombre => 'Clienta Dos', p_telefono => '222', p_email => null,
       p_entrega => 'envio', p_direccion => 'Calle 2', p_localidad => 'Córdoba',
       p_cp => '5000', p_notas => null,
       p_items => '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       p_subtotal => 0, p_origen => 'checkout', p_provincia => 'Córdoba',
       p_idempotency_key => 'd1000000-0000-4000-8000-000000000009') $$,
  'crear_pedido still accepts the 13 named parameters (no p_cupon)'
);
-- 47
select results_eq(
  $$ select subtotal, descuento, costo_envio, total, cupon_id
       from public.pedidos where idempotency_key = 'd1000000-0000-4000-8000-000000000009' $$,
  $$ values (1000::numeric, 0::numeric, 1500::numeric, 2500::numeric, null::uuid) $$,
  'an order without coupon still gets the zone shipping cost'
);

-- ----------------------------------------------------------------------------
-- As customer 3: primera compra.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';

-- 48
select is(
  (public.validar_cupon('BIENVENIDA', 2000)->>'descuento')::numeric, 300::numeric,
  'solo_primera_compra: a customer without orders gets it (15% of 2000)'
);
-- 49
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Tres', '333', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', null, 'd1000000-0000-4000-8000-00000000000a', 'bienvenida') $$,
  'first purchase with the welcome coupon'
);
-- 50
select is(
  public.validar_cupon('BIENVENIDA', 2000)->>'valido', 'false',
  'after the first purchase the welcome coupon is no longer valid'
);

-- ----------------------------------------------------------------------------
-- As admin.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-0000000000ad';

-- 51
select is(
  (select count(*)::int from public.cupones where id::text like 'f1000000-%'),
  12,
  'the admin can list cupones'
);
-- 52: one use per order with coupon; the idempotent retry did not add one.
select results_eq(
  $$ select c.codigo, count(*)::int
       from public.cupon_usos u join public.cupones c on c.id = u.cupon_id
      where c.id::text like 'f1000000-%'
      group by c.codigo order by c.codigo $$,
  $$ values ('BIENVENIDA'::text, 1), ('DIEZ', 1), ('ENVIOGRATIS', 1),
            ('UNOPORCLIENTE', 1), ('UNUSO', 1) $$,
  'the admin sees exactly one usage per order (retry not double-counted)'
);
-- 53
select lives_ok(
  $$ update public.cupones set activo = false
      where id = 'f1000000-0000-4000-8000-000000000002' $$,
  'the admin can update cupones'
);

-- Manual orders (origen 'admin'): the coupon is evaluated without the
-- per-customer checks, and the use is stored with user_id null.
-- 53a: the admin has a checkout order of her own, so "primera compra" and
-- "usos por clienta" would reject her if she were treated as the customer.
select lives_ok(
  $$ select public.crear_pedido(
       'Admin', '999', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', null, 'd2000000-0000-4000-8000-000000000001', null) $$,
  'the admin creates a checkout order of her own'
);
-- 53b
select is(
  public.validar_cupon('MBIENVENIDA', 2000)->>'mensaje',
  'Este cupón es solo para tu primera compra.',
  'without p_pedido_manual the admin is evaluated as a customer'
);
-- 53c
select is(
  public.validar_cupon('MBIENVENIDA', 2000, true)->>'valido', 'true',
  'manual-order preview: solo_primera_compra is skipped for the admin'
);
-- 53d
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Manual', '444', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'admin', null, 'd2000000-0000-4000-8000-000000000002', 'MBIENVENIDA') $$,
  'manual order with a primera-compra coupon'
);
-- 53e
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Manual', '444', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'admin', null, 'd2000000-0000-4000-8000-000000000003', 'MBIENVENIDA') $$,
  'a second manual order with the same primera-compra coupon also works'
);
-- 53f
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Manual', '444', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'admin', null, 'd2000000-0000-4000-8000-000000000004', 'MUNOCLI') $$,
  'manual order with a usos_por_cliente = 1 coupon'
);
-- 53g
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Manual', '444', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'admin', null, 'd2000000-0000-4000-8000-000000000005', 'MUNOCLI') $$,
  'a second manual order with the same usos_por_cliente = 1 coupon works'
);
-- 53h
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta Manual', '444', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'admin', null, 'd2000000-0000-4000-8000-000000000006', 'MUNOCLI') $$,
  'P0001', 'Este cupón ya no tiene usos disponibles.',
  'usos_max is still enforced for manual orders'
);
-- 53i
select is(
  public.validar_cupon('MUNOCLI', 2000, true)->>'mensaje',
  'Este cupón ya no tiene usos disponibles.',
  'manual-order preview also enforces usos_max'
);
-- 53j
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Manual', '444', null, 'coordinar', null, null, null, null,
       '[{"id":"b1000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'admin', null, 'd2000000-0000-4000-8000-000000000007', 'MSOLOCLI') $$,
  'manual order with another usos_por_cliente = 1 coupon'
);
-- 53k
select is(
  public.validar_cupon('MSOLOCLI', 2000)->>'valido', 'true',
  'a manual order does not consume the admin''s own per-customer quota'
);
-- 53l
select results_eq(
  $$ select count(*)::int, count(u.user_id)::int, bool_and(p.origen = 'admin')
       from public.cupon_usos u join public.pedidos p on p.id = u.pedido_id
      where u.cupon_id::text like 'f2000000-%' $$,
  $$ values (5, 0, true) $$,
  'manual-order coupon uses are stored with user_id null'
);
-- 54: cancelling an order frees its coupon use.
update public.pedidos set estado = 'cancelado'
 where idempotency_key = 'd1000000-0000-4000-8000-000000000005';

set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';

select is(
  public.validar_cupon('UNUSO', 2000)->>'valido', 'true',
  'cancelling the order that used a usos_max coupon frees that use'
);

-- ----------------------------------------------------------------------------
-- Constraints (as postgres).
-- ----------------------------------------------------------------------------
reset role;

-- 55
select throws_ok(
  $$ update public.pedidos set descuento = 99999
      where idempotency_key = 'd1000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'total cannot be negative'
);
-- 56
select throws_ok(
  $$ insert into public.cupon_usos (cupon_id, pedido_id)
     select 'f1000000-0000-4000-8000-000000000001', id from public.pedidos
      where idempotency_key = 'd1000000-0000-4000-8000-000000000001' $$,
  '23505', null,
  'an order can use at most one coupon'
);

select * from finish();

rollback;
