-- ============================================================================
-- pgTAP tests for migration *_reenviar_emails_pedido.sql
--   * public.invocar_email_pedido(uuid): shared pg_net call (Vault URL/token),
--     not executable by anon/authenticated.
--   * public.pedido_creado_email(): the AFTER INSERT trigger still enqueues one
--     request per new order, does nothing without the Vault secrets, and never
--     blocks the insert.
--   * public.reenviar_emails_pedido(uuid): admin-only RPC that re-enqueues the
--     request (42501 for everyone else).
--
-- Run locally with:  supabase db start && supabase test db
--
-- Everything runs inside one transaction that is rolled back at the end, so the
-- pg_net requests enqueued here are never sent (the worker only sees committed
-- rows). The Vault secrets are created inside the same transaction and point to
-- a closed local port.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(30);

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres): one customer, one admin, Vault secrets, two orders.
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'uno@reenvio.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Uno"}', now(), now()),
  ('a2000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@reenvio.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

update public.profiles set rol = 'admin' where id = 'a2000000-0000-4000-8000-0000000000ad';

-- A local stack has no secrets; replace them if a developer loaded real ones.
delete from vault.secrets
 where name in ('pecora_email_function_url', 'pecora_email_function_token');
select vault.create_secret(
  'http://127.0.0.1:9/functions/v1/enviar-recibo-pedido', 'pecora_email_function_url');
select vault.create_secret('test-service-role-token', 'pecora_email_function_token');

-- ----------------------------------------------------------------------------
-- Definition and privileges.
-- ----------------------------------------------------------------------------
-- 1
select has_function('public', 'reenviar_emails_pedido', array['uuid'],
  'reenviar_emails_pedido(uuid) exists');
-- 2
select function_returns('public', 'reenviar_emails_pedido', array['uuid'], 'bigint',
  'reenviar_emails_pedido returns bigint (the pg_net request id)');
-- 3
select is_definer('public', 'reenviar_emails_pedido', array['uuid'],
  'reenviar_emails_pedido is SECURITY DEFINER');
-- 4
select is(
  (select 'search_path=public' = any (p.proconfig)
     from pg_proc p
    where p.oid = to_regprocedure('public.reenviar_emails_pedido(uuid)')),
  true,
  'reenviar_emails_pedido pins search_path = public'
);
-- 5
select is(
  has_function_privilege('anon', 'public.reenviar_emails_pedido(uuid)', 'EXECUTE'),
  false,
  'anon cannot execute reenviar_emails_pedido'
);
-- 6
select is(
  has_function_privilege('authenticated', 'public.reenviar_emails_pedido(uuid)', 'EXECUTE'),
  true,
  'authenticated can execute reenviar_emails_pedido (the admin check is inside)'
);
-- 7 (a NULL proacl means the default: EXECUTE for PUBLIC)
select is(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p
    where p.oid = to_regprocedure('public.reenviar_emails_pedido(uuid)')),
  true,
  'PUBLIC has no EXECUTE on reenviar_emails_pedido'
);
-- 8
select has_function('public', 'invocar_email_pedido', array['uuid'],
  'invocar_email_pedido(uuid) exists');
-- 9
select is(
  has_function_privilege('anon', 'public.invocar_email_pedido(uuid)', 'EXECUTE'),
  false,
  'anon cannot execute invocar_email_pedido'
);
-- 10
select is(
  has_function_privilege('authenticated', 'public.invocar_email_pedido(uuid)', 'EXECUTE'),
  false,
  'authenticated cannot execute invocar_email_pedido'
);
-- 11
select is(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p
    where p.oid = to_regprocedure('public.invocar_email_pedido(uuid)')),
  true,
  'PUBLIC has no EXECUTE on invocar_email_pedido'
);
-- 12
select trigger_is('public', 'pedidos', 'pedido_creado_email', 'public', 'pedido_creado_email',
  'pedidos still has the pedido_creado_email trigger');

-- ----------------------------------------------------------------------------
-- Trigger (as postgres): a new order enqueues exactly one request.
-- ----------------------------------------------------------------------------
-- 13
select lives_ok(
  $$ insert into public.pedidos (id, user_id, nombre, telefono, email, items, subtotal, origen)
     values ('d2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
             'Uno', '111', 'uno@reenvio.test',
             '[{"id":"b2000000-0000-4000-8000-00000000000a","nombre":"Body","precio":1000,"cantidad":1}]',
             1000, 'checkout') $$,
  'a web order is inserted'
);
-- 14
select results_eq(
  $$ select q.method::text, q.url, q.headers ->> 'Authorization', q.headers ->> 'Content-Type'
       from net.http_request_queue q
      where convert_from(q.body, 'utf8')::jsonb ->> 'pedido_id'
            = 'd2000000-0000-4000-8000-000000000001' $$,
  $$ values ('POST'::text,
             'http://127.0.0.1:9/functions/v1/enviar-recibo-pedido'::text,
             'Bearer test-service-role-token'::text,
             'application/json'::text) $$,
  'the trigger enqueues one POST to the Vault URL with the Vault token as Bearer'
);

-- A manual order (the Edge Function skips it; the trigger still calls it).
insert into public.pedidos (id, user_id, nombre, telefono, items, subtotal, origen)
values ('d2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-0000000000ad',
        'Por WhatsApp', '555',
        '[{"id":"b2000000-0000-4000-8000-00000000000a","nombre":"Body","precio":1000,"cantidad":1}]',
        1000, 'admin');

-- ----------------------------------------------------------------------------
-- As a customer.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';

-- 15
select throws_ok(
  $$ select public.reenviar_emails_pedido('d2000000-0000-4000-8000-000000000001') $$,
  '42501',
  'Solo la administradora puede reenviar los mails de un pedido.',
  'a customer cannot resend the mails, not even of her own order'
);
-- 16
select throws_ok(
  $$ select public.invocar_email_pedido('d2000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'a customer cannot call invocar_email_pedido directly'
);

-- ----------------------------------------------------------------------------
-- As anon.
-- ----------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 17
select throws_ok(
  $$ select public.reenviar_emails_pedido('d2000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'anon cannot execute reenviar_emails_pedido'
);

-- ----------------------------------------------------------------------------
-- As admin.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-0000000000ad';

-- 18: keep the returned id to find the queued request afterwards.
select lives_ok(
  $$ select set_config('pecora_test.request_id',
       public.reenviar_emails_pedido('d2000000-0000-4000-8000-000000000001')::text, true) $$,
  'the admin can resend the mails of a web order'
);
-- 19
select isnt(
  nullif(current_setting('pecora_test.request_id', true), ''),
  null,
  'reenviar_emails_pedido returns the pg_net request id'
);
-- 20
select throws_ok(
  $$ select public.invocar_email_pedido('d2000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'not even the admin can call invocar_email_pedido directly'
);
-- 21
select throws_ok(
  $$ select public.reenviar_emails_pedido('d2000000-0000-4000-8000-000000000002') $$,
  'P0001',
  'Los pedidos cargados a mano no mandan mails.',
  'manual orders cannot be resent (the Edge Function would skip them)'
);
-- 22
select throws_ok(
  $$ select public.reenviar_emails_pedido('d2000000-0000-4000-8000-0000000000ff') $$,
  'P0002',
  'El pedido no existe.',
  'an unknown order raises no_data_found'
);

-- ----------------------------------------------------------------------------
-- Back as postgres: check what the resend enqueued.
-- ----------------------------------------------------------------------------
reset role;

-- 23
select results_eq(
  $$ select q.method::text, q.url, q.headers ->> 'Authorization',
            convert_from(q.body, 'utf8')::jsonb ->> 'pedido_id'
       from net.http_request_queue q
      where q.id = current_setting('pecora_test.request_id')::bigint $$,
  $$ values ('POST'::text,
             'http://127.0.0.1:9/functions/v1/enviar-recibo-pedido'::text,
             'Bearer test-service-role-token'::text,
             'd2000000-0000-4000-8000-000000000001'::text) $$,
  'the resend enqueues the same request as the trigger'
);
-- 24
select is(
  (select count(*)::int from net.http_request_queue q
    where convert_from(q.body, 'utf8')::jsonb ->> 'pedido_id'
          = 'd2000000-0000-4000-8000-000000000001'),
  2,
  'one request from the trigger plus one from the resend'
);

-- ----------------------------------------------------------------------------
-- Without the Vault secrets.
-- ----------------------------------------------------------------------------
delete from vault.secrets
 where name in ('pecora_email_function_url', 'pecora_email_function_token');

-- 25
select is(
  public.invocar_email_pedido('d2000000-0000-4000-8000-000000000001'),
  null,
  'invocar_email_pedido returns null when Vault has no secrets'
);
-- 26
select lives_ok(
  $$ insert into public.pedidos (id, user_id, nombre, telefono, items, subtotal, origen)
     values ('d2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001',
             'Uno', '111',
             '[{"id":"b2000000-0000-4000-8000-00000000000a","nombre":"Body","precio":1000,"cantidad":1}]',
             1000, 'checkout') $$,
  'without the secrets a new order is still inserted'
);
-- 27
select is_empty(
  $$ select 1 from net.http_request_queue q
      where convert_from(q.body, 'utf8')::jsonb ->> 'pedido_id'
            = 'd2000000-0000-4000-8000-000000000003' $$,
  'without the secrets the trigger enqueues nothing'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a2000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-0000000000ad';

-- 28
select throws_ok(
  $$ select public.reenviar_emails_pedido('d2000000-0000-4000-8000-000000000003') $$,
  'P0001',
  'El envío de mails no está configurado: faltan la URL o el token de la función en Vault.',
  'the admin gets a clear error when Vault has no secrets'
);

-- ----------------------------------------------------------------------------
-- A failure inside the call never blocks the insert.
-- ----------------------------------------------------------------------------
reset role;

-- Stand-in that always fails (Vault/pg_net down). Rolled back with the rest.
create or replace function public.invocar_email_pedido(p_pedido_id uuid)
returns bigint language plpgsql as $$
begin
  raise exception 'pg_net unavailable (test)';
end;
$$;

-- 29
select lives_ok(
  $$ insert into public.pedidos (id, user_id, nombre, telefono, items, subtotal, origen)
     values ('d2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001',
             'Uno', '111',
             '[{"id":"b2000000-0000-4000-8000-00000000000a","nombre":"Body","precio":1000,"cantidad":1}]',
             1000, 'checkout') $$,
  'an error in the pg_net call does not block the insert'
);
-- 30
select is(
  (select count(*)::int from public.pedidos
    where id = 'd2000000-0000-4000-8000-000000000004'),
  1,
  'the order is saved'
);

select * from finish();

rollback;
