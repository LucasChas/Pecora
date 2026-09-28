-- ============================================================================
-- pgTAP tests for migration 20260928010451_pedido_totales.sql
--   * pedidos: descuento / costo_envio / total / provincia / idempotency_key /
--     email_enviado_at / aviso_duena_enviado_at
--   * productos: check (precio >= 0)
--   * crear_pedido(13 args): server-side prices and stock, idempotency,
--     origen only 'admin' for admins, privileges.
--
-- Run locally with:  supabase db start && supabase test db
--
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(37);

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres): two customers, one admin, two products.
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'uno@pecora.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Uno"}', now(), now()),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dos@pecora.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Dos"}', now(), now()),
  ('a0000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@pecora.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

-- postgres may change rol (0014 only blocks authenticated/anon).
update public.profiles set rol = 'admin' where id = 'a0000000-0000-4000-8000-0000000000ad';

insert into public.productos (id, nombre, precio, stock) values
  ('b0000000-0000-4000-8000-00000000000a', 'Body test A', 1000, 5),
  ('b0000000-0000-4000-8000-00000000000b', 'Gorro test B', 500, 1);

-- ----------------------------------------------------------------------------
-- Schema.
-- ----------------------------------------------------------------------------
-- 1
select results_eq(
  $$ select column_name::text collate "default", data_type::text collate "default",
            is_nullable::text collate "default", is_generated::text collate "default"
       from information_schema.columns
      where table_schema = 'public' and table_name = 'pedidos'
        and column_name in ('descuento', 'costo_envio', 'total', 'provincia',
                            'idempotency_key', 'email_enviado_at', 'aviso_duena_enviado_at')
      order by column_name $$,
  $$ values
       ('aviso_duena_enviado_at'::text, 'timestamp with time zone'::text, 'YES'::text, 'NEVER'::text),
       ('costo_envio', 'numeric', 'NO', 'NEVER'),
       ('descuento', 'numeric', 'NO', 'NEVER'),
       ('email_enviado_at', 'timestamp with time zone', 'YES', 'NEVER'),
       ('idempotency_key', 'uuid', 'YES', 'NEVER'),
       ('provincia', 'text', 'YES', 'NEVER'),
       ('total', 'numeric', 'YES', 'ALWAYS') $$,
  'pedidos has the new columns (total is generated)'
);
-- 2
select col_type_is('public', 'pedidos', 'descuento', 'numeric(12,2)', 'descuento is numeric(12,2)');
-- 3
select col_type_is('public', 'pedidos', 'costo_envio', 'numeric(12,2)', 'costo_envio is numeric(12,2)');
-- 4
select col_type_is('public', 'pedidos', 'total', 'numeric(12,2)', 'total is numeric(12,2)');
-- 5
select is(
  (select i.indisunique from pg_index i
    where i.indexrelid = to_regclass('public.pedidos_idempotency_key_key')),
  true,
  'idempotency_key has a unique index'
);
-- 6
select has_function(
  'public', 'crear_pedido',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
        'jsonb', 'numeric', 'text', 'text', 'uuid', 'text'],
  'crear_pedido has the current signature (13 args + p_cupon from cupones_y_envios)'
);
-- 7
select hasnt_function(
  'public', 'crear_pedido',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
        'jsonb', 'numeric', 'text'],
  'the old 11-argument crear_pedido is gone (no ambiguous overload for PostgREST)'
);
-- 8
select is(
  has_function_privilege('anon',
    'public.crear_pedido(text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text)',
    'EXECUTE'),
  false,
  'anon cannot execute crear_pedido'
);
-- 9
select is(
  has_function_privilege('authenticated',
    'public.crear_pedido(text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text)',
    'EXECUTE'),
  true,
  'authenticated can execute crear_pedido'
);
-- 10 (a NULL proacl means the default: EXECUTE for PUBLIC)
select is(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p
    where p.oid = to_regprocedure(
      'public.crear_pedido(text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text)')),
  true,
  'PUBLIC has no EXECUTE on crear_pedido'
);

-- ----------------------------------------------------------------------------
-- As customer 1.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';

-- 11: p_subtotal = 1 and p_origen = 'admin' are both attempts to cheat.
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '0351 15-111-1111', 'uno@pecora.test', 'envio',
       'Calle 1', 'Córdoba', '5000', null,
       '[{"id":"b0000000-0000-4000-8000-00000000000a","cantidad":2,"precio":1},
         {"id":"b0000000-0000-4000-8000-00000000000b","cantidad":1,"precio":1}]'::jsonb,
       1, 'admin', 'Córdoba', 'c0000000-0000-4000-8000-000000000001') $$,
  'customer creates an order with an idempotency key'
);
-- 12
select is(
  (select subtotal from public.pedidos
    where idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  2500::numeric,
  'subtotal is computed from DB prices (p_subtotal is ignored)'
);
-- 13
select results_eq(
  $$ select (e->>'id')::uuid, (e->>'precio')::numeric, (e->>'cantidad')::int
       from public.pedidos p, jsonb_array_elements(p.items) e
      where p.idempotency_key = 'c0000000-0000-4000-8000-000000000001'
      order by 1 $$,
  $$ values ('b0000000-0000-4000-8000-00000000000a'::uuid, 1000::numeric, 2),
            ('b0000000-0000-4000-8000-00000000000b'::uuid, 500::numeric, 1) $$,
  'items are rebuilt with DB prices (client prices are ignored)'
);
-- 14
select is(
  (select origen from public.pedidos
    where idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  'checkout',
  'a non-admin passing p_origen = admin gets checkout'
);
-- 15
select is(
  (select provincia from public.pedidos
    where idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  'Córdoba',
  'provincia is saved'
);
-- 16
select results_eq(
  $$ select descuento, costo_envio, total from public.pedidos
      where idempotency_key = 'c0000000-0000-4000-8000-000000000001' $$,
  $$ values (0::numeric, 0::numeric, 2500::numeric) $$,
  'a new order has descuento = 0, costo_envio = 0 and total = subtotal'
);
-- 17
select results_eq(
  $$ select id, stock from public.productos
      where id in ('b0000000-0000-4000-8000-00000000000a',
                   'b0000000-0000-4000-8000-00000000000b')
      order by id $$,
  $$ values ('b0000000-0000-4000-8000-00000000000a'::uuid, 3),
            ('b0000000-0000-4000-8000-00000000000b'::uuid, 0) $$,
  'stock is decremented'
);

-- 18: same key again, with a cart that could not even be fulfilled: it must
-- return the existing order without looking at the items or the stock.
select is(
  public.crear_pedido(
    'Clienta Uno', '0351 15-111-1111', 'uno@pecora.test', 'envio',
    'Calle 1', 'Córdoba', '5000', null,
    '[{"id":"b0000000-0000-4000-8000-00000000000a","cantidad":99}]'::jsonb,
    0, 'checkout', 'Córdoba', 'c0000000-0000-4000-8000-000000000001'),
  (select numero from public.pedidos
    where idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  'same idempotency key returns the same numero'
);
-- 19
select is(
  (select count(*)::int from public.pedidos
    where idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'the retry does not create a second order'
);
-- 20
select results_eq(
  $$ select id, stock from public.productos
      where id in ('b0000000-0000-4000-8000-00000000000a',
                   'b0000000-0000-4000-8000-00000000000b')
      order by id $$,
  $$ values ('b0000000-0000-4000-8000-00000000000a'::uuid, 3),
            ('b0000000-0000-4000-8000-00000000000b'::uuid, 0) $$,
  'the retry does not decrement stock again'
);

-- 21: A is available, B is sold out -> the whole order fails.
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta Uno', '0351 15-111-1111', 'uno@pecora.test', 'coordinar',
       null, null, null, null,
       '[{"id":"b0000000-0000-4000-8000-00000000000a","cantidad":1},
         {"id":"b0000000-0000-4000-8000-00000000000b","cantidad":1}]'::jsonb,
       0, 'checkout', null, 'c0000000-0000-4000-8000-000000000002') $$,
  'P0001',
  'De "Gorro test B" nos quedan 0 unidades. Ajustá la cantidad y volvé a intentar.',
  'insufficient stock raises'
);
-- 22
select results_eq(
  $$ select id, stock from public.productos
      where id in ('b0000000-0000-4000-8000-00000000000a',
                   'b0000000-0000-4000-8000-00000000000b')
      order by id $$,
  $$ values ('b0000000-0000-4000-8000-00000000000a'::uuid, 3),
            ('b0000000-0000-4000-8000-00000000000b'::uuid, 0) $$,
  'a failed order does not change any stock (not even of the available item)'
);
-- 23
select is_empty(
  $$ select 1 from public.pedidos
      where idempotency_key = 'c0000000-0000-4000-8000-000000000002' $$,
  'a failed order is not saved'
);
-- 24
select is_empty(
  $$ update public.pedidos set descuento = 100
      where idempotency_key = 'c0000000-0000-4000-8000-000000000001'
      returning id $$,
  'a customer cannot set a discount on her own order'
);

-- ----------------------------------------------------------------------------
-- As customer 2: reusing customer 1's key.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000002';

-- 25
select throws_ok(
  $$ select public.crear_pedido(
       'Clienta Dos', '222', null, 'coordinar', null, null, null, null,
       '[{"id":"b0000000-0000-4000-8000-00000000000a","cantidad":1}]'::jsonb,
       0, 'checkout', null, 'c0000000-0000-4000-8000-000000000001') $$,
  'P0001',
  'No se pudo registrar el pedido. Recargá la página y volvé a intentar.',
  'another account cannot reuse an idempotency key'
);

-- ----------------------------------------------------------------------------
-- As anon.
-- ----------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 26
select throws_ok(
  $$ select public.crear_pedido(
       'Anon', '333', null, 'coordinar', null, null, null, null,
       '[{"id":"b0000000-0000-4000-8000-00000000000a","cantidad":1}]'::jsonb,
       0, 'checkout', null, null) $$,
  '42501', null,
  'anon cannot call crear_pedido'
);

-- ----------------------------------------------------------------------------
-- As admin.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-0000000000ad';

-- 27
select lives_ok(
  $$ select public.crear_pedido(
       'Pedido por WhatsApp', '444', null, 'coordinar', null, null, null, null,
       '[{"id":"b0000000-0000-4000-8000-00000000000a","cantidad":1}]'::jsonb,
       0, 'admin', null, 'c0000000-0000-4000-8000-000000000003') $$,
  'admin creates a manual order'
);
-- 28
select is(
  (select origen from public.pedidos
    where idempotency_key = 'c0000000-0000-4000-8000-000000000003'),
  'admin',
  'an admin can set origen = admin'
);
-- 29
select isnt(
  public.crear_pedido(
    'Sin clave 1', '555', null, 'coordinar', null, null, null, null,
    '[{"id":"b0000000-0000-4000-8000-00000000000a","cantidad":1}]'::jsonb,
    0, 'checkout', null, null),
  public.crear_pedido(
    'Sin clave 2', '555', null, 'coordinar', null, null, null, null,
    '[{"id":"b0000000-0000-4000-8000-00000000000a","cantidad":1}]'::jsonb,
    0, 'checkout', null, null),
  'without an idempotency key every call creates a new order'
);
-- 30
select lives_ok(
  $$ update public.pedidos set descuento = 300, costo_envio = 800
      where idempotency_key = 'c0000000-0000-4000-8000-000000000001' $$,
  'admin sets descuento and costo_envio'
);
-- 31
select is(
  (select total from public.pedidos
    where idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  3000::numeric,
  'total = subtotal - descuento + costo_envio (2500 - 300 + 800)'
);

-- ----------------------------------------------------------------------------
-- Constraints (as postgres).
-- ----------------------------------------------------------------------------
reset role;

-- 32
select throws_ok(
  $$ update public.pedidos set descuento = -1
      where idempotency_key = 'c0000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'a negative descuento is rejected'
);
-- 33
select throws_ok(
  $$ update public.pedidos set costo_envio = -1
      where idempotency_key = 'c0000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'a negative costo_envio is rejected'
);
-- 34
select throws_ok(
  $$ update public.pedidos set total = 1
      where idempotency_key = 'c0000000-0000-4000-8000-000000000001' $$,
  '428C9', null,
  'total cannot be written (generated column)'
);
-- 35
select throws_ok(
  $$ update public.productos set precio = -1
      where id = 'b0000000-0000-4000-8000-00000000000a' $$,
  '23514', null,
  'a negative product price is rejected on update'
);
-- 36
select throws_ok(
  $$ insert into public.productos (nombre, precio, stock) values ('Negativo', -10, 1) $$,
  '23514', null,
  'a negative product price is rejected on insert'
);
-- 37
select lives_ok(
  $$ update public.productos set precio = 0
      where id = 'b0000000-0000-4000-8000-00000000000a' $$,
  'a product price of 0 is allowed'
);

select * from finish();

rollback;
