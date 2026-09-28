-- ============================================================================
-- pgTAP tests for migration 0014_proteger_rol.sql
--
-- Run locally with:  supabase db start && supabase test db
--
-- Everything runs inside one transaction that is rolled back at the end, so
-- the fixtures (auth users, profiles, the temporary GRANT) never persist.
--
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(20);

-- ----------------------------------------------------------------------------
-- Fixtures: two customers created through the signup path (auth.users ->
-- on_auth_user_created -> handle_new_user -> public.profiles).
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@pecora.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Clienta","telefono":"111"}',
   now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'otra@pecora.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Otra","telefono":"222"}',
   now(), now());

-- 1
select results_eq(
  $$ select nombre, telefono, rol from public.profiles
     where id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('Clienta'::text, '111'::text, 'cliente'::text) $$,
  'signup (insert into auth.users) creates a cliente profile with nombre/telefono'
);

-- ----------------------------------------------------------------------------
-- Layer 1: column privileges.
-- ----------------------------------------------------------------------------
-- 2
select is(
  has_column_privilege('authenticated', 'public.profiles', 'rol', 'UPDATE'),
  false,
  'authenticated has no UPDATE privilege on profiles.rol'
);
-- 3
select is(
  has_column_privilege('authenticated', 'public.profiles', 'nombre', 'UPDATE'),
  true,
  'authenticated has UPDATE privilege on profiles.nombre'
);
-- 4
select is(
  has_column_privilege('authenticated', 'public.profiles', 'telefono', 'UPDATE'),
  true,
  'authenticated has UPDATE privilege on profiles.telefono'
);
-- 5
select is(
  has_table_privilege('anon', 'public.profiles', 'UPDATE'),
  false,
  'anon has no UPDATE privilege on profiles'
);

-- ----------------------------------------------------------------------------
-- Layer 2: trigger.
-- ----------------------------------------------------------------------------
-- 6
select has_trigger(
  'public', 'profiles', 'proteger_rol_perfil',
  'trigger proteger_rol_perfil exists on public.profiles'
);
-- 7
select is(
  (select tgenabled::text from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'proteger_rol_perfil'),
  'O',
  'trigger proteger_rol_perfil is enabled'
);
-- 8 (SECURITY DEFINER would make current_user the owner and defeat the check)
select is(
  (select prosecdef from pg_proc where oid = to_regprocedure('public.proteger_rol_perfil()')),
  false,
  'proteger_rol_perfil() is SECURITY INVOKER'
);

-- ----------------------------------------------------------------------------
-- As customer 1 (authenticated).
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- 9
select throws_ok(
  $$ update public.profiles set rol = 'admin'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'customer cannot change her own rol'
);

-- 10
select lives_ok(
  $$ update public.profiles set nombre = 'Ana', telefono = '3541'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  'customer can update her own nombre and telefono'
);

-- 11
select results_eq(
  $$ select nombre, telefono, rol from public.profiles
     where id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('Ana'::text, '3541'::text, 'cliente'::text) $$,
  'own nombre/telefono are saved and rol stays cliente'
);

-- 12
select is_empty(
  $$ update public.profiles set nombre = 'Hacked'
     where id = '22222222-2222-2222-2222-222222222222'
     returning id $$,
  'customer update on another profile affects 0 rows'
);

-- 13
select throws_ok(
  $$ insert into public.profiles (id, rol)
     values ('33333333-3333-3333-3333-333333333333', 'admin') $$,
  '42501', null,
  'customer cannot insert an admin profile'
);

-- 14: layer 2 on its own. Simulate a future GRANT on rol (rolled back with
-- the rest of the transaction); the trigger must still block the change.
reset role;
grant update (rol) on public.profiles to authenticated;
set local role authenticated;

select throws_ok(
  $$ update public.profiles set rol = 'admin'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', 'No autorizado: el rol no se puede cambiar desde la app',
  'with a GRANT on rol, the trigger still blocks a customer rol change'
);

-- ----------------------------------------------------------------------------
-- As anon.
-- ----------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 15
select throws_ok(
  $$ update public.profiles set rol = 'admin' $$,
  '42501', null,
  'anon cannot update profiles'
);

-- ----------------------------------------------------------------------------
-- As postgres (SQL Editor / test runner) and service_role (backend).
-- ----------------------------------------------------------------------------
reset role;

-- 16
select is(
  (select nombre from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Otra',
  'the other profile was not modified by the customer'
);

-- 17
select lives_ok(
  $$ update public.profiles set rol = 'admin'
     where id = '22222222-2222-2222-2222-222222222222' $$,
  'postgres can change rol'
);

-- 18
select is(
  (select rol from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'admin',
  'rol changed by postgres is saved'
);

set local role service_role;

-- 19
select lives_ok(
  $$ update public.profiles set rol = 'cliente'
     where id = '22222222-2222-2222-2222-222222222222' $$,
  'service_role can change rol'
);

reset role;

-- 20
select is(
  (select rol from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'cliente',
  'rol changed by service_role is saved'
);

select * from finish();

rollback;
