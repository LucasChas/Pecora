-- ============================================================================
-- pgTAP tests for migration 20261005010000_compra_invitada.sql
-- ============================================================================

begin;

select plan(11);

insert into public.categorias (id, nombre) values ('c2c00000-0000-4000-8000-000000000001', 'Cat inv');
insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('c2b00000-0000-4000-8000-000000000001', 'Body invitada', 'c2c00000-0000-4000-8000-000000000001', 1000, 50);

create function pg_temp.pedir(p_email text, p_tel text default '3515550000', p_cupon text default null)
returns bigint language sql as $$
  select public.crear_pedido(
    'Invitada', p_tel, p_email, 'coordinar', null, null, null, null,
    '[{"id":"c2b00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0,
    'checkout', null, null, p_cupon, null)
$$;
-- Desde 20261008120000_proteger_compra_invitada, sin sesión la llama la
-- Edge Function crear-pedido-invitada con la service_role.
grant execute on function pg_temp.pedir(text, text, text) to service_role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- 1
select lives_ok($$ select pg_temp.pedir('  Ana@Invitada.test ') $$, 'a guest can place an order with an email');
-- 2
select throws_ok($$ select pg_temp.pedir(null) $$, 'P0001',
  'Ingresá un email válido: ahí te mandamos el comprobante del pedido.', 'a guest order needs an email');
-- 3
select throws_ok($$ select pg_temp.pedir('no-es-un-mail') $$, 'P0001', null, 'the email must look valid');
-- 4
select throws_ok($$ select pg_temp.pedir('ana@invitada.test', '3515550000', 'PROMO') $$, 'P0001',
  'Para usar un cupón, iniciá sesión o creá tu cuenta.', 'guests cannot use coupons');

reset role;
-- 5
select is(
  (select user_id from public.pedidos where email = 'Ana@Invitada.test'),
  null,
  'the guest order has no account'
);
-- 6
select is(
  (select stock from public.productos where id = 'c2b00000-0000-4000-8000-000000000001'),
  49,
  'and it reserves stock like any order'
);

set local role service_role;
-- 7
select lives_ok($$ select pg_temp.pedir('ana@invitada.test'); select pg_temp.pedir('ANA@invitada.test') $$,
  'up to 3 orders in 10 minutes with the same email');
-- 8
select throws_ok($$ select pg_temp.pedir('ana@invitada.test', '1111111111') $$, 'P0001',
  'Hiciste muchos pedidos seguidos. Esperá un rato o escribinos por WhatsApp.',
  'a fourth order with the same email is rejected');
-- 9
select throws_ok($$ select pg_temp.pedir('otra@invitada.test', '351-555-0000') $$, 'P0001',
  'Hiciste muchos pedidos seguidos. Esperá un rato o escribinos por WhatsApp.',
  'the same phone with another email counts too');
reset role;

-- Mis pedidos: la cuenta con ese email confirmado ve los pedidos de invitada.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, email_confirmed_at)
values ('c2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ana@invitada.test', '{}', '{}', now(), now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'c2000000-0000-4000-8000-000000000001';
-- 10
select is((select count(*)::int from public.mis_pedidos()), 3,
  'an account with the same confirmed email sees the guest orders');
reset role;
-- 11
select ok(public.compra_verificada('c2000000-0000-4000-8000-000000000001', 'c2b00000-0000-4000-8000-000000000001'),
  'and can review those products');

select * from finish();

rollback;
