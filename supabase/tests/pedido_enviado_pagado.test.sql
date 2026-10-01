-- ============================================================================
-- pgTAP tests for migration 20261001030000_pedido_enviado_pagado.sql
--   * estado accepts 'enviado' and still rejects unknown values
--   * moving an order to 'enviado' does not touch stock
--   * an empleado can set estado, pagado_at and seguimiento, but not the
--     customer's data; a customer cannot change her own order
--   * seguimiento length limit
--
-- Everything runs inside one transaction that is rolled back at the end.
-- ============================================================================

begin;

select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('f4000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@enviado.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Clienta"}', now(), now()),
  ('f4000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'empleado@enviado.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Empleado"}', now(), now());

update public.profiles set rol = 'empleado' where id = 'f4000000-0000-4000-8000-0000000000e1';

insert into public.categorias (id, nombre) values ('f4c00000-0000-4000-8000-000000000001', 'Cat enviado');
insert into public.productos (id, nombre, categoria_id, precio, stock)
values ('f4b00000-0000-4000-8000-000000000001', 'Prod enviado', 'f4c00000-0000-4000-8000-000000000001', 1000, 5);

-- Pedido confirmado que reserva 2 unidades (el insert directo no descuenta:
-- lo hace crear_pedido; acá solo importa que el cambio de estado no toque).
insert into public.pedidos (id, user_id, nombre, telefono, items, subtotal, estado)
values ('f4d00000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
        'Clienta', '3515551234',
        '[{"id":"f4b00000-0000-4000-8000-000000000001","nombre":"Prod enviado","precio":1000,"cantidad":2}]',
        2000, 'confirmado');

-- 1
select lives_ok(
  $$ update public.pedidos set estado = 'enviado' where id = 'f4d00000-0000-4000-8000-000000000001' $$,
  'estado accepts enviado'
);
-- 2
select is(
  (select stock from public.productos where id = 'f4b00000-0000-4000-8000-000000000001'),
  5,
  'confirmado -> enviado does not change stock'
);
-- 3
select throws_ok(
  $$ update public.pedidos set estado = 'perdido' where id = 'f4d00000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'estado still rejects unknown values'
);
-- 4
select throws_ok(
  $$ update public.pedidos set seguimiento = repeat('x', 301) where id = 'f4d00000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'seguimiento is limited to 300 characters'
);

-- Como empleado.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000e1';

-- 5
select lives_ok(
  $$ update public.pedidos
        set estado = 'entregado', pagado_at = now(), seguimiento = 'AR123456789'
      where id = 'f4d00000-0000-4000-8000-000000000001' $$,
  'an empleado can set estado, pagado_at and seguimiento'
);
-- 6
select throws_ok(
  $$ update public.pedidos set nombre = 'Otra' where id = 'f4d00000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'an empleado still cannot change the customer data'
);

-- Como la clienta.
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-000000000001';

-- 7
select results_eq(
  $$ select estado, pagado_at is not null, seguimiento from public.pedidos
      where id = 'f4d00000-0000-4000-8000-000000000001' $$,
  $$ values ('entregado'::text, true, 'AR123456789'::text) $$,
  'the customer sees estado, payment and tracking of her order'
);
-- 8 (RLS filters the row out: no error, nothing changes; checked in 9)
select lives_ok(
  $$ update public.pedidos set pagado_at = null
      where id = 'f4d00000-0000-4000-8000-000000000001' $$,
  'a customer update on her own order is silently filtered by RLS'
);

reset role;
-- 9
select isnt(
  (select pagado_at from public.pedidos where id = 'f4d00000-0000-4000-8000-000000000001'),
  null,
  'the customer could not mark her own order as unpaid'
);

select * from finish();

rollback;
