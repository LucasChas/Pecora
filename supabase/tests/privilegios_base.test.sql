-- ============================================================================
-- pgTAP: table privileges the app relies on (Data API roles).
--
-- Why this file exists: migrations 0001-0014 never GRANT table privileges to
-- anon/authenticated. They rely on the legacy "auto expose" defaults of the
-- production project, reproduced locally by `auto_expose_new_tables = true` in
-- supabase/config.toml (a deprecated field, removed on 2026-10-30). If those
-- defaults go away, the public catalog or the admin panel stops working. This
-- file pins the access the app needs, so that drift fails CI.
--
-- Two kinds of checks:
--   * privileges (has_table_privilege / has_column_privilege): what each role
--     must, or must not, be GRANTed;
--   * effective access (privilege + RLS), through test_privilegios.intento():
--     a write that must be impossible passes whether it is denied by a missing
--     privilege (error 42501) or filtered out by RLS (0 rows). So this file
--     keeps passing after the explicit-GRANT migration that replaces
--     auto-expose, as long as the access stays the same.
--
-- The "required" lists below are mirrored by the production check query in
-- CONTEXTO.md §8 (Permisos de tablas). Keep both in sync.
--
-- Run locally with:  supabase db start && supabase test db --local
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(28);

-- ----------------------------------------------------------------------------
-- Helper (rolled back with the rest): runs a statement as the current role and
-- returns 'denegado' if it fails with insufficient_privilege (missing GRANT or
-- RLS WITH CHECK violation), otherwise the number of rows it returned or
-- affected. Any other error propagates and fails the test.
-- ----------------------------------------------------------------------------
create schema test_privilegios;
grant usage on schema test_privilegios to anon, authenticated;

create function test_privilegios.intento(sql text)
returns text language plpgsql security invoker as $$
declare
  filas bigint;
begin
  execute sql;
  get diagnostics filas = row_count;
  return filas::text;
exception when insufficient_privilege then
  return 'denegado';
end;
$$;
grant execute on function test_privilegios.intento(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres): a customer, an admin, a category, a product and an
-- order of the customer. Order items are empty so that changing its estado
-- never touches stock.
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@privilegios.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Clienta"}', now(), now()),
  ('c1000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@privilegios.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

update public.profiles set rol = 'admin' where id = 'c1000000-0000-4000-8000-0000000000ad';

insert into public.categorias (id, nombre)
values ('ca100000-0000-4000-8000-000000000001', 'Categoria privilegios');

insert into public.productos (id, nombre, categoria_id, precio, stock)
values ('b2000000-0000-4000-8000-000000000001', 'Producto privilegios',
        'ca100000-0000-4000-8000-000000000001', 1000, 5);

insert into public.pedidos (id, user_id, nombre, telefono, items, subtotal)
values ('d2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'Clienta', '111', '[]', 0);

-- ----------------------------------------------------------------------------
-- Privileges. On failure, pgTAP lists the offending rows.
-- ----------------------------------------------------------------------------
-- 1
select is_empty(
  $$ select tabla, privilegio
       from (values ('categorias', 'SELECT'), ('productos', 'SELECT')) r(tabla, privilegio)
      where not has_table_privilege('anon', 'public.' || tabla, privilegio) $$,
  'anon has every table privilege the public catalog needs'
);
-- 2
select is_empty(
  $$ select tabla, privilegio
       from (values ('categorias', 'SELECT'), ('categorias', 'INSERT'),
                    ('categorias', 'UPDATE'), ('categorias', 'DELETE'),
                    ('productos',  'SELECT'), ('productos',  'INSERT'),
                    ('productos',  'UPDATE'), ('productos',  'DELETE'),
                    ('pedidos',    'SELECT'), ('pedidos',    'UPDATE'),
                    ('pedidos',    'DELETE'),
                    ('profiles',   'SELECT'),
                    ('ventas_validas', 'SELECT')) r(tabla, privilegio)
      where not has_table_privilege('authenticated', 'public.' || tabla, privilegio) $$,
  'authenticated has every table privilege the customer pages and the admin panel need'
);
-- 3 (Edge Function enviar-recibo-pedido uses the service-role key)
select is_empty(
  $$ select tabla, privilegio
       from (values ('pedidos', 'SELECT'), ('pedidos', 'UPDATE')) r(tabla, privilegio)
      where not has_table_privilege('service_role', 'public.' || tabla, privilegio) $$,
  'service_role has every table privilege the Edge Function needs'
);
-- 4
select is_empty(
  $$ select rol, tabla, privilegio
       from (values ('anon',          'profiles',       'UPDATE'),
                    ('authenticated', 'profiles',       'UPDATE'),
                    ('anon',          'ventas_validas', 'SELECT'),
                    ('authenticated', 'ventas_validas', 'INSERT'),
                    ('authenticated', 'ventas_validas', 'UPDATE'),
                    ('authenticated', 'ventas_validas', 'DELETE')) f(rol, tabla, privilegio)
      where has_table_privilege(rol, 'public.' || tabla, privilegio) $$,
  'no role has a table privilege that must stay revoked (0014, ventas_validas)'
);
-- 5 (0014: authenticated may update only nombre and telefono)
select results_eq(
  $$ select columna::text, has_column_privilege('authenticated', 'public.profiles', columna, 'UPDATE')
       from (values ('nombre'), ('telefono'), ('rol')) c(columna)
      order by columna $$,
  $$ values ('nombre'::text, true), ('rol', false), ('telefono', true) $$,
  'authenticated can update profiles.nombre and profiles.telefono, not profiles.rol'
);

-- ----------------------------------------------------------------------------
-- Effective access as anon (public catalog).
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 6
select is(
  test_privilegios.intento($$ select 1 from public.productos
                               where id = 'b2000000-0000-4000-8000-000000000001' $$),
  '1',
  'anon can read productos'
);
-- 7
select is(
  test_privilegios.intento($$ select 1 from public.categorias
                               where id = 'ca100000-0000-4000-8000-000000000001' $$),
  '1',
  'anon can read categorias'
);
-- 8
select is(
  test_privilegios.intento($$ insert into public.categorias (nombre) values ('Anon') $$),
  'denegado',
  'anon cannot insert categorias'
);
-- 9
select matches(
  test_privilegios.intento($$ update public.categorias set nombre = 'Anon'
                               where id = 'ca100000-0000-4000-8000-000000000001' $$),
  '^(denegado|0)$',
  'anon cannot update categorias'
);
-- 10
select matches(
  test_privilegios.intento($$ delete from public.categorias
                               where id = 'ca100000-0000-4000-8000-000000000001' $$),
  '^(denegado|0)$',
  'anon cannot delete categorias'
);
-- 11
select is(
  test_privilegios.intento($$ insert into public.productos (nombre, precio, stock)
                               values ('Anon', 1, 1) $$),
  'denegado',
  'anon cannot insert productos'
);
-- 12
select matches(
  test_privilegios.intento($$ update public.productos set precio = 1
                               where id = 'b2000000-0000-4000-8000-000000000001' $$),
  '^(denegado|0)$',
  'anon cannot update productos'
);
-- 13
select matches(
  test_privilegios.intento($$ delete from public.productos
                               where id = 'b2000000-0000-4000-8000-000000000001' $$),
  '^(denegado|0)$',
  'anon cannot delete productos'
);
-- 14
select matches(
  test_privilegios.intento($$ select 1 from public.pedidos $$),
  '^(denegado|0)$',
  'anon cannot read pedidos'
);
-- 15
select matches(
  test_privilegios.intento($$ select 1 from public.profiles $$),
  '^(denegado|0)$',
  'anon cannot read profiles'
);

-- ----------------------------------------------------------------------------
-- Effective access as a customer (authenticated, rol cliente).
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';

-- 16
select is(
  test_privilegios.intento($$ select 1 from public.productos
                               where id = 'b2000000-0000-4000-8000-000000000001' $$),
  '1',
  'a customer can read productos'
);
-- 17
select is(
  test_privilegios.intento($$ select 1 from public.categorias
                               where id = 'ca100000-0000-4000-8000-000000000001' $$),
  '1',
  'a customer can read categorias'
);
-- 18
select is(
  test_privilegios.intento($$ select 1 from public.pedidos
                               where id = 'd2000000-0000-4000-8000-000000000001' $$),
  '1',
  'a customer can read her own pedido'
);
-- 19 (orders are created only through crear_pedido)
select is(
  test_privilegios.intento($$ insert into public.pedidos (nombre, telefono, items)
                               values ('Clienta', '111', '[]') $$),
  'denegado',
  'a customer cannot insert pedidos directly'
);
-- 20
select is(
  test_privilegios.intento($$ insert into public.productos (nombre, precio, stock)
                               values ('Clienta', 1, 1) $$),
  'denegado',
  'a customer cannot insert productos'
);
-- 21
select matches(
  test_privilegios.intento($$ update public.productos set precio = 1
                               where id = 'b2000000-0000-4000-8000-000000000001' $$),
  '^(denegado|0)$',
  'a customer cannot update productos'
);
-- 22
select matches(
  test_privilegios.intento($$ delete from public.productos
                               where id = 'b2000000-0000-4000-8000-000000000001' $$),
  '^(denegado|0)$',
  'a customer cannot delete productos'
);

-- ----------------------------------------------------------------------------
-- Effective access as the admin (authenticated, rol admin): the admin panel.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-0000000000ad';

-- 23
select is(
  test_privilegios.intento($$ insert into public.categorias (id, nombre)
                               values ('ca100000-0000-4000-8000-000000000002', 'Nueva') $$),
  '1',
  'the admin can insert categorias'
);
-- 24
select is(
  test_privilegios.intento($$ delete from public.categorias
                               where id = 'ca100000-0000-4000-8000-000000000002' $$),
  '1',
  'the admin can delete categorias'
);
-- 25
select is(
  test_privilegios.intento($$ insert into public.productos (id, nombre, precio, stock)
                               values ('b2000000-0000-4000-8000-000000000002', 'Nuevo', 500, 1) $$),
  '1',
  'the admin can insert productos'
);
-- 26
select is(
  test_privilegios.intento($$ update public.productos set precio = 1500
                               where id = 'b2000000-0000-4000-8000-000000000001' $$),
  '1',
  'the admin can update productos'
);
-- 27
select is(
  test_privilegios.intento($$ delete from public.productos
                               where id = 'b2000000-0000-4000-8000-000000000002' $$),
  '1',
  'the admin can delete productos'
);
-- 28
select is(
  test_privilegios.intento($$ update public.pedidos set estado = 'confirmado'
                               where id = 'd2000000-0000-4000-8000-000000000001' $$),
  '1',
  'the admin can update the estado of a pedido'
);

select * from finish();

rollback;
