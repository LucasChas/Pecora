-- ============================================================================
-- pgTAP tests for migration 20261002010000_mi_cuenta.sql
-- ============================================================================

begin;

select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('ba000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@mc.test', '{}', '{"nombre":"Ana"}', now(), now()),
  ('ba000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@mc.test', '{}', '{"nombre":"Admin"}', now(), now());
update public.profiles set rol = 'admin' where id = 'ba000000-0000-4000-8000-0000000000ad';

insert into public.categorias (id, nombre) values ('bac00000-0000-4000-8000-000000000001', 'Cat mc');
insert into public.productos (id, nombre, categoria_id, precio, stock)
values ('bab00000-0000-4000-8000-000000000001', 'Body mc', 'bac00000-0000-4000-8000-000000000001', 100, 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"ba000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'ba000000-0000-4000-8000-000000000001';

-- 1
select lives_ok(
  $$ update public.profiles set nombre = 'Ana Pérez', telefono = '3515551234', acepta_novedades = true
      where id = 'ba000000-0000-4000-8000-000000000001' $$,
  'the customer can update her name, phone and newsletter preference'
);
-- 2
select throws_ok(
  $$ update public.profiles set rol = 'admin' where id = 'ba000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'the customer still cannot change her role'
);
-- 3
select throws_ok(
  $$ update public.profiles set nombre = repeat('a', 121) where id = 'ba000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'a name longer than 120 characters is rejected'
);

-- Datos para ver qué pasa al borrar la cuenta.
select public.suscribir_aviso_stock('bab00000-0000-4000-8000-000000000001');
reset role;
insert into public.pedidos (id, user_id, nombre, telefono, items, subtotal)
values ('bad00000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'Ana', '1', '[]', 0);
set local role authenticated;

-- 4
select is(public.eliminar_mi_cuenta(), true, 'the customer can delete her account');

reset role;
-- 5
select is((select count(*)::int from auth.users where id = 'ba000000-0000-4000-8000-000000000001'), 0, 'the auth user is gone');
-- 6
select is((select count(*)::int from public.profiles where id = 'ba000000-0000-4000-8000-000000000001'), 0, 'the profile is gone');
-- 7
select is((select count(*)::int from public.avisos_stock where user_id = 'ba000000-0000-4000-8000-000000000001'), 0, 'stock alerts are gone');
-- 8
select is(
  (select user_id from public.pedidos where id = 'bad00000-0000-4000-8000-000000000001'),
  null::uuid,
  'orders stay as sales records without an account'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"ba000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'ba000000-0000-4000-8000-0000000000ad';
-- 9
select throws_ok($$ select public.eliminar_mi_cuenta() $$, '42501', null, 'staff accounts cannot delete themselves here');

reset role;
set local role anon;
-- 10
select throws_ok($$ select public.eliminar_mi_cuenta() $$, '42501', null, 'anon cannot call it');

select * from finish();

rollback;
