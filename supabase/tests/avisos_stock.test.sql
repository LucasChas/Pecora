-- ============================================================================
-- pgTAP tests for migration *_avisos_stock.sql ("Avisame cuando vuelva")
--   * public.avisos_stock: RLS (own rows only), no direct insert/update.
--   * suscribir_aviso_stock / cancelar_aviso_stock: login required, only for
--     out-of-stock products, idempotent, email taken from auth.users.
--   * baja_aviso_stock: public unsubscribe by token.
--   * productos_aviso_reposicion trigger: 0 -> >0 enqueues one pg_net call
--     (only with pending subscriptions) and never blocks the update.
--   * Reservations (reservado_at): aviso_stock_pendiente, avisos_stock_pendientes
--     and reservar_aviso_stock share one rule; a reservation older than 15
--     minutes (crashed invocation) is pending again, a fresh one is not.
--
-- Run locally with:  supabase db start && supabase test db --local
--
-- Everything runs inside one transaction that is rolled back at the end, so the
-- pg_net requests enqueued here are never sent. The Vault secrets are created
-- inside the same transaction and point to a closed local port.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(58);

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres): two customers, three products, Vault secrets.
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@avisos.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Ana"}', now(), now()),
  ('a3000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bea@avisos.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Bea"}', now(), now()),
  ('a3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cora@avisos.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Cora"}', now(), now()),
  ('a3000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dora@avisos.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Dora"}', now(), now());

insert into public.productos (id, nombre, precio, stock) values
  ('b3000000-0000-4000-8000-000000000001', 'Body agotado', 1000, 0),
  ('b3000000-0000-4000-8000-000000000002', 'Body con stock', 1000, 4),
  ('b3000000-0000-4000-8000-000000000003', 'Body sin interesadas', 1000, 0);

delete from vault.secrets
 where name in ('pecora_email_function_url', 'pecora_email_function_token',
                'pecora_avisos_function_url');
select vault.create_secret(
  'http://127.0.0.1:9/functions/v1/enviar-recibo-pedido', 'pecora_email_function_url');
select vault.create_secret('test-service-role-token', 'pecora_email_function_token');

-- ----------------------------------------------------------------------------
-- Definition and privileges.
-- ----------------------------------------------------------------------------
-- 1
select has_table('public', 'avisos_stock', 'avisos_stock exists');
-- 2
select is(
  (select relrowsecurity from pg_class where oid = 'public.avisos_stock'::regclass),
  true, 'avisos_stock has RLS enabled');
-- 3
select is(has_table_privilege('anon', 'public.avisos_stock', 'SELECT'), false,
  'anon cannot read avisos_stock');
-- 4
select is(has_table_privilege('authenticated', 'public.avisos_stock', 'SELECT'), true,
  'authenticated can read avisos_stock (RLS: own rows)');
-- 5
select is(has_table_privilege('authenticated', 'public.avisos_stock', 'INSERT'), false,
  'authenticated cannot insert directly (only through the RPC)');
-- 6
select is(has_table_privilege('authenticated', 'public.avisos_stock', 'UPDATE'), false,
  'authenticated cannot update (notificado_at is server-side only)');
-- 7
select is_definer('public', 'suscribir_aviso_stock', array['uuid'],
  'suscribir_aviso_stock is SECURITY DEFINER');
-- 8
select function_returns('public', 'suscribir_aviso_stock', array['uuid'], 'text',
  'suscribir_aviso_stock returns the email');
-- 9
select is(has_function_privilege('anon', 'public.suscribir_aviso_stock(uuid)', 'EXECUTE'), false,
  'anon cannot execute suscribir_aviso_stock');
-- 10
select is(has_function_privilege('authenticated', 'public.suscribir_aviso_stock(uuid)', 'EXECUTE'), true,
  'authenticated can execute suscribir_aviso_stock');
-- 11
select is(has_function_privilege('anon', 'public.cancelar_aviso_stock(uuid)', 'EXECUTE'), false,
  'anon cannot execute cancelar_aviso_stock');
-- 12
select is(has_function_privilege('anon', 'public.baja_aviso_stock(uuid)', 'EXECUTE'), true,
  'anon can execute baja_aviso_stock (link in the email)');
-- 13
select is(has_function_privilege('authenticated', 'public.invocar_aviso_stock(uuid)', 'EXECUTE'), false,
  'authenticated cannot execute invocar_aviso_stock');
-- 14
select is(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p
    where p.oid = to_regprocedure('public.invocar_aviso_stock(uuid)')),
  true,
  'PUBLIC has no EXECUTE on invocar_aviso_stock');
-- 15
select trigger_is('public', 'productos', 'productos_aviso_reposicion',
  'public', 'producto_repuesto_aviso', 'productos has the restock trigger');

-- ----------------------------------------------------------------------------
-- As anon.
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 16
select throws_ok(
  $$ select public.suscribir_aviso_stock('b3000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot subscribe');

-- ----------------------------------------------------------------------------
-- As customer Ana.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a3000000-0000-4000-8000-000000000001';

-- 17
select is(
  public.suscribir_aviso_stock('b3000000-0000-4000-8000-000000000001'),
  'ana@avisos.test',
  'a customer subscribes to an out-of-stock product and gets her account email');
-- 18
select is(
  public.suscribir_aviso_stock('b3000000-0000-4000-8000-000000000001'),
  'ana@avisos.test',
  'subscribing twice is idempotent');
-- 19
select is(
  (select count(*)::int from public.avisos_stock
    where producto_id = 'b3000000-0000-4000-8000-000000000001'),
  1, 'only one pending subscription per product and account');
-- 20
select throws_ok(
  $$ select public.suscribir_aviso_stock('b3000000-0000-4000-8000-000000000002') $$,
  'P0001', 'Este producto ya tiene stock: lo podés comprar ahora.',
  'cannot subscribe to a product that has stock');
-- 21
select throws_ok(
  $$ select public.suscribir_aviso_stock('b3000000-0000-4000-8000-0000000000ff') $$,
  'P0002', 'El producto no existe.', 'unknown product raises no_data_found');
-- 22
select throws_ok(
  $$ insert into public.avisos_stock (producto_id, user_id, email)
     values ('b3000000-0000-4000-8000-000000000003',
             'a3000000-0000-4000-8000-000000000001', 'otra@ajena.test') $$,
  '42501', null, 'a customer cannot insert rows with an arbitrary email');
-- 23
select throws_ok(
  $$ update public.avisos_stock set notificado_at = now() $$,
  '42501', null, 'a customer cannot stamp notificado_at');
-- 24
select is(public.cancelar_aviso_stock('b3000000-0000-4000-8000-000000000001'), true,
  'cancelar_aviso_stock returns true when there was a pending alert');
-- 25
select is(public.cancelar_aviso_stock('b3000000-0000-4000-8000-000000000001'), false,
  'cancelar_aviso_stock returns false when there is nothing to cancel');
-- 26
select is(
  public.suscribir_aviso_stock('b3000000-0000-4000-8000-000000000001'),
  'ana@avisos.test', 'she subscribes again');

-- ----------------------------------------------------------------------------
-- As customer Bea: cannot see or delete Ana's rows.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'a3000000-0000-4000-8000-000000000002';

-- 27
select is_empty($$ select 1 from public.avisos_stock $$,
  'another customer does not see foreign subscriptions');

delete from public.avisos_stock;  -- RLS: affects 0 rows.

-- 28
select is(
  public.suscribir_aviso_stock('b3000000-0000-4000-8000-000000000001'),
  'bea@avisos.test', 'a second customer subscribes to the same product');

-- ----------------------------------------------------------------------------
-- Back as postgres: data and the restock trigger.
-- ----------------------------------------------------------------------------
reset role;

-- 29
select is(
  (select count(*)::int from public.avisos_stock
    where producto_id = 'b3000000-0000-4000-8000-000000000001' and notificado_at is null),
  2, 'the foreign delete did nothing: two pending subscriptions');
-- 30
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'producto_id'
          = 'b3000000-0000-4000-8000-000000000001'),
  0, 'nothing is enqueued while the product has no stock');

-- 31
select lives_ok(
  $$ update public.productos set stock = 5 where id = 'b3000000-0000-4000-8000-000000000001' $$,
  'restocking the product works');
-- 32
select results_eq(
  $$ select q.method::text, q.url, q.headers ->> 'Authorization'
       from net.http_request_queue q
      where convert_from(q.body, 'utf8')::jsonb ->> 'producto_id'
            = 'b3000000-0000-4000-8000-000000000001' $$,
  $$ values ('POST'::text,
             'http://127.0.0.1:9/functions/v1/avisar-reposicion'::text,
             'Bearer test-service-role-token'::text) $$,
  '0 -> 5 enqueues ONE call to the URL derived from the email function URL');

update public.productos set stock = 3 where id = 'b3000000-0000-4000-8000-000000000001';
-- 33
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'producto_id'
          = 'b3000000-0000-4000-8000-000000000001'),
  1, '5 -> 3 does not enqueue another call');

update public.productos set stock = 2 where id = 'b3000000-0000-4000-8000-000000000003';
-- 34
select is_empty(
  $$ select 1 from net.http_request_queue q
      where convert_from(q.body, 'utf8')::jsonb ->> 'producto_id'
            = 'b3000000-0000-4000-8000-000000000003' $$,
  'a restock without pending subscriptions enqueues nothing');

-- The Edge Function stamps the rows; a later flap does not call it again.
update public.avisos_stock set notificado_at = now()
 where producto_id = 'b3000000-0000-4000-8000-000000000001';
update public.productos set stock = 0 where id = 'b3000000-0000-4000-8000-000000000001';
update public.productos set stock = 1 where id = 'b3000000-0000-4000-8000-000000000001';
-- 35
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'producto_id'
          = 'b3000000-0000-4000-8000-000000000001'),
  1, 'a 0 -> >0 flap with only notified rows enqueues nothing');

-- A dedicated URL secret wins over the derived one.
select vault.create_secret('http://127.0.0.1:9/custom/avisos', 'pecora_avisos_function_url');
update public.productos set stock = 0 where id = 'b3000000-0000-4000-8000-000000000003';
insert into public.avisos_stock (producto_id, user_id, email)
values ('b3000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000002',
        'bea@avisos.test');
update public.productos set stock = 1 where id = 'b3000000-0000-4000-8000-000000000003';
-- 36
select results_eq(
  $$ select q.url from net.http_request_queue q
      where convert_from(q.body, 'utf8')::jsonb ->> 'producto_id'
            = 'b3000000-0000-4000-8000-000000000003' $$,
  $$ values ('http://127.0.0.1:9/custom/avisos'::text) $$,
  'pecora_avisos_function_url is used when present');

-- ----------------------------------------------------------------------------
-- Reservations (what the Edge Function uses). Product 2 (has stock) with:
--   c4..01 Cora  pending, never reserved
--   c4..02 Bea   reserved 16 minutes ago (the invocation crashed) -> pending
--   c4..03 Dora  reserved 1 minute ago (being sent)               -> not pending
--   c4..04 Cora  already notified                                 -> not pending
-- ----------------------------------------------------------------------------
insert into public.avisos_stock (id, producto_id, user_id, email, reservado_at, notificado_at)
values
  ('c4000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002',
   'a3000000-0000-4000-8000-000000000003', 'cora@avisos.test', null, null),
  ('c4000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002',
   'a3000000-0000-4000-8000-000000000002', 'bea@avisos.test', now() - interval '16 minutes', null),
  ('c4000000-0000-4000-8000-000000000003', 'b3000000-0000-4000-8000-000000000002',
   'a3000000-0000-4000-8000-000000000004', 'dora@avisos.test', now() - interval '1 minute', null),
  ('c4000000-0000-4000-8000-000000000004', 'b3000000-0000-4000-8000-000000000002',
   'a3000000-0000-4000-8000-000000000003', 'cora@avisos.test', now() - interval '1 hour',
   now() - interval '1 hour');

-- 36a
select has_column('public', 'avisos_stock', 'reservado_at', 'avisos_stock has reservado_at');
-- 36b
select is(
  array[public.aviso_stock_pendiente(null, null),
        public.aviso_stock_pendiente(null, now() - interval '16 minutes'),
        public.aviso_stock_pendiente(null, now() - interval '14 minutes'),
        public.aviso_stock_pendiente(now(), null),
        public.aviso_stock_pendiente(now(), now() - interval '1 hour')],
  array[true, true, false, false, false],
  'pending = not notified and (never reserved or reserved more than 15 minutes ago)');
-- 36c
select results_eq(
  $$ select id from public.avisos_stock_pendientes('b3000000-0000-4000-8000-000000000002') $$,
  $$ values ('c4000000-0000-4000-8000-000000000001'::uuid),
            ('c4000000-0000-4000-8000-000000000002'::uuid) $$,
  'avisos_stock_pendientes: the stale reservation is pending again, the fresh one is not');
-- 36d
select results_eq(
  $$ select id from public.avisos_stock_pendientes(
       'b3000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000001', 200) $$,
  $$ values ('c4000000-0000-4000-8000-000000000002'::uuid) $$,
  'avisos_stock_pendientes pages by id (p_desde_id)');
-- 36e
select is(public.reservar_aviso_stock('c4000000-0000-4000-8000-000000000003'), false,
  'a fresh reservation cannot be taken by another invocation');
-- 36f
select is(public.reservar_aviso_stock('c4000000-0000-4000-8000-000000000002'), true,
  'a stale reservation can be taken again');
-- 36g
select is(public.reservar_aviso_stock('c4000000-0000-4000-8000-000000000002'), false,
  'once re-reserved it is not pending (no double send)');
-- 36h
select is(public.reservar_aviso_stock('c4000000-0000-4000-8000-000000000004'), false,
  'a notified row cannot be reserved');
-- 36i
select results_eq(
  $$ select id from public.avisos_stock_pendientes('b3000000-0000-4000-8000-000000000002') $$,
  $$ values ('c4000000-0000-4000-8000-000000000001'::uuid) $$,
  'after the re-reservation only the never-reserved row is pending');

-- Trigger: only fresh reservations left -> a restock does not call the function.
select public.reservar_aviso_stock('c4000000-0000-4000-8000-000000000001');
update public.productos set stock = 0 where id = 'b3000000-0000-4000-8000-000000000002';
update public.productos set stock = 1 where id = 'b3000000-0000-4000-8000-000000000002';
-- 36j
select is_empty(
  $$ select 1 from net.http_request_queue q
      where convert_from(q.body, 'utf8')::jsonb ->> 'producto_id'
            = 'b3000000-0000-4000-8000-000000000002' $$,
  'a restock with only fresh reservations enqueues nothing');

-- One reservation goes stale: the next restock retries it.
update public.avisos_stock set reservado_at = now() - interval '20 minutes'
 where id = 'c4000000-0000-4000-8000-000000000003';
update public.productos set stock = 0 where id = 'b3000000-0000-4000-8000-000000000002';
update public.productos set stock = 2 where id = 'b3000000-0000-4000-8000-000000000002';
-- 36k
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'producto_id'
          = 'b3000000-0000-4000-8000-000000000002'),
  1, 'a restock with a stale reservation enqueues the call (retry)');
-- 36l
select results_eq(
  $$ select r.rol::text, f.fn::text, has_function_privilege(r.rol, f.fn, 'EXECUTE')
       from (values ('anon'), ('authenticated'), ('service_role')) r(rol),
            (values ('public.reservar_aviso_stock(uuid)'),
                    ('public.avisos_stock_pendientes(uuid, uuid, integer)')) f(fn)
      order by 1, 2 $$,
  $$ values ('anon'::text, 'public.avisos_stock_pendientes(uuid, uuid, integer)'::text, false),
            ('anon', 'public.reservar_aviso_stock(uuid)', false),
            ('authenticated', 'public.avisos_stock_pendientes(uuid, uuid, integer)', false),
            ('authenticated', 'public.reservar_aviso_stock(uuid)', false),
            ('service_role', 'public.avisos_stock_pendientes(uuid, uuid, integer)', true),
            ('service_role', 'public.reservar_aviso_stock(uuid)', true) $$,
  'only service_role can list pending alerts and reserve them');

-- ----------------------------------------------------------------------------
-- Without secrets, and with a failing call: the update never breaks.
-- ----------------------------------------------------------------------------
delete from vault.secrets
 where name in ('pecora_email_function_url', 'pecora_email_function_token',
                'pecora_avisos_function_url');
update public.productos set stock = 0 where id = 'b3000000-0000-4000-8000-000000000003';
-- 37
select is(public.invocar_aviso_stock('b3000000-0000-4000-8000-000000000003'), null,
  'invocar_aviso_stock returns null without Vault secrets');
-- 38
select lives_ok(
  $$ update public.productos set stock = 2 where id = 'b3000000-0000-4000-8000-000000000003' $$,
  'without secrets the restock still works');
-- 39
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'producto_id'
          = 'b3000000-0000-4000-8000-000000000003'),
  1, 'without secrets nothing new is enqueued');

create or replace function public.invocar_aviso_stock(p_producto_id uuid)
returns bigint language plpgsql as $$
begin
  raise exception 'pg_net unavailable (test)';
end;
$$;
update public.productos set stock = 0 where id = 'b3000000-0000-4000-8000-000000000003';
-- 40
select lives_ok(
  $$ update public.productos set stock = 7 where id = 'b3000000-0000-4000-8000-000000000003' $$,
  'an error in the pg_net call does not block the update');
-- 41
select is(
  (select stock from public.productos where id = 'b3000000-0000-4000-8000-000000000003'),
  7, 'the new stock is saved');

-- ----------------------------------------------------------------------------
-- Unsubscribe by token (as anon).
-- ----------------------------------------------------------------------------
-- Ana: one notified row (product 1) and one pending (product 3) to unsubscribe.
update public.productos set stock = 0 where id = 'b3000000-0000-4000-8000-000000000003';
insert into public.avisos_stock (producto_id, user_id, email)
values ('b3000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000001',
        'ana@avisos.test');
select set_config('pecora_test.token',
  (select token::text from public.avisos_stock
    where user_id = 'a3000000-0000-4000-8000-000000000001'
      and producto_id = 'b3000000-0000-4000-8000-000000000001'), true);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 42
select is(public.baja_aviso_stock(current_setting('pecora_test.token')::uuid), true,
  'baja_aviso_stock with a valid token returns true');
-- 43
select is(public.baja_aviso_stock('c3000000-0000-4000-8000-000000000000'), false,
  'an unknown token returns false');
-- 44
select is(public.baja_aviso_stock(null), false, 'a null token returns false');

reset role;
-- 45
select is(
  (select count(*)::int from public.avisos_stock
    where user_id = 'a3000000-0000-4000-8000-000000000001'),
  0, 'the unsubscribe removes that row and every pending alert of the account');

-- ----------------------------------------------------------------------------
-- Deleting a product removes its subscriptions.
-- ----------------------------------------------------------------------------
delete from public.productos where id = 'b3000000-0000-4000-8000-000000000003';
-- 46
select is_empty(
  $$ select 1 from public.avisos_stock
      where producto_id = 'b3000000-0000-4000-8000-000000000003' $$,
  'ON DELETE CASCADE removes the subscriptions of a deleted product');

select * from finish();

rollback;
