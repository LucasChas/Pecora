-- ============================================================================
-- pgTAP tests for the gastos_rentabilidad migration.
--   * gastos: schema, privileges and RLS (admin-only CRUD; empleado, customer
--     and anon denied), constraints, defaults, created_by cannot be spoofed,
--     trimming, producto_id set null when the product is deleted.
--   * rentabilidad(p_desde, p_hasta): admin only; monthly buckets in
--     America/Argentina/Cordoba, zero-filled months, totals, per-product
--     estimates (weighted unit cost up to p_hasta, product without cost data),
--     expenses by category and without product; cancelled and trashed orders
--     excluded; invalid ranges rejected.
--   * estadisticas() keeps returning the same numbers.
--
-- Run locally with:  supabase test db --local
--
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(40);

-- ----------------------------------------------------------------------------
-- Helper (rolled back with the rest): runs a statement as the current role and
-- returns the number of affected rows, or -1 if it is denied with
-- insufficient_privilege (missing GRANT or RLS WITH CHECK violation).
-- ----------------------------------------------------------------------------
create schema test_gastos;
grant usage on schema test_gastos to anon, authenticated;

create function test_gastos.filas(p_sql text)
returns int
language plpgsql
as $$
declare
  n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception when insufficient_privilege then
  return -1;
end;
$$;
grant execute on function test_gastos.filas(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres).
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e7000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'c1@gastos.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"C1"}', now(), now()),
  ('e7000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'empleado@gastos.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Empleado"}', now(), now()),
  ('e7000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@gastos.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

update public.profiles set rol = 'admin'    where id = 'e7000000-0000-4000-8000-0000000000ad';
update public.profiles set rol = 'empleado' where id = 'e7000000-0000-4000-8000-0000000000e1';

insert into public.productos (id, nombre, precio, stock) values
  ('b7000000-0000-4000-8000-000000000001', 'P1 rent', 1000, 100),
  ('b7000000-0000-4000-8000-000000000002', 'P2 rent', 5000, 100),
  ('b7000000-0000-4000-8000-000000000003', 'P3 rent', 700, 100);

-- Orders (Cordoba = UTC-3). P1 = b7..01 (1000), P2 = b7..02 (5000).
insert into public.pedidos
  (id, user_id, nombre, telefono, items, subtotal, descuento, costo_envio,
   origen, estado, eliminado_at, created_at)
values
  -- o1: Jan, 2 x P1 = 2000
  ('d7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b7000000-0000-4000-8000-000000000001","nombre":"P1","precio":1000,"cantidad":2}]',
   2000, 0, 0, 'checkout', 'entregado', null, '2026-01-15 12:00-03'),
  -- o2: Jan 31 23:30 in Cordoba (Feb 1st in UTC), 1 x P2 + 100 shipping = 5100
  ('d7000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b7000000-0000-4000-8000-000000000002","nombre":"P2","precio":5000,"cantidad":1}]',
   5000, 0, 100, 'checkout', 'nuevo', null, '2026-01-31 23:30-03'),
  -- o3: Feb 1st 00:10 in Cordoba, manual, 3 x P1 - 500 discount = 2500
  ('d7000000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-0000000000ad', 'WhatsApp', '2',
   '[{"id":"b7000000-0000-4000-8000-000000000001","nombre":"P1","precio":1000,"cantidad":3}]',
   3000, 500, 0, 'admin', 'confirmado', null, '2026-02-01 00:10-03'),
  -- o4: Feb, cancelled -> excluded
  ('d7000000-0000-4000-8000-000000000004', 'e7000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b7000000-0000-4000-8000-000000000001","nombre":"P1","precio":1000,"cantidad":10}]',
   10000, 0, 0, 'checkout', 'cancelado', null, '2026-02-11 12:00-03'),
  -- o5: Feb, in the papelera -> excluded
  ('d7000000-0000-4000-8000-000000000005', 'e7000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b7000000-0000-4000-8000-000000000002","nombre":"P2","precio":5000,"cantidad":10}]',
   50000, 0, 0, 'checkout', 'nuevo', now(), '2026-02-12 12:00-03'),
  -- o6: Mar 1st 00:00 in Cordoba -> after the range
  ('d7000000-0000-4000-8000-000000000006', 'e7000000-0000-4000-8000-000000000001', 'C1', '1',
   '[{"id":"b7000000-0000-4000-8000-000000000002","nombre":"P2","precio":5000,"cantidad":1}]',
   5000, 0, 0, 'checkout', 'nuevo', null, '2026-03-01 00:00-03');

-- Expenses. P1 unit cost up to 2026-02-28 = (200 + 1000 + 600) / (5 + 10 + 5) = 90;
-- up to 2026-01-31 = (200 + 1000) / (5 + 10) = 80. g3 (March) never counts.
insert into public.gastos (id, fecha, concepto, categoria, monto, producto_id, cantidad, created_by) values
  ('97000000-0000-4000-8000-000000000001', '2026-01-05', 'Tela P1',       'materiales', 1000,
   'b7000000-0000-4000-8000-000000000001', 10, 'e7000000-0000-4000-8000-0000000000ad'),
  ('97000000-0000-4000-8000-000000000002', '2026-02-20', 'Tela P1 bis',   'materiales',  600,
   'b7000000-0000-4000-8000-000000000001', 5, 'e7000000-0000-4000-8000-0000000000ad'),
  ('97000000-0000-4000-8000-000000000003', '2026-03-10', 'Tela P1 marzo', 'materiales', 5000,
   'b7000000-0000-4000-8000-000000000001', 1, 'e7000000-0000-4000-8000-0000000000ad'),
  ('97000000-0000-4000-8000-000000000004', '2026-01-20', 'Bolsas',        'packaging',   300,
   null, null, 'e7000000-0000-4000-8000-0000000000ad'),
  ('97000000-0000-4000-8000-000000000005', '2026-02-05', 'Correo',        'envios',      150,
   null, null, 'e7000000-0000-4000-8000-0000000000ad'),
  ('97000000-0000-4000-8000-000000000006', '2025-12-15', 'Tela P1 dic',   'materiales',  200,
   'b7000000-0000-4000-8000-000000000001', 5, 'e7000000-0000-4000-8000-0000000000ad'),
  -- P2: an expense without quantity -> still no unit cost
  ('97000000-0000-4000-8000-000000000007', '2026-02-25', 'Arreglo P2',    'otros',        50,
   'b7000000-0000-4000-8000-000000000002', null, 'e7000000-0000-4000-8000-0000000000ad'),
  -- P3: bought for, but not sold in the range
  ('97000000-0000-4000-8000-000000000008', '2026-01-10', 'Hilo P3',       'materiales',  400,
   'b7000000-0000-4000-8000-000000000003', 4, 'e7000000-0000-4000-8000-0000000000ad');

-- ----------------------------------------------------------------------------
-- Schema and privileges.
-- ----------------------------------------------------------------------------
-- 1
select has_table('public', 'gastos', 'table gastos exists');
-- 2
select ok(
  (select relrowsecurity from pg_class where oid = 'public.gastos'::regclass),
  'RLS is enabled on gastos'
);
-- 3
select ok(
  not has_table_privilege('anon', 'public.gastos', 'SELECT')
  and not has_table_privilege('anon', 'public.gastos', 'INSERT')
  and not has_table_privilege('anon', 'public.gastos', 'UPDATE')
  and not has_table_privilege('anon', 'public.gastos', 'DELETE'),
  'anon has no privileges on gastos'
);
-- 4
select ok(
  has_table_privilege('authenticated', 'public.gastos', 'SELECT')
  and has_table_privilege('authenticated', 'public.gastos', 'INSERT')
  and has_table_privilege('authenticated', 'public.gastos', 'UPDATE')
  and has_table_privilege('authenticated', 'public.gastos', 'DELETE'),
  'authenticated has CRUD privileges (RLS decides)'
);
-- 5
select ok(
  not has_function_privilege('anon', 'public.rentabilidad(date, date)', 'EXECUTE'),
  'anon cannot execute rentabilidad'
);

-- ----------------------------------------------------------------------------
-- anon
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 6
select throws_ok(
  $$ select count(*) from public.gastos $$,
  '42501', null,
  'anon cannot read gastos'
);
-- 7
select is(
  test_gastos.filas($$ insert into public.gastos (concepto, monto) values ('x', 1) $$),
  -1,
  'anon cannot insert gastos'
);
-- 8
select throws_ok(
  $$ select public.rentabilidad('2026-01-01', '2026-02-28') $$,
  '42501', null,
  'anon cannot call rentabilidad'
);

-- ----------------------------------------------------------------------------
-- Customer
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e7000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000001';

-- 9
select is((select count(*)::int from public.gastos), 0, 'a customer sees no gastos');
-- 10
select is(
  test_gastos.filas($$ insert into public.gastos (concepto, monto) values ('x', 1) $$),
  -1,
  'a customer cannot insert gastos'
);
-- 11
select is(
  test_gastos.filas($$ update public.gastos set monto = 1 $$)
  + test_gastos.filas($$ delete from public.gastos $$),
  0,
  'a customer cannot update or delete gastos'
);
-- 12
select throws_ok(
  $$ select public.rentabilidad('2026-01-01', '2026-02-28') $$,
  '42501', 'No autorizado: la rentabilidad es solo para la admin',
  'a customer cannot call rentabilidad'
);

-- ----------------------------------------------------------------------------
-- Empleado (staff, but stats and expenses are admin-only)
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"e7000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-0000000000e1';

-- 13
select is((select count(*)::int from public.gastos), 0, 'an empleado sees no gastos');
-- 14
select is(
  test_gastos.filas($$ insert into public.gastos (concepto, monto) values ('x', 1) $$),
  -1,
  'an empleado cannot insert gastos'
);
-- 15
select is(
  test_gastos.filas($$ update public.gastos set monto = 1 $$)
  + test_gastos.filas($$ delete from public.gastos $$),
  0,
  'an empleado cannot update or delete gastos'
);
-- 16
select throws_ok(
  $$ select public.rentabilidad('2026-01-01', '2026-02-28') $$,
  '42501', null,
  'an empleado cannot call rentabilidad'
);

-- ----------------------------------------------------------------------------
-- Admin: CRUD, defaults and constraints
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"e7000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-0000000000ad';

-- 17
select is(
  (select count(*)::int from public.gastos where id::text like '97000000-%'),
  8,
  'the admin sees every gasto'
);
-- 18 (created_by is spoofed on purpose: the trigger replaces it)
select is(
  test_gastos.filas($$
    insert into public.gastos (id, concepto, monto, notas, created_by)
    values ('97000000-0000-4000-8000-0000000000a1', '  Botones  ', 120.5, '   ',
            'e7000000-0000-4000-8000-000000000001') $$),
  1,
  'the admin can insert a gasto'
);
-- 19
select results_eq(
  $$ select concepto, categoria, fecha, notas, created_by, producto_id, cantidad
       from public.gastos where id = '97000000-0000-4000-8000-0000000000a1' $$,
  $$ values ('Botones'::text, 'materiales'::text,
             (now() at time zone 'America/Argentina/Cordoba')::date,
             null::text, 'e7000000-0000-4000-8000-0000000000ad'::uuid,
             null::uuid, null::int) $$,
  'defaults: materiales, today in Cordoba, trimmed text, empty notas -> null, created_by = auth.uid()'
);
-- 20
select is(
  test_gastos.filas($$
    update public.gastos
       set monto = 200, producto_id = 'b7000000-0000-4000-8000-000000000003', cantidad = 2,
           created_by = 'e7000000-0000-4000-8000-000000000001'
     where id = '97000000-0000-4000-8000-0000000000a1' $$),
  1,
  'the admin can update a gasto'
);
-- 21
select results_eq(
  $$ select monto, cantidad, created_by from public.gastos
      where id = '97000000-0000-4000-8000-0000000000a1' $$,
  $$ values (200.00::numeric(12,2), 2, 'e7000000-0000-4000-8000-0000000000ad'::uuid) $$,
  'update keeps created_by'
);
-- 22
select is(
  test_gastos.filas($$ delete from public.gastos where id = '97000000-0000-4000-8000-0000000000a1' $$),
  1,
  'the admin can delete a gasto'
);
-- 23
select throws_ok(
  $$ insert into public.gastos (concepto, monto) values ('x', 0) $$,
  '23514', null, 'monto must be > 0 (zero)'
);
-- 24
select throws_ok(
  $$ insert into public.gastos (concepto, monto) values ('x', -5) $$,
  '23514', null, 'monto must be > 0 (negative)'
);
-- 25
select throws_ok(
  $$ insert into public.gastos (concepto, monto, categoria) values ('x', 10, 'comida') $$,
  '23514', null, 'categoria must be one of the four'
);
-- 26
select throws_ok(
  $$ insert into public.gastos (concepto, monto, cantidad) values ('x', 10, 0) $$,
  '23514', null, 'cantidad must be > 0'
);
-- 27
select throws_ok(
  $$ insert into public.gastos (concepto, monto) values ('   ', 10) $$,
  '23514', null, 'concepto cannot be blank'
);
-- 28
select throws_ok(
  $$ insert into public.gastos (concepto, monto) values (repeat('a', 201), 10) $$,
  '23514', null, 'concepto is at most 200 characters'
);

-- ----------------------------------------------------------------------------
-- rentabilidad as the admin.
-- ----------------------------------------------------------------------------
create temp table r as select public.rentabilidad('2026-01-01', '2026-02-28') as j;

-- 29
select is(
  (select j->'por_mes' from r),
  '[{"mes":"2026-01","ingresos":7100,"gastos":1700,"beneficio":5400,"margen":76.1},
    {"mes":"2026-02","ingresos":2500,"gastos":800,"beneficio":1700,"margen":68.0}]'::jsonb,
  'por_mes: Cordoba months (Jan 31 23:30 is January), no cancelled / trashed orders, gastos by fecha'
);
-- 30
select is(
  (select j->'totales' from r),
  '{"ingresos":9600,"gastos":2500,"beneficio":7100,"margen":74.0,"pedidos":3}'::jsonb,
  'totales'
);
-- 31
select is(
  (select j->'productos' from r),
  '[{"producto_id":"b7000000-0000-4000-8000-000000000001","nombre":"P1 rent",
     "unidades_vendidas":5,"ingresos":5000,"costo_unitario_estimado":90,
     "costo_estimado":450,"beneficio_estimado":4550,"margen":91.0,"gastos_periodo":1600},
    {"producto_id":"b7000000-0000-4000-8000-000000000003","nombre":"P3 rent",
     "unidades_vendidas":0,"ingresos":0,"costo_unitario_estimado":100,
     "costo_estimado":0,"beneficio_estimado":0,"margen":null,"gastos_periodo":400},
    {"producto_id":"b7000000-0000-4000-8000-000000000002","nombre":"P2 rent",
     "unidades_vendidas":1,"ingresos":5000,"costo_unitario_estimado":null,
     "costo_estimado":null,"beneficio_estimado":null,"margen":null,"gastos_periodo":50}]'::jsonb,
  'productos: weighted unit cost with all purchases up to p_hasta, without cost data last'
);
-- 32
select is(
  (select j->'gastos_por_categoria' from r),
  '[{"categoria":"materiales","total":2000},{"categoria":"packaging","total":300},
    {"categoria":"envios","total":150},{"categoria":"otros","total":50}]'::jsonb,
  'gastos_por_categoria: the four categories in order'
);
-- 33
select is((select (j->>'gastos_generales')::numeric from r), 450::numeric,
  'gastos_generales: expenses without product');
-- 34
select is(
  (select jsonb_path_query_first(
            public.rentabilidad('2026-01-01', '2026-01-31'),
            '$.productos[*] ? (@.producto_id == "b7000000-0000-4000-8000-000000000001")')),
  '{"producto_id":"b7000000-0000-4000-8000-000000000001","nombre":"P1 rent",
    "unidades_vendidas":2,"ingresos":2000,"costo_unitario_estimado":80,
    "costo_estimado":160,"beneficio_estimado":1840,"margen":92.0,"gastos_periodo":1000}'::jsonb,
  'unit cost only uses purchases up to p_hasta'
);
-- 35
select is(
  public.rentabilidad('2025-11-01', '2025-11-30'),
  '{"por_mes":[{"mes":"2025-11","ingresos":0,"gastos":0,"beneficio":0,"margen":null}],
    "totales":{"ingresos":0,"gastos":0,"beneficio":0,"margen":null,"pedidos":0},
    "productos":[],
    "gastos_por_categoria":[{"categoria":"materiales","total":0},{"categoria":"packaging","total":0},
                            {"categoria":"envios","total":0},{"categoria":"otros","total":0}],
    "gastos_generales":0}'::jsonb,
  'an empty month is zero-filled'
);
-- 36
select throws_ok(
  $$ select public.rentabilidad('2026-02-01', '2026-01-01') $$,
  '22023', null, 'desde > hasta is rejected'
);
-- 37
select throws_ok(
  $$ select public.rentabilidad(null, '2026-01-01') $$,
  '22023', null, 'null dates are rejected'
);
-- 38 (estadisticas keeps its contract and numbers)
select is(
  (select jsonb_build_object('ventas_por_mes', j->'ventas_por_mes', 'total_periodo', j->'total_periodo')
     from (select public.estadisticas('2026-01-01', '2026-02-28') as j) e),
  '{"ventas_por_mes":[{"mes":"2026-01","pedidos":2,"total":7100},
                      {"mes":"2026-02","pedidos":1,"total":2500}],
    "total_periodo":9600}'::jsonb,
  'estadisticas() is unchanged and agrees with rentabilidad() on revenue'
);

-- ----------------------------------------------------------------------------
-- Deleting a product keeps its expenses as general ones.
-- ----------------------------------------------------------------------------
reset role;
delete from public.productos where id = 'b7000000-0000-4000-8000-000000000003';

-- 39
select is(
  (select producto_id from public.gastos where id = '97000000-0000-4000-8000-000000000008'),
  null::uuid,
  'deleting a product sets gastos.producto_id to null'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e7000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-0000000000ad';

-- 40
select is(
  (select (public.rentabilidad('2026-01-01', '2026-02-28')->>'gastos_generales')::numeric),
  850::numeric,
  'the expense of a deleted product counts as general'
);

select * from finish();

rollback;
