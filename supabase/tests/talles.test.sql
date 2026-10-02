-- ============================================================================
-- pgTAP tests for migration 20261004010000_talles.sql
-- ============================================================================

begin;

select plan(15);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@talles.test', '{}', '{"nombre":"Ana"}', now(), now());

insert into public.categorias (id, nombre) values ('c1c00000-0000-4000-8000-000000000001', 'Cat talles');
insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('c1b00000-0000-4000-8000-000000000001', 'Body talles', 'c1c00000-0000-4000-8000-000000000001', 1000, 0),
  ('c1b00000-0000-4000-8000-000000000002', 'Manta sin talles', 'c1c00000-0000-4000-8000-000000000001', 500, 4);

insert into public.producto_talles (id, producto_id, talle, stock, orden) values
  ('c1d00000-0000-4000-8000-000000000001', 'c1b00000-0000-4000-8000-000000000001', '0-3 m', 2, 0),
  ('c1d00000-0000-4000-8000-000000000002', 'c1b00000-0000-4000-8000-000000000001', '3-6 m', 3, 1);

-- 1
select is(
  (select stock from public.productos where id = 'c1b00000-0000-4000-8000-000000000001'),
  5,
  'the product stock is the sum of its sizes'
);

update public.productos set stock = 99 where id = 'c1b00000-0000-4000-8000-000000000001';
-- 2
select is(
  (select stock from public.productos where id = 'c1b00000-0000-4000-8000-000000000001'),
  5,
  'with sizes, editing productos.stock directly has no effect'
);

-- 3
select throws_ok(
  $$ insert into public.producto_talles (producto_id, talle, stock)
     values ('c1b00000-0000-4000-8000-000000000001', ' 0-3 M ', 1) $$,
  '23505', null,
  'the same size cannot be added twice (case and spaces ignored)'
);

-- Pedidos.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';

-- 4
select throws_ok(
  $$ select public.crear_pedido('Ana', '3515551234', null, 'coordinar', null, null, null, null,
       '[{"id":"c1b00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0) $$,
  'P0001', 'Elegí el talle de "Body talles" antes de hacer el pedido.',
  'a product with sizes needs a size'
);

-- 5
select throws_ok(
  $$ select public.crear_pedido('Ana', '3515551234', null, 'coordinar', null, null, null, null,
       '[{"id":"c1b00000-0000-4000-8000-000000000001","talle_id":"c1d00000-0000-4000-8000-000000000001","cantidad":3}]'::jsonb, 0) $$,
  'P0001', 'De "Body talles" talle 0-3 m nos quedan 2 unidades. Ajustá la cantidad y volvé a intentar.',
  'cannot buy more than the stock of the size'
);

-- 6
select lives_ok(
  $$ select public.crear_pedido('Ana', '3515551234', null, 'coordinar', null, null, null, null,
       '[{"id":"c1b00000-0000-4000-8000-000000000001","talle_id":"c1d00000-0000-4000-8000-000000000002","cantidad":2},
         {"id":"c1b00000-0000-4000-8000-000000000002","cantidad":1}]'::jsonb, 0) $$,
  'an order with a size and a product without sizes works'
);

reset role;

-- 7
select is(
  (select stock from public.producto_talles where id = 'c1d00000-0000-4000-8000-000000000002'),
  1,
  'the size stock was decremented'
);
-- 8
select is(
  (select stock from public.productos where id = 'c1b00000-0000-4000-8000-000000000001'),
  3,
  'and the product stock follows the sum'
);
-- 9
select is(
  (select stock from public.productos where id = 'c1b00000-0000-4000-8000-000000000002'),
  3,
  'products without sizes work as before'
);
-- 10
select is(
  (select items->0->>'nombre' from public.pedidos where user_id = 'c1000000-0000-4000-8000-000000000001'),
  'Body talles (talle 3-6 m)',
  'the order item shows the size in its name'
);
-- 11
select is(
  (select items->0->>'talle' from public.pedidos where user_id = 'c1000000-0000-4000-8000-000000000001'),
  '3-6 m',
  'and keeps the size apart'
);

-- Cancelar devuelve al talle.
update public.pedidos set estado = 'cancelado' where user_id = 'c1000000-0000-4000-8000-000000000001';
-- 12
select is(
  (select stock from public.producto_talles where id = 'c1d00000-0000-4000-8000-000000000002'),
  3,
  'cancelling returns the stock to the size'
);
-- 13
select is(
  (select stock from public.productos where id = 'c1b00000-0000-4000-8000-000000000002'),
  4,
  'and to the product without sizes'
);

-- Permisos.
set local role anon;
-- 14
select is(
  (select count(*)::int from public.producto_talles where producto_id = 'c1b00000-0000-4000-8000-000000000001'),
  2,
  'anyone can read the sizes'
);
-- 15
select throws_ok(
  $$ insert into public.producto_talles (producto_id, talle, stock)
     values ('c1b00000-0000-4000-8000-000000000001', 'XL', 1) $$,
  '42501', null,
  'anon cannot add sizes'
);

select * from finish();

rollback;
