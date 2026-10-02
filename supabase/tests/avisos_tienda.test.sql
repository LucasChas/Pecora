-- ============================================================================
-- pgTAP tests for migration 20261003010000_avisos_tienda.sql
-- ============================================================================

begin;

select plan(19);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, email_confirmed_at
) values
  ('be000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@at.test', '{}', '{"nombre":"Ana"}', now(), now(), now()),
  ('be000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'otra@at.test', '{}', '{"nombre":"Otra"}', now(), now(), now()),
  ('be000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sin@at.test', '{}', '{"nombre":"Sin"}', now(), now(), null);

insert into public.categorias (id, nombre) values ('bec00000-0000-4000-8000-000000000001', 'Cat at');
insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('beb00000-0000-4000-8000-000000000001', 'Body at', 'bec00000-0000-4000-8000-000000000001', 100, 10),
  ('beb00000-0000-4000-8000-000000000002', 'Gorro at', 'bec00000-0000-4000-8000-000000000001', 50, 1);

-- ---- Stock bajo ----------------------------------------------------------------
update public.productos set stock = 2 where id = 'beb00000-0000-4000-8000-000000000001';
-- 1
select isnt(
  (select stock_bajo_desde from public.productos where id = 'beb00000-0000-4000-8000-000000000001'),
  null,
  'dropping from above the threshold to 3 or less marks the product'
);
update public.productos set stock = 0 where id = 'beb00000-0000-4000-8000-000000000002';
-- 2
select is(
  (select stock_bajo_desde from public.productos where id = 'beb00000-0000-4000-8000-000000000002'),
  null,
  'a product that was already low is not marked again'
);
-- 3
select is(
  (select count(*)::int from public.productos_stock_bajo_pendientes()
    where id = 'beb00000-0000-4000-8000-000000000001'),
  1,
  'the marked product is pending'
);
update public.productos set aviso_stock_bajo_at = now() + interval '1 second'
 where id = 'beb00000-0000-4000-8000-000000000001';
-- 4
select is(
  (select count(*)::int from public.productos_stock_bajo_pendientes()
    where id = 'beb00000-0000-4000-8000-000000000001'),
  0,
  'once notified it is no longer pending'
);
update public.productos set stock = 8 where id = 'beb00000-0000-4000-8000-000000000001';
-- 5
select is(
  (select stock_bajo_desde from public.productos where id = 'beb00000-0000-4000-8000-000000000001'),
  null,
  'restocking above the threshold clears the mark'
);

-- ---- Pedido enviado ---------------------------------------------------------------
insert into public.pedidos (id, nombre, telefono, email, items, estado)
values ('bed00000-0000-4000-8000-000000000001', 'Ana', '3511234567', 'ana@at.test',
        '[{"id":"beb00000-0000-4000-8000-000000000002","nombre":"Gorro at","precio":50,"cantidad":1}]',
        'confirmado');
-- 6
select lives_ok(
  $$ update public.pedidos set estado = 'enviado', seguimiento = 'AB123'
      where id = 'bed00000-0000-4000-8000-000000000001' $$,
  'marking an order as shipped works without the email secrets'
);
-- 7
select isnt(
  (select enviado_at from public.pedidos where id = 'bed00000-0000-4000-8000-000000000001'),
  null,
  'the database records when the order was shipped'
);
-- 8
select is(
  (select count(*)::int from public.pedidos_envio_sin_aviso()),
  0,
  'a just-shipped order is not picked up by the hourly fallback'
);
update public.pedidos set enviado_at = now() - interval '3 hours'
 where id = 'bed00000-0000-4000-8000-000000000001';
-- 9
select is(
  (select count(*)::int from public.pedidos_envio_sin_aviso()),
  1,
  'after 2 hours without notice the order is picked up'
);

-- ---- Carritos ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"be000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'be000000-0000-4000-8000-000000000001';

-- 7
select lives_ok(
  $$ insert into public.carritos (items, recordado_at)
     values ('[{"id":"beb00000-0000-4000-8000-000000000001","cantidad":2}]', now()) $$,
  'a customer can save her cart'
);
-- 8
select is(
  (select recordado_at from public.carritos),
  null,
  'the customer cannot set recordado_at'
);
-- 9
select throws_ok(
  $$ insert into public.carritos (user_id, items) values ('be000000-0000-4000-8000-000000000002', '[]') $$,
  '42501', null,
  'nobody can save a cart for another account'
);
-- 10
select throws_ok(
  $$ update public.carritos set items = '{"x":1}' $$,
  '23514', null,
  'items must be an array'
);
-- 11
select lives_ok(
  $$ update public.profiles set recordar_carrito = false where id = 'be000000-0000-4000-8000-000000000001' $$,
  'a customer can turn off cart reminders'
);
update public.profiles set recordar_carrito = true where id = 'be000000-0000-4000-8000-000000000001';

-- 12
select throws_ok(
  $$ select * from public.carritos_para_recordar(20, 50) $$,
  '42501', null,
  'customers cannot list carts to remind'
);

reset role;

-- La "otra" cuenta tiene un carrito viejo; la que no confirmó el email, también.
insert into public.carritos (user_id, items) values
  ('be000000-0000-4000-8000-000000000002', '[{"id":"beb00000-0000-4000-8000-000000000001","cantidad":1}]'),
  ('be000000-0000-4000-8000-000000000003', '[{"id":"beb00000-0000-4000-8000-000000000001","cantidad":1}]');
alter table public.carritos disable trigger carritos_antes;
update public.carritos set updated_at = now() - interval '1 day';
alter table public.carritos enable trigger carritos_antes;

-- 13
select is(
  (select array_agg(email order by email) from public.carritos_para_recordar(20, 50)),
  array['ana@at.test', 'otra@at.test'],
  'old carts of confirmed accounts are listed (not the unconfirmed one)'
);

update public.profiles set recordar_carrito = false where id = 'be000000-0000-4000-8000-000000000002';
insert into public.pedidos (nombre, telefono, items, user_id)
values ('Ana', '3511234567', '[]', 'be000000-0000-4000-8000-000000000001');
-- 14
select is(
  (select count(*)::int from public.carritos_para_recordar(20, 50)),
  0,
  'carts are skipped when reminders are off or the customer already bought'
);

-- ---- Reporte mensual --------------------------------------------------------------
-- 15
select ok(
  (public.reporte_mensual_datos(current_date) ? 'mas_vendidos')
  and (public.reporte_mensual_datos(current_date)->>'pedidos')::int >= 1,
  'the monthly report has the counts and the best sellers'
);

-- 16
select ok(
  not has_function_privilege('authenticated', 'public.invocar_avisos_tienda(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.reporte_mensual_datos(date)', 'execute'),
  'the internal functions are not callable from the API'
);

select * from finish();

rollback;
