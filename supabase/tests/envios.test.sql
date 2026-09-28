-- ============================================================================
-- pgTAP tests for migration 20260928122650_cupones_y_envios.sql (envíos)
--   * zonas_envio: schema, normalization, RLS and privileges
--   * cotizar_envio: CP prefix vs province vs no zone, gratis_desde,
--     inactive zones
--   * crear_pedido: costo_envio / zona computed server-side
--
-- Run locally with:  supabase db start && supabase test db --local
--
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(26);

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres).
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'uno@envios.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Uno"}', now(), now()),
  ('a2000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@envios.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

update public.profiles set rol = 'admin' where id = 'a2000000-0000-4000-8000-0000000000ad';

insert into public.productos (id, nombre, precio, stock) values
  ('b2100000-0000-4000-8000-000000000001', 'Producto envios', 1000, 100);

-- Only these zones are active during the test. The province zone has a lower
-- `orden` than the CP zone on purpose: a CP match must still win.
update public.zonas_envio set activo = false;
insert into public.zonas_envio
  (id, nombre, provincias, cp_prefijos, precio, gratis_desde, activo, orden)
values
  ('e2000000-0000-4000-8000-000000000001', 'Córdoba Capital', '{}', '{" X5000 ", ""}', 1500, 50000, true, 1),
  ('e2000000-0000-4000-8000-000000000002', 'Córdoba provincia', '{"Córdoba"}', '{}', 3000, null, true, 0),
  ('e2000000-0000-4000-8000-000000000003', 'Buenos Aires (inactiva)', '{"Buenos Aires"}', '{}', 100, null, false, 0),
  ('e2000000-0000-4000-8000-000000000004', 'Santa Fe', '{" santa fe "}', '{}', 2500, 0, true, 5);

-- ----------------------------------------------------------------------------
-- Schema and privileges.
-- ----------------------------------------------------------------------------
-- 1
select has_table('public', 'zonas_envio', 'zonas_envio exists');
-- 2
select is(
  (select relrowsecurity from pg_class where oid = 'public.zonas_envio'::regclass),
  true,
  'RLS is enabled on zonas_envio'
);
-- 3
select results_eq(
  $$ select cp_prefijos, provincias from public.zonas_envio
      where id in ('e2000000-0000-4000-8000-000000000001',
                   'e2000000-0000-4000-8000-000000000004')
      order by id $$,
  $$ values ('{5000}'::text[], '{}'::text[]), ('{}', '{"santa fe"}') $$,
  'CP prefixes are normalized to digits and blanks are dropped'
);
-- 4
select throws_ok(
  $$ insert into public.zonas_envio (nombre, precio) values ('Negativa', -1) $$,
  '23514', null,
  'a negative precio is rejected'
);
-- 5
select results_eq(
  $$ select r.rol::text, f.fn::text, has_function_privilege(r.rol, f.fn, 'EXECUTE')
       from (values ('anon'), ('authenticated')) r(rol),
            (values ('public.cotizar_envio(text, text, numeric)'),
                    ('public.buscar_zona_envio(text, text)')) f(fn)
      order by 1, 2 $$,
  $$ values ('anon'::text, 'public.buscar_zona_envio(text, text)'::text, false),
            ('anon', 'public.cotizar_envio(text, text, numeric)', true),
            ('authenticated', 'public.buscar_zona_envio(text, text)', false),
            ('authenticated', 'public.cotizar_envio(text, text, numeric)', true) $$,
  'cotizar_envio is public; buscar_zona_envio is internal'
);

-- ----------------------------------------------------------------------------
-- As anon.
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 6
select results_eq(
  $$ select nombre from public.zonas_envio where id::text like 'e2000000-%' order by nombre $$,
  $$ values ('Córdoba Capital'::text), ('Córdoba provincia'), ('Santa Fe') $$,
  'anon reads the active zones only'
);
-- 7
select throws_ok(
  $$ insert into public.zonas_envio (nombre, precio) values ('Anon', 1) $$,
  '42501', null,
  'anon cannot insert zonas_envio'
);
-- 8: CP prefix match ("X5000ABC" -> 5000), even though a province zone has a
-- lower orden.
select is(
  public.cotizar_envio('Córdoba', 'X5000ABC', 1000),
  '{"zona_id":"e2000000-0000-4000-8000-000000000001","zona_nombre":"Córdoba Capital",
    "costo":1500,"gratis":false,"disponible":true,"mensaje":null}'::jsonb,
  'a CP prefix match wins over the province'
);
-- 9: province match, case- and accent-insensitive.
select is(
  public.cotizar_envio('CORDOBA', '5800', 1000),
  '{"zona_id":"e2000000-0000-4000-8000-000000000002","zona_nombre":"Córdoba provincia",
    "costo":3000,"gratis":false,"disponible":true,"mensaje":null}'::jsonb,
  'province match ignores case and accents'
);
-- 10
select is(
  public.cotizar_envio('Mendoza', '5500', 1000),
  '{"zona_id":null,"zona_nombre":null,"costo":0,"gratis":false,"disponible":false,
    "mensaje":"Consultanos el costo de envío a tu zona."}'::jsonb,
  'no zone: disponible = false, costo 0, coordinated'
);
-- 11
select is(
  public.cotizar_envio('Buenos Aires', null, 1000)->>'disponible', 'false',
  'inactive zones are ignored'
);
-- 12
select results_eq(
  $$ select (r->>'costo')::numeric, (r->>'gratis')::boolean
       from (values (public.cotizar_envio('Córdoba', '5000', 50000)),
                    (public.cotizar_envio('Córdoba', '5000', 49999.99))) v(r) $$,
  $$ values (0::numeric, true), (1500::numeric, false) $$,
  'gratis_desde: free from the threshold, paid just below it'
);
-- 13
select is(
  public.cotizar_envio(null, null, 1000)->>'disponible', 'false',
  'no province and no CP: not available'
);

-- ----------------------------------------------------------------------------
-- As a customer.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';

-- 14
select throws_ok(
  $$ insert into public.zonas_envio (nombre, precio) values ('Clienta', 1) $$,
  '42501', null,
  'a customer cannot insert zonas_envio'
);
-- 15
select is_empty(
  $$ update public.zonas_envio set precio = 0
      where id = 'e2000000-0000-4000-8000-000000000001' returning id $$,
  'a customer cannot update zonas_envio'
);
-- 16
select is_empty(
  $$ select 1 from public.zonas_envio where id = 'e2000000-0000-4000-8000-000000000003' $$,
  'a customer cannot see inactive zones'
);
-- 17
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Córdoba', 'X5000ABC', null,
       '[{"id":"b2100000-0000-4000-8000-000000000001","cantidad":2}]'::jsonb,
       0, 'checkout', 'Córdoba', 'd2100000-0000-4000-8000-000000000001') $$,
  'order with shipping to a CP zone'
);
-- 18
select results_eq(
  $$ select costo_envio, total, zona_id, zona_nombre from public.pedidos
      where idempotency_key = 'd2100000-0000-4000-8000-000000000001' $$,
  $$ values (1500::numeric, 3500::numeric,
             'e2000000-0000-4000-8000-000000000001'::uuid, 'Córdoba Capital'::text) $$,
  'crear_pedido stores the zone and its shipping cost'
);
-- 19
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Rosario', '2000', null,
       '[{"id":"b2100000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Santa Fe', 'd2100000-0000-4000-8000-000000000002') $$,
  'order with shipping to a province zone with gratis_desde = 0'
);
-- 20
select results_eq(
  $$ select costo_envio, zona_nombre from public.pedidos
      where idempotency_key = 'd2100000-0000-4000-8000-000000000002' $$,
  $$ values (0::numeric, 'Santa Fe'::text) $$,
  'gratis_desde reached: costo_envio = 0, zone still recorded'
);
-- 21
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'envio', 'Calle 1', 'Mendoza', '5500', null,
       '[{"id":"b2100000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Mendoza', 'd2100000-0000-4000-8000-000000000003') $$,
  'order with shipping to a place without zone'
);
-- 22
select results_eq(
  $$ select costo_envio, zona_id, zona_nombre from public.pedidos
      where idempotency_key = 'd2100000-0000-4000-8000-000000000003' $$,
  $$ values (0::numeric, null::uuid, null::text) $$,
  'no zone: costo_envio = 0 and no zone (coordinated)'
);
-- 23
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta', '111', null, 'coordinar', null, null, '5000', null,
       '[{"id":"b2100000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
       0, 'checkout', 'Córdoba', 'd2100000-0000-4000-8000-000000000004') $$,
  'order with entrega = coordinar'
);
-- 24
select results_eq(
  $$ select costo_envio, zona_id from public.pedidos
      where idempotency_key = 'd2100000-0000-4000-8000-000000000004' $$,
  $$ values (0::numeric, null::uuid) $$,
  'entrega = coordinar never charges shipping'
);

-- ----------------------------------------------------------------------------
-- As admin.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a2000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-0000000000ad';

-- 25
select is(
  (select count(*)::int from public.zonas_envio where id::text like 'e2000000-%'),
  4,
  'the admin sees inactive zones too'
);
-- 26
select lives_ok(
  $$ insert into public.zonas_envio (nombre, provincias, precio)
     values ('Mendoza', '{Mendoza}', 4000) $$,
  'the admin can create zones'
);

select * from finish();

rollback;
