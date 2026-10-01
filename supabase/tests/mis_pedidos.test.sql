-- ============================================================================
-- pgTAP tests for migration 20261001080000_mis_pedidos.sql
--   * mis_pedidos(): own checkout orders + manual orders with the account's
--     CONFIRMED email; never other accounts' orders; staff do not see their
--     own manual loads; p_numero filters; anon cannot call it
--   * compra_verificada needs a confirmed email for manual orders
-- ============================================================================

begin;

select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b9000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@mp.test', now(), '{}', '{"nombre":"Ana"}', now(), now()),
  ('b9000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sinconfirmar@mp.test', null, '{}', '{"nombre":"Sin"}', now(), now()),
  ('b9000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@mp.test', now(), '{}', '{"nombre":"Admin"}', now(), now());
update public.profiles set rol = 'admin' where id = 'b9000000-0000-4000-8000-0000000000ad';

insert into public.categorias (id, nombre) values ('b9c00000-0000-4000-8000-000000000001', 'Cat mp');
insert into public.productos (id, nombre, categoria_id, precio, stock)
values ('b9b00000-0000-4000-8000-000000000001', 'Body mp', 'b9c00000-0000-4000-8000-000000000001', 100, 50);

create temp table n (cual text, numero bigint) on commit drop;
grant all on n to authenticated;

-- Ana compra por la web.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b9000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'b9000000-0000-4000-8000-000000000001';
insert into n values ('web', public.crear_pedido('Ana', '3515551234', null, 'coordinar', null, null, null, null,
  '[{"id":"b9b00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0, 'checkout'));

-- La admin carga ventas de WhatsApp: una con el email de Ana, una con el de
-- la cuenta sin confirmar y una con otro email.
set local request.jwt.claims = '{"sub":"b9000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'b9000000-0000-4000-8000-0000000000ad';
insert into n values
  ('manual_ana', public.crear_pedido('Ana', '3515551234', ' ANA@mp.test ', 'coordinar', null, null, null, null,
     '[{"id":"b9b00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0, 'admin')),
  ('manual_sin', public.crear_pedido('Sin', '3515551234', 'sinconfirmar@mp.test', 'coordinar', null, null, null, null,
     '[{"id":"b9b00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0, 'admin')),
  ('manual_otra', public.crear_pedido('Otra', '3515551234', 'otra@mp.test', 'coordinar', null, null, null, null,
     '[{"id":"b9b00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0, 'admin'));

-- 1
select is((select count(*)::int from public.mis_pedidos()), 0, 'staff do not see their manual loads as their orders');

set local request.jwt.claims = '{"sub":"b9000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'b9000000-0000-4000-8000-000000000001';
-- 2
select set_eq(
  $$ select numero from public.mis_pedidos() $$,
  $$ select numero from n where cual in ('web', 'manual_ana') $$,
  'Ana sees her web order and the manual order with her email'
);
-- 3
select is(
  (select origen from public.mis_pedidos((select numero::int from n where cual = 'manual_ana'))),
  'admin',
  'p_numero returns only that order'
);
-- 4
select is(
  (select count(*)::int from public.mis_pedidos((select numero::int from n where cual = 'manual_otra'))),
  0,
  'an order with another email is not returned, even asking by number'
);
-- 5
select ok(
  public.puede_resenar('b9b00000-0000-4000-8000-000000000001'),
  'Ana can review (web purchase)'
);

-- Cuenta con el email sin confirmar.
set local request.jwt.claims = '{"sub":"b9000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'b9000000-0000-4000-8000-000000000002';
-- 6
select is((select count(*)::int from public.mis_pedidos()), 0, 'an unconfirmed email does not get manual orders');
-- 7
select ok(
  not public.puede_resenar('b9b00000-0000-4000-8000-000000000001'),
  'an unconfirmed email cannot review through a manual order'
);

reset role;
update auth.users set email_confirmed_at = now() where id = 'b9000000-0000-4000-8000-000000000002';
set local role authenticated;
-- 8
select is((select count(*)::int from public.mis_pedidos()), 1, 'after confirming the email, the manual order shows up');

reset role;
set local role anon;
-- 9
select throws_ok($$ select * from public.mis_pedidos() $$, '42501', null, 'anon cannot call mis_pedidos');

select * from finish();

rollback;
