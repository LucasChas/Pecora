-- ============================================================================
-- pgTAP tests for migration 20260928010452_ventas_validas.sql
--   * one row per order item, excluding cancelled and trashed orders
--   * security_invoker: the pedidos RLS applies (admin sees all, a customer
--     only her own rows, anon nothing)
--   * malformed legacy items do not break the view
--
-- Run locally with:  supabase db start && supabase test db
--
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(17);

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres).
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'uno@ventas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Uno"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dos@ventas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Dos"}', now(), now()),
  ('a1000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@ventas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

update public.profiles set rol = 'admin' where id = 'a1000000-0000-4000-8000-0000000000ad';

-- Orders are inserted directly (not through crear_pedido): the view only reads
-- pedidos, and inserting does not touch stock.
--   d...01  customer 1, nuevo, 2 items            -> 2 rows
--   d...02  customer 1, cancelado                 -> excluded
--   d...03  customer 1, confirmado but trashed    -> excluded
--   d...04  customer 2, entregado                 -> 1 row
--   d...05  admin, manual order (origen admin)    -> 1 row
--   d...06  customer 2, items is not an array     -> no rows, no error
--   d...07  customer 2, garbage legacy item       -> 1 row with NULLs
insert into public.pedidos
  (id, user_id, nombre, telefono, items, subtotal, estado, eliminado_at, origen)
values
  ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'Uno', '111',
   '[{"id":"b1000000-0000-4000-8000-00000000000a","nombre":"Body","precio":1000,"cantidad":2},
     {"id":"b1000000-0000-4000-8000-00000000000b","nombre":"Gorro","precio":500,"cantidad":1}]',
   2500, 'nuevo', null, 'checkout'),
  ('d1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
   'Uno', '111',
   '[{"id":"b1000000-0000-4000-8000-00000000000a","nombre":"Body","precio":1000,"cantidad":1}]',
   1000, 'cancelado', null, 'checkout'),
  ('d1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001',
   'Uno', '111',
   '[{"id":"b1000000-0000-4000-8000-00000000000a","nombre":"Body","precio":1000,"cantidad":1}]',
   1000, 'confirmado', now(), 'checkout'),
  ('d1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002',
   'Dos', '222',
   '[{"id":"b1000000-0000-4000-8000-00000000000b","nombre":"Gorro","precio":500,"cantidad":3}]',
   1500, 'entregado', null, 'checkout'),
  ('d1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-0000000000ad',
   'Por WhatsApp', '555',
   '[{"id":"b1000000-0000-4000-8000-00000000000a","nombre":"Body","precio":1000,"cantidad":1}]',
   1000, 'nuevo', null, 'admin'),
  ('d1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000002',
   'Dos', '222', '{"legacy":true}', 0, 'nuevo', null, 'checkout'),
  ('d1000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000002',
   'Dos', '222', '[{"id":"not-a-uuid","nombre":"Viejo","precio":"abc","cantidad":1}]',
   0, 'nuevo', null, 'checkout');

-- ----------------------------------------------------------------------------
-- Definition and privileges.
-- ----------------------------------------------------------------------------
-- 1
select has_view('public', 'ventas_validas', 'view public.ventas_validas exists');
-- 2
select is(
  (select 'security_invoker=true' = any (c.reloptions)
     from pg_class c where c.oid = 'public.ventas_validas'::regclass),
  true,
  'ventas_validas is security_invoker (RLS of pedidos applies)'
);
-- 3
select results_eq(
  $$ select column_name::text collate "default", data_type::text collate "default"
       from information_schema.columns
      where table_schema = 'public' and table_name = 'ventas_validas'
      order by ordinal_position $$,
  $$ values ('pedido_id'::text, 'uuid'::text),
            ('numero', 'bigint'),
            ('created_at', 'timestamp with time zone'),
            ('user_id', 'uuid'),
            ('origen', 'text'),
            ('producto_id', 'uuid'),
            ('nombre', 'text'),
            ('precio', 'numeric'),
            ('cantidad', 'integer'),
            ('importe', 'numeric') $$,
  'ventas_validas exposes the agreed columns'
);
-- 4
select is(
  has_table_privilege('authenticated', 'public.ventas_validas', 'SELECT'),
  true,
  'authenticated can select ventas_validas'
);
-- 5
select is(
  has_table_privilege('anon', 'public.ventas_validas', 'SELECT'),
  false,
  'anon cannot select ventas_validas'
);
-- 6
select is(
  has_table_privilege('authenticated', 'public.ventas_validas', 'INSERT')
    or has_table_privilege('authenticated', 'public.ventas_validas', 'UPDATE')
    or has_table_privilege('authenticated', 'public.ventas_validas', 'DELETE'),
  false,
  'authenticated cannot write through ventas_validas'
);

-- ----------------------------------------------------------------------------
-- As admin: every valid sale.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-0000000000ad';

-- 7
select results_eq(
  $$ select pedido_id, user_id, origen, producto_id, nombre, precio, cantidad, importe
       from public.ventas_validas
      where pedido_id in ('d1000000-0000-4000-8000-000000000001',
                          'd1000000-0000-4000-8000-000000000004',
                          'd1000000-0000-4000-8000-000000000005')
      order by pedido_id, producto_id $$,
  $$ values
       ('d1000000-0000-4000-8000-000000000001'::uuid, 'a1000000-0000-4000-8000-000000000001'::uuid,
        'checkout'::text, 'b1000000-0000-4000-8000-00000000000a'::uuid, 'Body'::text,
        1000::numeric, 2, 2000::numeric),
       ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
        'checkout', 'b1000000-0000-4000-8000-00000000000b', 'Gorro', 500, 1, 500),
       ('d1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002',
        'checkout', 'b1000000-0000-4000-8000-00000000000b', 'Gorro', 500, 3, 1500),
       ('d1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-0000000000ad',
        'admin', 'b1000000-0000-4000-8000-00000000000a', 'Body', 1000, 1, 1000) $$,
  'admin sees one row per item of every valid order, importe = precio * cantidad'
);
-- 8
select is(
  (select numero from public.ventas_validas
    where pedido_id = 'd1000000-0000-4000-8000-000000000004'),
  (select numero from public.pedidos
    where id = 'd1000000-0000-4000-8000-000000000004'),
  'numero is the order number'
);
-- 9
select is_empty(
  $$ select 1 from public.ventas_validas
      where pedido_id = 'd1000000-0000-4000-8000-000000000002' $$,
  'cancelled orders are excluded'
);
-- 10
select is_empty(
  $$ select 1 from public.ventas_validas
      where pedido_id = 'd1000000-0000-4000-8000-000000000003' $$,
  'trashed orders are excluded'
);
-- 11
select is_empty(
  $$ select 1 from public.ventas_validas
      where pedido_id = 'd1000000-0000-4000-8000-000000000006' $$,
  'an order whose items is not an array yields no rows (and no error)'
);
-- 12
select results_eq(
  $$ select producto_id is null, nombre, precio is null, cantidad, importe is null
       from public.ventas_validas
      where pedido_id = 'd1000000-0000-4000-8000-000000000007' $$,
  $$ values (true, 'Viejo'::text, true, 1, true) $$,
  'a malformed legacy item yields NULLs instead of breaking the view'
);

-- ----------------------------------------------------------------------------
-- As customer 1: only her own valid sales (no filter in the query: RLS does it).
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';

-- 13
select results_eq(
  $$ select pedido_id, producto_id, cantidad from public.ventas_validas
      order by pedido_id, producto_id $$,
  $$ values
       ('d1000000-0000-4000-8000-000000000001'::uuid, 'b1000000-0000-4000-8000-00000000000a'::uuid, 2),
       ('d1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-00000000000b', 1) $$,
  'customer 1 sees only the rows of her own valid orders'
);
-- 14 (she can still read her trashed order in pedidos, per 0010; the view hides it)
select is(
  (select count(*)::int from public.pedidos
    where id = 'd1000000-0000-4000-8000-000000000003'),
  1,
  'customer 1 can read her trashed order in pedidos but not as a sale'
);

-- ----------------------------------------------------------------------------
-- As customer 2.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';

-- 15
select results_eq(
  $$ select pedido_id from public.ventas_validas order by pedido_id $$,
  $$ values ('d1000000-0000-4000-8000-000000000004'::uuid),
            ('d1000000-0000-4000-8000-000000000007'::uuid) $$,
  'customer 2 sees only the rows of her own valid orders'
);
-- 16
select is_empty(
  $$ select 1 from public.ventas_validas
      where user_id is distinct from 'a1000000-0000-4000-8000-000000000002' $$,
  'customer 2 sees no rows of other accounts'
);

-- ----------------------------------------------------------------------------
-- As anon.
-- ----------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 17
select throws_ok(
  $$ select * from public.ventas_validas $$,
  '42501', null,
  'anon cannot read ventas_validas'
);

select * from finish();

rollback;
