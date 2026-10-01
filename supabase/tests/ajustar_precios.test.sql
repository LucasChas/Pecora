-- ============================================================================
-- pgTAP tests for migration 20261001040000_ajustar_precios.sql
--   * preview does not change anything; apply does, all at once
--   * percentage, rounding to a multiple, category filter
--   * only staff (cliente / anon get 42501 or no EXECUTE)
--   * invalid percentage is rejected
--
-- Everything runs inside one transaction that is rolled back at the end.
-- ============================================================================

begin;

select plan(11);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@precios.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Clienta"}', now(), now()),
  ('a5000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'empleado@precios.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Empleado"}', now(), now());
update public.profiles set rol = 'empleado' where id = 'a5000000-0000-4000-8000-0000000000e1';

insert into public.categorias (id, nombre) values
  ('a5c00000-0000-4000-8000-000000000001', 'Precios A'),
  ('a5c00000-0000-4000-8000-000000000002', 'Precios B');
insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('a5b00000-0000-4000-8000-000000000001', 'A1', 'a5c00000-0000-4000-8000-000000000001', 12340, 1),
  ('a5b00000-0000-4000-8000-000000000002', 'A2', 'a5c00000-0000-4000-8000-000000000001', 1000, 1),
  ('a5b00000-0000-4000-8000-000000000003', 'B1', 'a5c00000-0000-4000-8000-000000000002', 5000, 1);

-- 1
select throws_ok(
  $$ select public.ajustar_precios(10) $$,
  '42501', null,
  'without a staff session it is rejected'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000001';
-- 2
select throws_ok(
  $$ select public.ajustar_precios(10) $$,
  '42501', null,
  'a customer cannot adjust prices'
);

set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-0000000000e1';
-- 3
select is(
  (public.ajustar_precios(10, 'a5c00000-0000-4000-8000-000000000001', 100) -> 'cambios'),
  '[{"id":"a5b00000-0000-4000-8000-000000000001","nombre":"A1","antes":12340,"despues":13600},
    {"id":"a5b00000-0000-4000-8000-000000000002","nombre":"A2","antes":1000,"despues":1100}]'::jsonb,
  'preview: +10 %, rounded to 100, only the chosen category'
);
-- 4
select is(
  (select precio from public.productos where id = 'a5b00000-0000-4000-8000-000000000001'),
  12340::numeric,
  'preview does not change prices'
);
-- 5
select is(
  (public.ajustar_precios(10, 'a5c00000-0000-4000-8000-000000000001', 100, false) ->> 'cantidad')::int,
  2,
  'apply reports how many products changed'
);
-- 6
select results_eq(
  $$ select nombre, precio from public.productos
      where id::text like 'a5b00000%' order by nombre $$,
  $$ values ('A1'::text, 13600::numeric), ('A2', 1100), ('B1', 5000) $$,
  'apply changes the category prices and leaves the others alone'
);
-- 7
select is(
  (public.ajustar_precios(-15, null, 0) -> 'cambios' -> 2 ->> 'despues')::numeric,
  4250::numeric,
  'without rounding: -15 % of 5000 = 4250'
);
-- 8
select throws_ok(
  $$ select public.ajustar_precios(0) $$,
  '22023', null,
  'a 0 % adjustment is rejected'
);
-- 9
select throws_ok(
  $$ select public.ajustar_precios(-95) $$,
  '22023', null,
  'more than -90 % is rejected'
);

-- 10 (B1 = 5000: -15 % = 4250, rounded to 10000 would be 0)
select is(
  (public.ajustar_precios(-15, 'a5c00000-0000-4000-8000-000000000002', 10000) ->> 'cantidad')::int,
  0,
  'rounding that would leave a price at 0 leaves it unchanged'
);
-- 11 (A2 = 1100: +10 % = 1210, rounded to 1000 would go down; A1 13600 -> 15000)
select is(
  (public.ajustar_precios(10, 'a5c00000-0000-4000-8000-000000000001', 1000) -> 'cambios'),
  '[{"id":"a5b00000-0000-4000-8000-000000000001","nombre":"A1","antes":13600,"despues":15000}]'::jsonb,
  'rounding that would move a price against the requested direction leaves it unchanged'
);

select * from finish();

rollback;
