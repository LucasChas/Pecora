-- ============================================================================
-- pgTAP tests for migration 20260928144833_roles_empleados.sql
--   * profiles.rol accepts 'empleado'; es_staff()
--   * permissions matrix anon / cliente / empleado / admin: productos,
--     categorias, storage (bucket productos), pedidos (select, estado,
--     papelera, other columns, hard delete), cupones, zonas_envio, cupon_usos,
--     ventas_validas, estadisticas, importar_productos, reenviar_emails_pedido
--   * crear_pedido / validar_cupon: manual orders by an empleado
--   * rol changes are still blocked from the API (0014); service_role can.
--
-- Run locally with:  supabase db start && supabase test db --local
--
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(66);

-- Same helper as privilegios_base.test.sql: 'denegado' on insufficient
-- privilege / RLS WITH CHECK, otherwise the number of affected rows.
create schema test_roles;
grant usage on schema test_roles to anon, authenticated;

create function test_roles.intento(sql text)
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
grant execute on function test_roles.intento(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres).
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@roles.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Clienta"}', now(), now()),
  ('e3000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'empleado@roles.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Empleado"}', now(), now()),
  ('e3000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@roles.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

-- 1
select lives_ok(
  $$ update public.profiles set rol = 'empleado' where id = 'e3000000-0000-4000-8000-0000000000e1' $$,
  'profiles.rol accepts empleado (as postgres)'
);
update public.profiles set rol = 'admin' where id = 'e3000000-0000-4000-8000-0000000000ad';

-- 2
select throws_ok(
  $$ update public.profiles set rol = 'jefa' where id = 'e3000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'profiles.rol rejects values other than cliente / empleado / admin'
);
-- 3
select is(
  (select prosecdef from pg_proc where oid = to_regprocedure('public.es_staff()')),
  true,
  'es_staff() is SECURITY DEFINER'
);
-- 4
select results_eq(
  $$ select r.rol::text, f.fn::text, has_function_privilege(r.rol, f.fn, 'EXECUTE')
       from (values ('anon'), ('authenticated')) r(rol),
            (values ('public.estadisticas(date,date)'),
                    ('public.importar_productos(jsonb,boolean)'),
                    ('public.mas_vendidos(integer,integer)')) f(fn)
      order by 1, 2 $$,
  $$ values ('anon'::text, 'public.estadisticas(date,date)'::text, false),
            ('anon', 'public.importar_productos(jsonb,boolean)', false),
            ('anon', 'public.mas_vendidos(integer,integer)', true),
            ('authenticated', 'public.estadisticas(date,date)', true),
            ('authenticated', 'public.importar_productos(jsonb,boolean)', true),
            ('authenticated', 'public.mas_vendidos(integer,integer)', true) $$,
  'EXECUTE on the new RPCs: estadisticas / importar_productos logged-in only, mas_vendidos public'
);

insert into public.categorias (id, nombre)
values ('ca300000-0000-4000-8000-000000000001', 'Categoria roles');

insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('b3000000-0000-4000-8000-000000000001', 'Producto roles',
   'ca300000-0000-4000-8000-000000000001', 1000, 50);

-- d1: the customer's order with items (read-only in these tests).
-- d2: the customer's order with no items: estado / papelera changes never
--     touch stock.
-- d3: an order of the empleado herself (makes a "first purchase" coupon
--     invalid for her as a customer).
insert into public.pedidos (id, user_id, nombre, telefono, items, subtotal) values
  ('d3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   'Clienta', '111',
   '[{"id":"b3000000-0000-4000-8000-000000000001","nombre":"Producto roles","precio":1000,"cantidad":1}]',
   1000),
  ('d3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000001',
   'Clienta', '111', '[]', 0),
  ('d3000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-0000000000e1',
   'Empleado', '222', '[]', 0);

-- d4: a manual order (reenviar_emails_pedido refuses it after the permission
--     check, so the test does not depend on Vault).
insert into public.pedidos (id, user_id, nombre, telefono, items, subtotal, origen) values
  ('d3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-0000000000ad',
   'Por WhatsApp', '444', '[]', 0, 'admin');

insert into public.cupones (id, codigo, tipo, valor, solo_primera_compra, usos_por_cliente)
values ('f3000000-0000-4000-8000-000000000001', 'ROLESBIENVENIDA', 'porcentaje', 10, true, null);

-- ----------------------------------------------------------------------------
-- anon
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 5
select is(public.es_staff(), false, 'anon: es_staff() is false');
-- 6
select is(
  test_roles.intento($$ insert into public.productos (nombre, precio, stock) values ('Anon', 1, 1) $$),
  'denegado',
  'anon cannot insert productos'
);

-- ----------------------------------------------------------------------------
-- cliente
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'e3000000-0000-4000-8000-000000000001';

-- 7
select is(public.es_staff(), false, 'cliente: es_staff() is false');
-- 8
select is(
  test_roles.intento($$ insert into public.categorias (nombre) values ('Clienta') $$),
  'denegado',
  'cliente cannot insert categorias'
);
-- 9
select is(
  test_roles.intento($$ insert into storage.objects (bucket_id, name) values ('productos', 'clienta.jpg') $$),
  'denegado',
  'cliente cannot upload to the productos bucket'
);
-- 10
select is(
  test_roles.intento($$ select 1 from public.pedidos where id = 'd3000000-0000-4000-8000-000000000003' $$),
  '0',
  'cliente cannot read another account''s pedido'
);
-- 11
select matches(
  test_roles.intento($$ update public.pedidos set estado = 'confirmado'
                         where id = 'd3000000-0000-4000-8000-000000000002' $$),
  '^(denegado|0)$',
  'cliente cannot update pedidos (not even her own)'
);
-- 12
select throws_ok(
  $$ update public.profiles set rol = 'empleado' where id = 'e3000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'cliente cannot make herself empleado'
);
-- 13
select is(
  (select count(*)::int from public.ventas_validas),
  1,
  'cliente sees only her own ventas_validas rows'
);
-- 14
select throws_ok(
  $$ select public.estadisticas('2026-01-01', '2026-01-31') $$,
  '42501', null,
  'cliente cannot call estadisticas'
);
-- 15
select throws_ok(
  $$ select public.importar_productos('[{"sku":"X"}]'::jsonb) $$,
  '42501', null,
  'cliente cannot call importar_productos'
);
-- 16b
select throws_ok(
  $$ select public.reenviar_emails_pedido('d3000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'cliente cannot resend order emails'
);
-- 16 (validar_cupon ignores p_pedido_manual for customers)
select is(
  (public.validar_cupon('ROLESBIENVENIDA', 1000, true))->>'valido',
  'false',
  'cliente: p_pedido_manual is ignored (she already bought, first-purchase coupon stays invalid)'
);

-- ----------------------------------------------------------------------------
-- empleado
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"e3000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local request.jwt.claim.sub = 'e3000000-0000-4000-8000-0000000000e1';

-- 17
select is(public.es_staff(), true, 'empleado: es_staff() is true');
-- 18
select is(public.es_admin(), false, 'empleado: es_admin() is false');
-- 19
select is(
  test_roles.intento($$ insert into public.categorias (id, nombre)
                         values ('ca300000-0000-4000-8000-000000000002', 'Nueva empleado') $$),
  '1',
  'empleado can insert categorias'
);
-- 20
select is(
  test_roles.intento($$ update public.categorias set nombre = 'Renombrada empleado'
                         where id = 'ca300000-0000-4000-8000-000000000002' $$),
  '1',
  'empleado can update categorias'
);
-- 21
select is(
  test_roles.intento($$ delete from public.categorias
                         where id = 'ca300000-0000-4000-8000-000000000002' $$),
  '1',
  'empleado can delete categorias'
);
-- 22
select is(
  test_roles.intento($$ insert into public.productos (id, nombre, precio, stock)
                         values ('b3000000-0000-4000-8000-000000000002', 'Nuevo empleado', 500, 2) $$),
  '1',
  'empleado can insert productos'
);
-- 23
select is(
  test_roles.intento($$ update public.productos set precio = 700
                         where id = 'b3000000-0000-4000-8000-000000000002' $$),
  '1',
  'empleado can update productos'
);
-- 24
select is(
  test_roles.intento($$ delete from public.productos
                         where id = 'b3000000-0000-4000-8000-000000000002' $$),
  '1',
  'empleado can delete productos'
);
-- 25
select is(
  test_roles.intento($$ insert into storage.objects (bucket_id, name)
                         values ('productos', 'empleado/foto.jpg') $$),
  '1',
  'empleado can upload to the productos bucket'
);
-- 26
select is(
  test_roles.intento($$ update storage.objects set name = 'empleado/foto2.jpg'
                         where bucket_id = 'productos' and name = 'empleado/foto.jpg' $$),
  '1',
  'empleado can replace files in the productos bucket'
);
-- 27
-- The Storage API sets this flag before deleting (storage.protect_delete).
select set_config('storage.allow_delete_query', 'true', true);
select is(
  test_roles.intento($$ delete from storage.objects
                         where bucket_id = 'productos' and name = 'empleado/foto2.jpg' $$),
  '1',
  'empleado can delete files in the productos bucket'
);
-- 28
select is(
  test_roles.intento($$ select 1 from public.pedidos
                         where id in ('d3000000-0000-4000-8000-000000000001',
                                      'd3000000-0000-4000-8000-000000000002') $$),
  '2',
  'empleado can read every pedido'
);
-- 29
select is(
  test_roles.intento($$ update public.pedidos set estado = 'confirmado'
                         where id = 'd3000000-0000-4000-8000-000000000002' $$),
  '1',
  'empleado can change the estado of a pedido'
);
-- 30
select is(
  test_roles.intento($$ update public.pedidos set eliminado_at = now()
                         where id = 'd3000000-0000-4000-8000-000000000002' $$),
  '1',
  'empleado can send a pedido to the papelera'
);
-- 31
select is(
  test_roles.intento($$ update public.pedidos set eliminado_at = null, estado = 'nuevo'
                         where id = 'd3000000-0000-4000-8000-000000000002' $$),
  '1',
  'empleado can restore a pedido from the papelera'
);
-- 32
select throws_ok(
  $$ update public.pedidos set descuento = 10 where id = 'd3000000-0000-4000-8000-000000000002' $$,
  '42501', 'No autorizado: solo la admin puede modificar los datos del pedido',
  'empleado cannot change other columns of a pedido (descuento)'
);
-- 33
select throws_ok(
  $$ update public.pedidos set estado = 'entregado', telefono = '999'
      where id = 'd3000000-0000-4000-8000-000000000002' $$,
  '42501', null,
  'empleado cannot sneak other columns into an estado change'
);
-- 34
select matches(
  test_roles.intento($$ delete from public.pedidos
                         where id = 'd3000000-0000-4000-8000-000000000002' $$),
  '^(denegado|0)$',
  'empleado cannot hard-delete pedidos'
);
-- 35
select matches(
  test_roles.intento($$ select 1 from public.cupones $$),
  '^(denegado|0)$',
  'empleado cannot read cupones'
);
-- 36
select is(
  test_roles.intento($$ insert into public.cupones (codigo, tipo, valor) values ('EMPL', 'monto', 1) $$),
  'denegado',
  'empleado cannot create cupones'
);
-- 37
select is(
  test_roles.intento($$ insert into public.zonas_envio (nombre, precio) values ('Empleado', 1) $$),
  'denegado',
  'empleado cannot create zonas_envio'
);
-- 38
select matches(
  test_roles.intento($$ select 1 from public.cupon_usos $$),
  '^(denegado|0)$',
  'empleado cannot read cupon_usos'
);
-- 39
select is(
  (select count(*)::int from public.ventas_validas where user_id <> auth.uid()),
  0,
  'empleado does not see other accounts'' rows in ventas_validas'
);
-- 40
select throws_ok(
  $$ select public.estadisticas('2026-01-01', '2026-01-31') $$,
  '42501', null,
  'empleado cannot call estadisticas'
);
-- 41
select throws_ok(
  $$ select public.reenviar_emails_pedido('d3000000-0000-4000-8000-000000000004') $$,
  'P0001', 'Los pedidos cargados a mano no mandan mails.',
  'empleado passes the permission check of reenviar_emails_pedido'
);
-- 42
select throws_ok(
  $$ update public.profiles set rol = 'admin' where id = 'e3000000-0000-4000-8000-0000000000e1' $$,
  '42501', null,
  'empleado cannot make herself admin'
);
-- 43
select throws_ok(
  $$ update public.profiles set rol = 'empleado' where id = 'e3000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'empleado cannot change another account''s rol'
);
-- 44 (as a customer she already has an order: first-purchase coupon invalid)
select is(
  (public.validar_cupon('ROLESBIENVENIDA', 1000, false))->>'valido',
  'false',
  'empleado as a customer: first-purchase coupon is invalid'
);
-- 45
select is(
  (public.validar_cupon('ROLESBIENVENIDA', 1000, true))->>'valido',
  'true',
  'empleado manual-order preview skips per-customer checks'
);
-- 46
select lives_ok(
  $$ select public.crear_pedido(
       'Clienta por WhatsApp', '333', null, 'coordinar', null, null, null, null,
       '[{"id":"b3000000-0000-4000-8000-000000000001","cantidad":2}]'::jsonb, 0,
       'admin', null, null, 'ROLESBIENVENIDA') $$,
  'empleado can load a manual order with a first-purchase coupon'
);
-- 47 (checked as postgres: cupon_usos is admin-only)
reset role;
select results_eq(
  $$ select p.origen, p.descuento, u.user_id is null
       from public.pedidos p join public.cupon_usos u on u.pedido_id = p.id
      where p.user_id = 'e3000000-0000-4000-8000-0000000000e1'
        and p.nombre = 'Clienta por WhatsApp' $$,
  $$ values ('admin'::text, 200.00::numeric(12,2), true) $$,
  'the manual order is origen admin, discounted, and its coupon use has no customer'
);
set local role authenticated;
-- 48
select lives_ok(
  $$ select public.importar_productos('[{"sku":"ROLES-1","nombre":"x","precio":1,"stock":1}]'::jsonb) $$,
  'empleado can call importar_productos'
);

-- ----------------------------------------------------------------------------
-- cliente again: her manual origen request is ignored.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"e3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'e3000000-0000-4000-8000-000000000001';

select public.crear_pedido(
  'Clienta pide origen admin', '111', null, 'coordinar', null, null, null, null,
  '[{"id":"b3000000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0, 'admin');
-- 49
select is(
  (select origen from public.pedidos where nombre = 'Clienta pide origen admin'),
  'checkout',
  'a customer asking for origen admin still gets checkout'
);

-- ----------------------------------------------------------------------------
-- admin
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"e3000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'e3000000-0000-4000-8000-0000000000ad';

-- 50
select is(public.es_staff(), true, 'admin: es_staff() is true');
-- 51
select is(
  test_roles.intento($$ update public.pedidos set costo_envio = 10
                         where id = 'd3000000-0000-4000-8000-000000000002' $$),
  '1',
  'admin can change any column of a pedido'
);
-- 52
select is(
  test_roles.intento($$ delete from public.pedidos
                         where id = 'd3000000-0000-4000-8000-000000000002' $$),
  '1',
  'admin can hard-delete pedidos'
);
-- 53
select is(
  (select count(distinct user_id)::int from public.ventas_validas
    where user_id in ('e3000000-0000-4000-8000-000000000001',
                      'e3000000-0000-4000-8000-0000000000e1')),
  2,
  'admin sees every account''s ventas_validas rows'
);
-- 54
select lives_ok(
  $$ select public.estadisticas('2026-01-01', '2026-01-31') $$,
  'admin can call estadisticas'
);
-- 55
select is(
  test_roles.intento($$ select 1 from public.cupones where id = 'f3000000-0000-4000-8000-000000000001' $$),
  '1',
  'admin can read cupones'
);
-- 56
select throws_ok(
  $$ update public.profiles set rol = 'empleado' where id = 'e3000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'even the admin cannot change a rol from the API'
);

-- 57 (layer 2 of 0014 on its own: with a GRANT on rol the trigger still blocks)
reset role;
grant update (rol) on public.profiles to authenticated;
set local role authenticated;
select throws_ok(
  $$ update public.profiles set rol = 'empleado' where id = 'e3000000-0000-4000-8000-0000000000ad' $$,
  '42501', 'No autorizado: el rol no se puede cambiar desde la app',
  'with a GRANT on rol, the 0014 trigger still blocks rol changes (admin to empleado on her own row)'
);
reset role;
revoke update (rol) on public.profiles from authenticated;

-- ----------------------------------------------------------------------------
-- service_role (Edge Function gestionar-equipo)
-- ----------------------------------------------------------------------------
set local role service_role;

-- 58
select lives_ok(
  $$ update public.profiles set rol = 'empleado' where id = 'e3000000-0000-4000-8000-000000000001' $$,
  'service_role can promote an account to empleado'
);
-- 59
select lives_ok(
  $$ update public.profiles set rol = 'cliente' where id = 'e3000000-0000-4000-8000-000000000001' $$,
  'service_role can revoke empleado back to cliente'
);

-- 59b
select results_eq(
  $$ select email, nombre, rol from public.equipo_listar()
      where email like '%@roles.test' $$,
  $$ values ('admin@roles.test'::text, 'Admin'::text, 'admin'::text),
            ('empleado@roles.test', 'Empleado', 'empleado') $$,
  'equipo_listar (service_role): admins first, only staff, with the auth email'
);
-- 59c
select is(
  public.usuario_id_por_email('  EMPLEADO@Roles.test '),
  'e3000000-0000-4000-8000-0000000000e1'::uuid,
  'usuario_id_por_email (service_role) matches case-insensitively and trimmed'
);

-- ----------------------------------------------------------------------------
-- Schema checks (as postgres).
-- ----------------------------------------------------------------------------
reset role;

-- 59d
select is_empty(
  $$ select r.rol, f.fn
       from (values ('anon'), ('authenticated')) r(rol),
            (values ('public.equipo_listar()'), ('public.usuario_id_por_email(text)')) f(fn)
      where has_function_privilege(r.rol, f.fn, 'EXECUTE') $$,
  'equipo_listar / usuario_id_por_email are not callable from the API'
);

-- 60
select policies_are(
  'public', 'pedidos',
  array['pedidos select propio o staff', 'pedidos update staff', 'pedidos delete admin'],
  'pedidos policies: select/update for staff, hard delete for admin'
);
-- 61
select has_trigger(
  'public', 'pedidos', 'pedidos_limitar_empleado',
  'trigger pedidos_limitar_empleado exists'
);
-- 62
select is(
  (select prosecdef from pg_proc where oid = to_regprocedure('public.pedidos_limitar_empleado()')),
  false,
  'pedidos_limitar_empleado() is SECURITY INVOKER (current_user is the writer)'
);

select * from finish();

rollback;
