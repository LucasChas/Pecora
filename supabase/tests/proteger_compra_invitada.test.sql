-- ============================================================================
-- pgTAP tests for migration 20261008120000_proteger_compra_invitada.sql
--   * anon can no longer call crear_pedido; service_role (the Edge Function
--     crear-pedido-invitada) can, and that creates a guest order
--   * checkout orders: at most 10 units per product (and size) and 30 in
--     total, before any stock is touched; manual orders by staff are not capped
--   * no global cap for guest orders
--   * registrar_intento_invitada: 5 per 10 minutes per connection, only for
--     service_role; intentos_invitada is not exposed
--
-- Everything runs inside one transaction that is rolled back at the end.
-- ============================================================================

begin;

select plan(17);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@topes.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Clienta"}', now(), now()),
  ('c3000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@topes.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());
update public.profiles set rol = 'admin' where id = 'c3000000-0000-4000-8000-0000000000ad';

insert into public.categorias (id, nombre) values ('c3c00000-0000-4000-8000-000000000001', 'Cat topes');
insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('c3b00000-0000-4000-8000-000000000001', 'Prod A', 'c3c00000-0000-4000-8000-000000000001', 100, 100),
  ('c3b00000-0000-4000-8000-000000000002', 'Prod B', 'c3c00000-0000-4000-8000-000000000001', 100, 100),
  ('c3b00000-0000-4000-8000-000000000003', 'Prod C', 'c3c00000-0000-4000-8000-000000000001', 100, 100),
  ('c3b00000-0000-4000-8000-000000000004', 'Prod D', 'c3c00000-0000-4000-8000-000000000001', 100, 100);

create function pg_temp.pedir(p_items jsonb, p_email text default 'ana@topes.test',
                              p_origen text default 'checkout')
returns bigint language sql as $$
  select public.crear_pedido(
    'Ana', '3515557777', p_email, 'coordinar', null, null, null, null,
    p_items, 0, p_origen, null, null, null, null)
$$;
grant execute on function pg_temp.pedir(jsonb, text, text) to anon, authenticated, service_role;

create function pg_temp.stock_total() returns bigint language sql as $$
  select sum(stock) from public.productos where categoria_id = 'c3c00000-0000-4000-8000-000000000001'
$$;

-- 1
select is(
  has_function_privilege('anon',
    'public.crear_pedido(text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text, uuid)',
    'EXECUTE'),
  false,
  'anon cannot execute crear_pedido'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
-- 2
select throws_ok(
  $$ select pg_temp.pedir('[{"id":"c3b00000-0000-4000-8000-000000000001","cantidad":1}]') $$,
  '42501', null,
  'a guest order with the anon key is rejected'
);
reset role;

-- ---- As the Edge Function (service_role, no user) ----------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
-- 3
select lives_ok(
  $$ select pg_temp.pedir('[{"id":"c3b00000-0000-4000-8000-000000000001","cantidad":10}]') $$,
  'service_role can place a guest order with 10 units of a product'
);
-- 4
select throws_ok(
  $$ select pg_temp.pedir('[{"id":"c3b00000-0000-4000-8000-000000000001","cantidad":11}]', 'b@topes.test') $$,
  'P0001', 'Podés pedir hasta 10 unidades de cada producto. Si necesitás más, escribinos por WhatsApp.',
  '11 units of one product are rejected'
);
-- 5
select throws_ok(
  $$ select pg_temp.pedir('[{"id":"c3b00000-0000-4000-8000-000000000001","cantidad":6},
                            {"id":"c3b00000-0000-4000-8000-000000000001","cantidad":5}]', 'c@topes.test') $$,
  'P0001', 'Podés pedir hasta 10 unidades de cada producto. Si necesitás más, escribinos por WhatsApp.',
  'splitting a product in two lines does not skip the cap'
);
-- 6
select throws_ok(
  $$ select pg_temp.pedir('[{"id":"c3b00000-0000-4000-8000-000000000001","cantidad":10},
                            {"id":"c3b00000-0000-4000-8000-000000000002","cantidad":10},
                            {"id":"c3b00000-0000-4000-8000-000000000003","cantidad":10},
                            {"id":"c3b00000-0000-4000-8000-000000000004","cantidad":1}]', 'd@topes.test') $$,
  'P0001', 'Podés pedir hasta 30 unidades por pedido. Si necesitás más, escribinos por WhatsApp.',
  'more than 30 units in total are rejected'
);
reset role;
-- 7
select is(pg_temp.stock_total(), 390::bigint,
  'only the accepted order took stock');
-- 8
select is(
  (select count(*)::int from public.pedidos where user_id is null and email = 'ana@topes.test'),
  1,
  'the accepted guest order has no account'
);

-- ---- No global cap: 45 guest orders in the last hour from other people ----------------
insert into public.pedidos (nombre, telefono, email, entrega, items, subtotal, origen, created_at)
select 'Otra ' || g, '35100' || g, 'otra' || g || '@topes.test', 'coordinar', '[]'::jsonb, 0,
       'checkout', now() - interval '5 minutes'
  from generate_series(1, 45) g;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
-- 9
select lives_ok(
  $$ select pg_temp.pedir('[{"id":"c3b00000-0000-4000-8000-000000000002","cantidad":1}]', 'e@topes.test') $$,
  'there is no global cap for guest orders anymore'
);
reset role;

-- ---- With an account: same caps ---------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'c3000000-0000-4000-8000-000000000001';
-- 10
select throws_ok(
  $$ select pg_temp.pedir('[{"id":"c3b00000-0000-4000-8000-000000000003","cantidad":11}]') $$,
  'P0001', 'Podés pedir hasta 10 unidades de cada producto. Si necesitás más, escribinos por WhatsApp.',
  'an account has the same cap'
);
reset role;

-- ---- Manual order by the admin: no cap ------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c3000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'c3000000-0000-4000-8000-0000000000ad';
-- 11
select lives_ok(
  $$ select pg_temp.pedir('[{"id":"c3b00000-0000-4000-8000-000000000004","cantidad":40}]', null, 'admin') $$,
  'a manual order by the admin is not capped'
);
reset role;

-- ---- registrar_intento_invitada -----------------------------------------------------------
-- 12
select results_eq(
  $$ select r.rol::text, has_function_privilege(r.rol, 'public.registrar_intento_invitada(text)', 'EXECUTE')
       from (values ('anon'), ('authenticated'), ('service_role')) r(rol) order by 1 $$,
  $$ values ('anon'::text, false), ('authenticated', false), ('service_role', true) $$,
  'registrar_intento_invitada: only service_role'
);
-- 13
select results_eq(
  $$ select r.rol::text, has_table_privilege(r.rol, 'public.intentos_invitada', 'SELECT')
       from (values ('anon'), ('authenticated')) r(rol) order by 1 $$,
  $$ values ('anon'::text, false), ('authenticated', false) $$,
  'intentos_invitada is not readable by anon or authenticated'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
-- 14
select is(
  (select array_agg(public.registrar_intento_invitada('hash-a') order by g) from generate_series(1, 6) g),
  array[true, true, true, true, true, false],
  'five attempts per connection in 10 minutes, the sixth is rejected'
);
-- 15
select ok(public.registrar_intento_invitada('hash-b'), 'another connection is not affected');
reset role;
-- 16
select is((select count(*)::int from public.intentos_invitada where ip_hash = 'hash-a'), 5,
  'the rejected attempt is not stored');

update public.intentos_invitada set created_at = now() - interval '11 minutes' where ip_hash = 'hash-a';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
-- 17
select ok(public.registrar_intento_invitada('hash-a'), 'after 10 minutes the connection can try again');
reset role;

select * from finish();

rollback;
