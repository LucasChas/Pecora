-- ============================================================================
-- pgTAP tests for migration 20261001060000_resenas_compras_manuales.sql
--   * a manual order with the account email counts as a verified purchase
--   * case and surrounding spaces in the typed email do not matter
--   * a manual order with another email, without email, cancelled or in the
--     trash does not count
--   * the staff account that loaded the manual order does not get to review
--
-- Everything runs inside one transaction that is rolled back at the end.
-- ============================================================================

begin;

select plan(8);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b7000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@manual.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Ana"}', now(), now()),
  ('b7000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'otra@manual.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Otra"}', now(), now()),
  ('b7000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@manual.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());
update public.profiles set rol = 'admin' where id = 'b7000000-0000-4000-8000-0000000000ad';

insert into public.categorias (id, nombre) values ('b7c00000-0000-4000-8000-000000000001', 'Cat manual');
insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('b7b00000-0000-4000-8000-000000000001', 'Body', 'b7c00000-0000-4000-8000-000000000001', 100, 50),
  ('b7b00000-0000-4000-8000-000000000002', 'Gorro', 'b7c00000-0000-4000-8000-000000000001', 100, 50),
  ('b7b00000-0000-4000-8000-000000000003', 'Medias', 'b7c00000-0000-4000-8000-000000000001', 100, 50);

-- La admin carga ventas de WhatsApp.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'b7000000-0000-4000-8000-0000000000ad';

create temp table manual (n int, numero bigint) on commit drop;
grant all on manual to authenticated;
insert into manual values
  (1, public.crear_pedido('Ana', '3515551234', '  ANA@Manual.test ', 'coordinar', null, null, null, null,
       '[{"id":"b7b00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0, 'admin')),
  (2, public.crear_pedido('Ana', '3515551234', null, 'coordinar', null, null, null, null,
       '[{"id":"b7b00000-0000-4000-8000-000000000002","cantidad":1}]'::jsonb, 0, 'admin')),
  (3, public.crear_pedido('Ana', '3515551234', 'ana@manual.test', 'coordinar', null, null, null, null,
       '[{"id":"b7b00000-0000-4000-8000-000000000003","cantidad":1}]'::jsonb, 0, 'admin'));

-- 1
select ok(
  not public.puede_resenar('b7b00000-0000-4000-8000-000000000001'),
  'the staff account that loaded the manual order cannot review it'
);

-- Ana, con la cuenta del email del pedido.
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'b7000000-0000-4000-8000-000000000001';
-- 2
select ok(
  public.puede_resenar('b7b00000-0000-4000-8000-000000000001'),
  'a manual order with the account email (any case, with spaces) counts as a purchase'
);
-- 3
select lives_ok(
  $$ select public.guardar_resena('b7b00000-0000-4000-8000-000000000001', 5, 'Hermoso') $$,
  'the customer can save the review'
);
-- 4
select ok(
  not public.puede_resenar('b7b00000-0000-4000-8000-000000000002'),
  'a manual order without email does not count'
);
-- 5
select throws_ok(
  $$ select public.guardar_resena('b7b00000-0000-4000-8000-000000000002', 4, null) $$,
  '42501', null,
  'saving a review without a purchase is still rejected'
);

-- Otra cuenta no hereda la compra de Ana.
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'b7000000-0000-4000-8000-000000000002';
-- 6
select ok(
  not public.puede_resenar('b7b00000-0000-4000-8000-000000000001'),
  'a manual order with another email does not count'
);

reset role;
update public.pedidos set estado = 'cancelado'
 where numero = (select numero from manual where n = 3);
set local role authenticated;
set local request.jwt.claims = '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'b7000000-0000-4000-8000-000000000001';
-- 7
select ok(
  not public.puede_resenar('b7b00000-0000-4000-8000-000000000003'),
  'a cancelled manual order does not count'
);

reset role;
update public.pedidos set estado = 'nuevo', eliminado_at = now()
 where numero = (select numero from manual where n = 3);
set local role authenticated;
-- 8
select ok(
  not public.puede_resenar('b7b00000-0000-4000-8000-000000000003'),
  'a manual order in the trash does not count'
);

select * from finish();

rollback;
