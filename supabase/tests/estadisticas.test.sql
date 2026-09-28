-- ============================================================================
-- pgTAP tests for migration 20260928144835_estadisticas_mas_vendidos.sql
--   * estadisticas(p_desde, p_hasta): admin only; totals, monthly buckets in
--     America/Argentina/Cordoba (month and range boundaries), zero-filled
--     months, top products (deleted products keep the order name), new
--     customers, customers with a purchase, split by origen; cancelled and
--     trashed orders excluded; invalid ranges rejected.
--   * mas_vendidos(p_limite, p_dias): public, only existing products, both
--     origins, excludes cancelled / trashed / older than p_dias, clamps.
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
  ('e4000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'c1@stats.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"C1"}', now(), now()),
  ('e4000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'c2@stats.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"C2"}', now(), now()),
  ('e4000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'c3@stats.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"C3"}', now(), now()),
  ('e4000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'empleado@stats.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Empleado"}', now(), now()),
  ('e4000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@stats.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

update public.profiles set rol = 'admin'    where id = 'e4000000-0000-4000-8000-0000000000ad';
update public.profiles set rol = 'empleado' where id = 'e4000000-0000-4000-8000-0000000000e1';

-- Account creation dates (Cordoba = UTC-3):
--   C1  2026-01-10            -> new in Jan
--   C2  2025-12-31 23:59 -03  -> Dec in Cordoba (Jan 1st in UTC): not new
--   C3  2026-02-28 23:00 -03  -> last day of the range (Mar 1st in UTC): new
--   empleado 2026-01-20       -> not a customer
--   admin    2026-01-05       -> not a customer
update public.profiles set created_at = '2026-01-10 12:00-03' where id = 'e4000000-0000-4000-8000-000000000001';
update public.profiles set created_at = '2025-12-31 23:59-03' where id = 'e4000000-0000-4000-8000-000000000002';
update public.profiles set created_at = '2026-02-28 23:00-03' where id = 'e4000000-0000-4000-8000-000000000003';
update public.profiles set created_at = '2026-01-20 12:00-03' where id = 'e4000000-0000-4000-8000-0000000000e1';
update public.profiles set created_at = '2026-01-05 12:00-03' where id = 'e4000000-0000-4000-8000-0000000000ad';

insert into public.productos (id, nombre, precio, stock) values
  ('b4000000-0000-4000-8000-000000000001', 'P1 actual', 100, 100),
  ('b4000000-0000-4000-8000-000000000002', 'P2 actual', 500, 100),
  ('b4000000-0000-4000-8000-000000000003', 'P3 se borra', 10, 100);

-- Orders are inserted directly (as postgres) with fixed dates. Items:
--   P1 = b4..01 (100), P2 = b4..02 (500), P3 = b4..03 (10).
insert into public.pedidos
  (id, user_id, nombre, telefono, items, subtotal, descuento, costo_envio,
   origen, estado, eliminado_at, created_at)
values
  -- o1: Jan, C1, 2 x P1 = 200
  ('d4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b4000000-0000-4000-8000-000000000001","nombre":"P1","precio":100,"cantidad":2}]',
   200, 0, 0, 'checkout', 'nuevo', null, '2026-01-15 12:00-03'),
  -- o2: Jan 31 23:30 in Cordoba (Feb 1st in UTC), C1, 1 x P2 + 100 shipping = 600
  ('d4000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b4000000-0000-4000-8000-000000000002","nombre":"P2","precio":500,"cantidad":1}]',
   500, 0, 100, 'checkout', 'entregado', null, '2026-01-31 23:30-03'),
  -- o3: Feb 1st 00:10 in Cordoba, C2, 1 x P1 - 50 discount = 50
  ('d4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000002', 'C2', '2',
   '[{"id":"b4000000-0000-4000-8000-000000000001","nombre":"P1","precio":100,"cantidad":1}]',
   100, 50, 0, 'checkout', 'confirmado', null, '2026-02-01 00:10-03'),
  -- o4: Feb, manual order loaded by the admin, 3 x P2 = 1500
  ('d4000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-0000000000ad', 'WhatsApp', '4',
   '[{"id":"b4000000-0000-4000-8000-000000000002","nombre":"P2","precio":500,"cantidad":3}]',
   1500, 0, 0, 'admin', 'nuevo', null, '2026-02-10 12:00-03'),
  -- o5: Feb, cancelled -> excluded
  ('d4000000-0000-4000-8000-000000000005', 'e4000000-0000-4000-8000-000000000002', 'C2', '2',
   '[{"id":"b4000000-0000-4000-8000-000000000001","nombre":"P1","precio":100,"cantidad":10}]',
   1000, 0, 0, 'checkout', 'cancelado', null, '2026-02-11 12:00-03'),
  -- o6: Feb, in the papelera -> excluded
  ('d4000000-0000-4000-8000-000000000006', 'e4000000-0000-4000-8000-000000000002', 'C2', '2',
   '[{"id":"b4000000-0000-4000-8000-000000000001","nombre":"P1","precio":100,"cantidad":10}]',
   1000, 0, 0, 'checkout', 'nuevo', now(), '2026-02-12 12:00-03'),
  -- o7: Dec 31 23:59 in Cordoba (Jan 1st in UTC), C1, 1 x P1 = 100 -> December
  ('d4000000-0000-4000-8000-000000000007', 'e4000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b4000000-0000-4000-8000-000000000001","nombre":"P1","precio":100,"cantidad":1}]',
   100, 0, 0, 'checkout', 'nuevo', null, '2025-12-31 23:59-03'),
  -- o8: Mar 1st 00:00 in Cordoba -> after the range
  ('d4000000-0000-4000-8000-000000000008', 'e4000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b4000000-0000-4000-8000-000000000001","nombre":"P1","precio":100,"cantidad":1}]',
   100, 0, 0, 'checkout', 'nuevo', null, '2026-03-01 00:00-03'),
  -- o9: Feb, C2, 5 x P3 (product deleted below) = 50
  ('d4000000-0000-4000-8000-000000000009', 'e4000000-0000-4000-8000-000000000002', 'C2', '2',
   '[{"id":"b4000000-0000-4000-8000-000000000003","nombre":"P3 del pedido","precio":10,"cantidad":5}]',
   50, 0, 0, 'checkout', 'nuevo', null, '2026-02-15 12:00-03');

-- Recent orders, for mas_vendidos (relative to now()).
insert into public.pedidos
  (id, user_id, nombre, telefono, items, subtotal, origen, estado, eliminado_at, created_at)
values
  ('d4100000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b4000000-0000-4000-8000-000000000001","nombre":"P1","precio":100,"cantidad":2}]',
   200, 'checkout', 'nuevo', null, now() - interval '1 day'),
  ('d4100000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-0000000000ad', 'WhatsApp', '4',
   '[{"id":"b4000000-0000-4000-8000-000000000002","nombre":"P2","precio":500,"cantidad":5}]',
   2500, 'admin', 'nuevo', null, now() - interval '2 days'),
  ('d4100000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000002', 'C2', '2',
   '[{"id":"b4000000-0000-4000-8000-000000000002","nombre":"P2","precio":500,"cantidad":100}]',
   50000, 'checkout', 'cancelado', null, now() - interval '1 day'),
  ('d4100000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-000000000002', 'C2', '2',
   '[{"id":"b4000000-0000-4000-8000-000000000001","nombre":"P1","precio":100,"cantidad":100}]',
   10000, 'checkout', 'nuevo', now(), now() - interval '1 day'),
  ('d4100000-0000-4000-8000-000000000005', 'e4000000-0000-4000-8000-000000000002', 'C2', '2',
   '[{"id":"b4000000-0000-4000-8000-000000000003","nombre":"P3","precio":10,"cantidad":50}]',
   500, 'checkout', 'nuevo', null, now() - interval '1 day'),
  ('d4100000-0000-4000-8000-000000000006', 'e4000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b4000000-0000-4000-8000-000000000001","nombre":"P1","precio":100,"cantidad":10}]',
   1000, 'checkout', 'nuevo', null, now() - interval '100 days'),
  ('d4100000-0000-4000-8000-000000000007', 'e4000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b4000000-0000-4000-8000-000000000002","nombre":"P2","precio":500,"cantidad":100}]',
   50000, 'checkout', 'nuevo', null, now() - interval '400 days');

-- P3 no longer exists (order items keep a snapshot of the name).
delete from public.productos where id = 'b4000000-0000-4000-8000-000000000003';

-- ----------------------------------------------------------------------------
-- Access.
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 1
select throws_ok(
  $$ select public.estadisticas('2026-01-01', '2026-02-28') $$,
  '42501', null,
  'anon cannot call estadisticas'
);
-- 2
select lives_ok(
  $$ select * from public.mas_vendidos() $$,
  'anon can call mas_vendidos'
);
-- 3
select results_eq(
  $$ select producto_id, unidades from public.mas_vendidos() $$,
  $$ values ('b4000000-0000-4000-8000-000000000002'::uuid, 5),
            ('b4000000-0000-4000-8000-000000000001'::uuid, 2) $$,
  'mas_vendidos(): last 90 days, both origins, no cancelled / trashed / deleted products'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e4000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'e4000000-0000-4000-8000-000000000001';

-- 4
select throws_ok(
  $$ select public.estadisticas('2026-01-01', '2026-02-28') $$,
  '42501', 'No autorizado: las estadísticas son solo para la admin',
  'a customer cannot call estadisticas'
);
-- 5
select results_eq(
  $$ select producto_id, unidades from public.mas_vendidos(1) $$,
  $$ values ('b4000000-0000-4000-8000-000000000002'::uuid, 5) $$,
  'a customer can call mas_vendidos; p_limite limits the rows'
);

set local request.jwt.claims = '{"sub":"e4000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local request.jwt.claim.sub = 'e4000000-0000-4000-8000-0000000000e1';

-- 6
select throws_ok(
  $$ select public.estadisticas('2026-01-01', '2026-02-28') $$,
  '42501', null,
  'an empleado cannot call estadisticas'
);
-- 7 (staff do not change what mas_vendidos returns)
select results_eq(
  $$ select producto_id, unidades from public.mas_vendidos() $$,
  $$ values ('b4000000-0000-4000-8000-000000000002'::uuid, 5),
            ('b4000000-0000-4000-8000-000000000001'::uuid, 2) $$,
  'an empleado gets the same mas_vendidos'
);

-- ----------------------------------------------------------------------------
-- estadisticas as the admin.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"e4000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'e4000000-0000-4000-8000-0000000000ad';

create temp table r as select public.estadisticas('2026-01-01', '2026-02-28') as j;

-- 8
select is(
  (select j->'ventas_por_mes' from r),
  '[{"mes":"2026-01","pedidos":2,"total":800},
    {"mes":"2026-02","pedidos":3,"total":1600}]'::jsonb,
  'ventas_por_mes: months in Cordoba time (Jan 31 23:30 is January, Feb 1st 00:10 is February)'
);
-- 9
select is(
  (select (j->>'total_periodo')::numeric from r), 2400::numeric,
  'total_periodo = sum of pedidos.total, without cancelled / trashed / out-of-range orders'
);
-- 10
select is((select (j->>'pedidos_periodo')::int from r), 5, 'pedidos_periodo');
-- 11
select is((select (j->>'ticket_promedio')::numeric from r), 480.00, 'ticket_promedio = 2400 / 5');
-- 12
select is(
  (select j->'mas_vendidos' from r),
  '[{"producto_id":"b4000000-0000-4000-8000-000000000003","nombre":"P3 del pedido","unidades":5,"importe":50},
    {"producto_id":"b4000000-0000-4000-8000-000000000002","nombre":"P2 actual","unidades":4,"importe":2000},
    {"producto_id":"b4000000-0000-4000-8000-000000000001","nombre":"P1 actual","unidades":3,"importe":300}]'::jsonb,
  'mas_vendidos by units; current product name, or the order name if the product was deleted'
);
-- 13
select is(
  (select (j->>'clientas_nuevas')::int from r), 2,
  'clientas_nuevas: customers created in the range in Cordoba time (not staff)'
);
-- 14
select is(
  (select (j->>'clientas_con_compra')::int from r), 2,
  'clientas_con_compra: distinct accounts with a checkout order in the range'
);
-- 15
select is(
  (select j->'por_origen' from r),
  '{"checkout":{"pedidos":4,"total":900},"admin":{"pedidos":1,"total":1500}}'::jsonb,
  'por_origen splits checkout and manual orders'
);
-- 16
select is(
  (select jsonb_object_keys_sorted from (
     select array_agg(k order by k) as jsonb_object_keys_sorted
       from r, jsonb_object_keys(r.j) k) s),
  array['clientas_con_compra', 'clientas_nuevas', 'mas_vendidos', 'pedidos_periodo',
        'por_origen', 'ticket_promedio', 'total_periodo', 'ventas_por_mes'],
  'estadisticas returns exactly the contract keys'
);
-- 17 (a single day: Jan 31st)
select is(
  (select jsonb_build_object('meses', j->'ventas_por_mes', 'pedidos', j->'pedidos_periodo',
                             'total', j->'total_periodo')
     from (select public.estadisticas('2026-01-31', '2026-01-31') as j) s),
  '{"meses":[{"mes":"2026-01","pedidos":1,"total":600}],"pedidos":1,"total":600}'::jsonb,
  'a one-day range includes the whole day until 23:59 Cordoba time'
);
-- 18 (zero-filled months)
select is(
  (select j->'ventas_por_mes' from (select public.estadisticas('2025-11-01', '2026-01-31') as j) s),
  '[{"mes":"2025-11","pedidos":0,"total":0},
    {"mes":"2025-12","pedidos":1,"total":100},
    {"mes":"2026-01","pedidos":2,"total":800}]'::jsonb,
  'months without sales are returned with zeros'
);
-- 19 (empty range)
select is(
  (select jsonb_build_object('pedidos', j->'pedidos_periodo', 'ticket', j->'ticket_promedio',
                             'top', j->'mas_vendidos',
                             'origen', j->'por_origen')
     from (select public.estadisticas('2020-01-01', '2020-01-31') as j) s),
  '{"pedidos":0,"ticket":0,"top":[],
    "origen":{"checkout":{"pedidos":0,"total":0},"admin":{"pedidos":0,"total":0}}}'::jsonb,
  'a range without orders returns zeros and empty lists'
);
-- 20
select throws_ok(
  $$ select public.estadisticas('2026-02-01', '2026-01-01') $$,
  '22023', null,
  'desde after hasta is rejected'
);
-- 21
select throws_ok(
  $$ select public.estadisticas(null, '2026-01-01') $$,
  '22023', null,
  'a missing date is rejected'
);

-- ----------------------------------------------------------------------------
-- mas_vendidos: window and clamps.
-- ----------------------------------------------------------------------------
-- 22
select results_eq(
  $$ select producto_id, unidades from public.mas_vendidos(8, 120) $$,
  $$ values ('b4000000-0000-4000-8000-000000000001'::uuid, 12),
            ('b4000000-0000-4000-8000-000000000002'::uuid, 5) $$,
  'p_dias widens the window'
);
-- 23 (365 days max). The fixed-date Jan/Feb orders are removed first so the
--     result does not depend on today's date; the 400-day-old order must
--     still be excluded.
reset role;
delete from public.pedidos where id::text like 'd4000000-%';
set local role authenticated;
select results_eq(
  $$ select producto_id, unidades from public.mas_vendidos(8, 10000) $$,
  $$ values ('b4000000-0000-4000-8000-000000000001'::uuid, 12),
            ('b4000000-0000-4000-8000-000000000002'::uuid, 5) $$,
  'p_dias is clamped to 365'
);
-- 24
select is(
  (select count(*)::int from public.mas_vendidos(0)), 1,
  'p_limite below 1 is clamped to 1'
);
-- 25
select is(
  (select count(*)::int from public.mas_vendidos(null, null)), 2,
  'null arguments use the defaults'
);
-- 26 (no personal data: only product id and units)
select is(
  (select proargnames from pg_proc where oid = to_regprocedure('public.mas_vendidos(integer,integer)')),
  array['p_limite', 'p_dias', 'producto_id', 'unidades'],
  'mas_vendidos returns only producto_id and unidades'
);

select * from finish();

rollback;
