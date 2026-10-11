-- ============================================================================
-- pgTAP tests for migration 20261011120000_ventas_feria.sql
--   * ferias: only staff can see and create them; a customer sees nothing
--   * registrar_venta_feria: staff only, validates medio de pago and feria,
--     discounts stock (also from a size), leaves the sale delivered and paid,
--     is idempotent by key
--   * an order with origen 'feria' cannot be created without the RPC
--   * a feria with sales cannot be deleted
--   * estadisticas: por_origen.feria and por_feria
--
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(22);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('fe000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@feria.test', '{}', '{"nombre":"Clienta"}', now(), now()),
  ('fe000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'empleado@feria.test', '{}', '{"nombre":"Empleado"}', now(), now()),
  ('fe000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@feria.test', '{}', '{"nombre":"Admin"}', now(), now());

update public.profiles set rol = 'empleado' where id = 'fe000000-0000-4000-8000-0000000000e1';
update public.profiles set rol = 'admin'    where id = 'fe000000-0000-4000-8000-0000000000ad';

insert into public.categorias (id, nombre) values ('fec00000-0000-4000-8000-000000000001', 'Cat feria');
insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('feb00000-0000-4000-8000-000000000001', 'Manta feria', 'fec00000-0000-4000-8000-000000000001', 1000, 5),
  ('feb00000-0000-4000-8000-000000000002', 'Body feria',  'fec00000-0000-4000-8000-000000000001', 2000, 0);
insert into public.producto_talles (id, producto_id, talle, stock, orden) values
  ('fed00000-0000-4000-8000-000000000001', 'feb00000-0000-4000-8000-000000000002', '0-3 m', 3, 0);

insert into public.ferias (id, nombre, fecha) values
  ('fef00000-0000-4000-8000-000000000001', '  Feria   Plaza ', '2026-10-10'),
  ('fef00000-0000-4000-8000-000000000002', 'Feria vieja', '2026-09-01');
update public.ferias set activa = false where id = 'fef00000-0000-4000-8000-000000000002';

-- 1
select is(
  (select nombre from public.ferias where id = 'fef00000-0000-4000-8000-000000000001'),
  'Feria Plaza',
  'the feria name is stored without extra spaces'
);

-- 2
select throws_ok(
  $$ insert into public.ferias (nombre, fecha) values ('feria plaza', '2026-10-10') $$,
  '23505', null,
  'the same feria cannot be added twice on the same date'
);

-- ---- Clienta ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"fe000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'fe000000-0000-4000-8000-000000000001';

-- 3
select is((select count(*)::int from public.ferias), 0, 'a customer does not see the ferias');

-- 4
select throws_ok(
  $$ select public.registrar_venta_feria('fef00000-0000-4000-8000-000000000001', 'efectivo',
       '[{"id":"feb00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb) $$,
  '42501', null,
  'a customer cannot register a feria sale'
);

-- 5: crear_pedido ignores origen 'feria' for a customer (it stays checkout).
select public.crear_pedido(
  'Clienta', '3515551234', null, 'coordinar', null, null, null, null,
  '[{"id":"feb00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0, 'feria');
select is(
  (select origen from public.pedidos where user_id = 'fe000000-0000-4000-8000-000000000001'),
  'checkout',
  'a customer cannot create an order with origen feria'
);

reset role;

-- ---- Empleado --------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"fe000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local request.jwt.claim.sub = 'fe000000-0000-4000-8000-0000000000e1';

-- 6
select is((select count(*)::int from public.ferias), 2, 'staff sees the ferias');

-- 7
select lives_ok(
  $$ insert into public.ferias (id, nombre, fecha)
     values ('fef00000-0000-4000-8000-000000000003', 'Feria nueva', '2026-10-11') $$,
  'staff can create a feria'
);

-- 8
select throws_ok(
  $$ select public.registrar_venta_feria('fef00000-0000-4000-8000-000000000001', 'cheque',
       '[{"id":"feb00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb) $$,
  '22023', 'Elegí cómo te pagaron: efectivo, transferencia o Mercado Pago.',
  'the medio de pago must be a known one'
);

-- 9
select throws_ok(
  $$ select public.registrar_venta_feria('fef00000-0000-4000-8000-000000000002', 'efectivo',
       '[{"id":"feb00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb) $$,
  '22023', null,
  'an archived feria does not take new sales'
);

-- 10
select throws_ok(
  $$ select public.crear_pedido('Feria', '', null, 'coordinar', null, null, null, null,
       '[{"id":"feb00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0, 'feria') $$,
  'P0001', 'Las ventas de feria se registran con registrar_venta_feria.',
  'an order with origen feria needs registrar_venta_feria'
);

-- Venta: 2 mantas + 1 body talle 0-3 m, pagada con transferencia.
select public.registrar_venta_feria(
  'fef00000-0000-4000-8000-000000000001', 'transferencia',
  '[{"id":"feb00000-0000-4000-8000-000000000001","cantidad":2},
    {"id":"feb00000-0000-4000-8000-000000000002","talle_id":"fed00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb,
  'fea00000-0000-4000-8000-000000000001'
);

reset role;

-- 11
select is(
  (select stock from public.productos where id = 'feb00000-0000-4000-8000-000000000001'),
  2,
  'the feria sale discounts stock (5 - 1 customer order - 2)'
);

-- 12
select is(
  (select stock from public.producto_talles where id = 'fed00000-0000-4000-8000-000000000001'),
  2,
  'the feria sale discounts stock from the size'
);

-- 13
select results_eq(
  $$ select origen, nombre, feria_id, medio_pago, estado, pagado_at is not null, total
       from public.pedidos where idempotency_key = 'fea00000-0000-4000-8000-000000000001' $$,
  $$ values ('feria'::text, 'Feria Plaza'::text, 'fef00000-0000-4000-8000-000000000001'::uuid,
             'transferencia'::text, 'entregado'::text, true, 4000::numeric) $$,
  'the feria sale is delivered, paid and carries the feria'
);

-- 14
select is(
  (select count(*)::int from public.ventas_validas v
     join public.pedidos p on p.id = v.pedido_id
    where p.idempotency_key = 'fea00000-0000-4000-8000-000000000001'),
  2,
  'the feria sale counts in ventas_validas'
);

-- 15
select is(
  current_setting('pecora.venta_feria', true),
  '',
  'registrar_venta_feria clears the transaction variable'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"fe000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local request.jwt.claim.sub = 'fe000000-0000-4000-8000-0000000000e1';

-- 16: same key = same order, stock untouched.
select is(
  public.registrar_venta_feria(
    'fef00000-0000-4000-8000-000000000001', 'transferencia',
    '[{"id":"feb00000-0000-4000-8000-000000000001","cantidad":2}]'::jsonb,
    'fea00000-0000-4000-8000-000000000001'),
  (select numero from public.pedidos where idempotency_key = 'fea00000-0000-4000-8000-000000000001'),
  'retrying with the same key returns the same sale'
);

-- 17: segunda venta en efectivo.
select lives_ok(
  $$ select public.registrar_venta_feria('fef00000-0000-4000-8000-000000000001', 'efectivo',
       '[{"id":"feb00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb) $$,
  'a second sale in cash'
);

-- 18
select throws_ok(
  $$ update public.pedidos set medio_pago = 'efectivo'
      where idempotency_key = 'fea00000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'an empleado cannot change the medio de pago'
);

reset role;

-- 19
select is(
  (select stock from public.productos where id = 'feb00000-0000-4000-8000-000000000001'),
  1,
  'the retry did not discount stock again'
);

-- 20
select throws_ok(
  $$ update public.pedidos set feria_id = null
      where idempotency_key = 'fea00000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'a feria sale always keeps its feria'
);

-- ---- Admin -----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"fe000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'fe000000-0000-4000-8000-0000000000ad';

-- 21
select throws_ok(
  $$ delete from public.ferias where id = 'fef00000-0000-4000-8000-000000000001' $$,
  '23503', null,
  'a feria with sales cannot be deleted'
);

-- 22
select results_eq(
  $$ select (e->'por_origen'->'feria'->>'pedidos')::int,
            (e->'por_origen'->'feria'->>'total')::numeric,
            jsonb_array_length(e->'por_feria'),
            (e->'por_feria'->0->>'efectivo')::numeric,
            (e->'por_feria'->0->>'transferencia')::numeric,
            (e->'por_feria'->0->>'mercadopago')::numeric
       from public.estadisticas(current_date - 1, current_date + 1) e $$,
  $$ values (2, 5000::numeric, 1, 1000::numeric, 4000::numeric, 0::numeric) $$,
  'estadisticas includes the feria sales by medio de pago'
);

reset role;

select * from finish();

rollback;
