-- ============================================================================
-- pgTAP tests for migration 20261002030000_favoritos_direcciones.sql
-- ============================================================================

begin;

select plan(11);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('bc000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@fd.test', '{}', '{"nombre":"Ana"}', now(), now()),
  ('bc000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'otra@fd.test', '{}', '{"nombre":"Otra"}', now(), now());

insert into public.categorias (id, nombre) values ('bcc00000-0000-4000-8000-000000000001', 'Cat fd');
insert into public.productos (id, nombre, categoria_id, precio, stock)
values ('bcb00000-0000-4000-8000-000000000001', 'Body fd', 'bcc00000-0000-4000-8000-000000000001', 100, 5);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bc000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'bc000000-0000-4000-8000-000000000001';

-- 1
select lives_ok(
  $$ insert into public.favoritos (producto_id) values ('bcb00000-0000-4000-8000-000000000001') $$,
  'a customer can add a favorite (user_id is filled in)'
);
-- 2
select throws_ok(
  $$ insert into public.favoritos (user_id, producto_id) values ('bc000000-0000-4000-8000-000000000002', 'bcb00000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'nobody can add a favorite for another account'
);
-- 3
select lives_ok(
  $$ insert into public.direcciones (alias, direccion, localidad, cp, provincia, principal)
     values ('Casa', 'San Martín 123', 'Córdoba', '5000', 'Córdoba', true) $$,
  'a customer can save an address'
);
-- 4
select lives_ok(
  $$ insert into public.direcciones (alias, direccion, localidad, principal)
     values ('Trabajo', 'Colón 500', 'Córdoba', true) $$,
  'a second main address is accepted'
);
-- 5
select is(
  (select alias from public.direcciones where principal),
  'Trabajo',
  'only the last one marked stays as the main address'
);
-- 6
select throws_ok(
  $$ insert into public.direcciones (alias, direccion, localidad) values ('', 'x', 'y') $$,
  '23514', null,
  'empty alias is rejected'
);
-- 7
select throws_ok(
  $$ insert into public.direcciones (alias, direccion, localidad)
     select 'D' || g, 'Calle ' || g, 'Córdoba' from generate_series(1, 9) g $$,
  'P0001', 'Podés guardar hasta 10 direcciones.',
  'more than 10 addresses are rejected'
);

-- La otra cuenta no ve nada de Ana.
set local request.jwt.claims = '{"sub":"bc000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'bc000000-0000-4000-8000-000000000002';
-- 8
select is((select count(*)::int from public.favoritos), 0, 'another account sees no favorites of Ana');
-- 9
select is((select count(*)::int from public.direcciones), 0, 'another account sees no addresses of Ana');
-- 10
update public.direcciones set alias = 'Hackeada';
reset role;
select is((select count(*)::int from public.direcciones where alias = 'Hackeada'), 0, 'another account cannot change her addresses');

set local role anon;
-- 11
select throws_ok($$ select * from public.favoritos $$, '42501', null, 'anon cannot read favorites');

select * from finish();

rollback;
