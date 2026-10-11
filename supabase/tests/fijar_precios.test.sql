-- ============================================================================
-- pgTAP tests for migration 20261011010000_fijar_precios.sql
--   * preview does not change anything; apply does, all at once
--   * category filter; products already at that price are left out
--   * only staff (cliente / anon get 42501)
--   * invalid price is rejected
--
-- Everything runs inside one transaction that is rolled back at the end.
-- ============================================================================

begin;

select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@fijar.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Clienta"}', now(), now()),
  ('a6000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'empleado@fijar.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Empleado"}', now(), now());
update public.profiles set rol = 'empleado' where id = 'a6000000-0000-4000-8000-0000000000e1';

insert into public.categorias (id, nombre) values
  ('a6c00000-0000-4000-8000-000000000001', 'Fijar A'),
  ('a6c00000-0000-4000-8000-000000000002', 'Fijar B');
insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('a6b00000-0000-4000-8000-000000000001', 'A1', 'a6c00000-0000-4000-8000-000000000001', 12340, 1),
  ('a6b00000-0000-4000-8000-000000000002', 'A2', 'a6c00000-0000-4000-8000-000000000001', 5000, 1),
  ('a6b00000-0000-4000-8000-000000000003', 'B1', 'a6c00000-0000-4000-8000-000000000002', 3000, 1);

-- 1
select throws_ok(
  $$ select public.fijar_precios(5000) $$,
  '42501', null,
  'without a staff session it is rejected'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a6000000-0000-4000-8000-000000000001';
-- 2
select throws_ok(
  $$ select public.fijar_precios(5000) $$,
  '42501', null,
  'a customer cannot set prices'
);

set local request.jwt.claims = '{"sub":"a6000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local request.jwt.claim.sub = 'a6000000-0000-4000-8000-0000000000e1';
-- 3 (A2 is already 5000, so it is left out)
select is(
  (public.fijar_precios(5000, 'a6c00000-0000-4000-8000-000000000001') -> 'cambios'),
  '[{"id":"a6b00000-0000-4000-8000-000000000001","nombre":"A1","antes":12340,"despues":5000}]'::jsonb,
  'preview: only the chosen category, skipping products already at that price'
);
-- 4
select is(
  (select precio from public.productos where id = 'a6b00000-0000-4000-8000-000000000001'),
  12340::numeric,
  'preview does not change prices'
);
-- 5
select is(
  (public.fijar_precios(7500, 'a6c00000-0000-4000-8000-000000000001', false) ->> 'cantidad')::int,
  2,
  'apply reports how many products changed'
);
-- 6
select results_eq(
  $$ select nombre, precio from public.productos
      where id::text like 'a6b00000%' order by nombre $$,
  $$ values ('A1'::text, 7500::numeric), ('A2', 7500), ('B1', 3000) $$,
  'apply changes the category prices and leaves the others alone'
);
-- 7
select is(
  (public.fijar_precios(1999.999) -> 'cambios' -> 0 ->> 'despues')::numeric,
  2000::numeric,
  'the price is rounded to 2 decimals'
);
-- 8
select throws_ok(
  $$ select public.fijar_precios(0) $$,
  '22023', null,
  'a price of 0 is rejected'
);
-- 9
select throws_ok(
  $$ select public.fijar_precios(-10) $$,
  '22023', null,
  'a negative price is rejected'
);

select * from finish();

rollback;
