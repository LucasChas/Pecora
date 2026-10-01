-- ============================================================================
-- pgTAP tests for migration 20261002020000_cupones_visibles.sql
-- ============================================================================

begin;

select plan(6);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('bb000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@cv.test', '{}', '{"nombre":"Ana"}', now(), now());

insert into public.categorias (id, nombre) values ('bbc00000-0000-4000-8000-000000000001', 'Cat cv');
insert into public.productos (id, nombre, categoria_id, precio, stock)
values ('bbb00000-0000-4000-8000-000000000001', 'Body cv', 'bbc00000-0000-4000-8000-000000000001', 1000, 50);

insert into public.cupones (codigo, tipo, valor, minimo_compra, desde, hasta, usos_por_cliente, solo_primera_compra, activo, visible_en_cuenta) values
  ('BIENVENIDA', 'porcentaje', 10, 0, null, null, 1, true, true, true),
  ('VISIBLE', 'monto', 500, 3000, null, now() + interval '5 days', 1, false, true, true),
  ('OCULTO', 'monto', 500, 0, null, null, 1, false, true, false),
  ('VENCIDO', 'monto', 500, 0, null, now() - interval '1 day', 1, false, true, true),
  ('INACTIVO', 'monto', 500, 0, null, null, 1, false, false, true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bb000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'bb000000-0000-4000-8000-000000000001';

-- 1
select set_eq(
  $$ select codigo from public.cupones_disponibles() $$,
  $$ values ('BIENVENIDA'), ('VISIBLE') $$,
  'only visible, active and current coupons are listed'
);
-- 2
select is(
  (select minimo_compra from public.cupones_disponibles() where codigo = 'VISIBLE'),
  3000::numeric,
  'the minimum purchase is shown (it does not filter)'
);

-- Primera compra con el cupón VISIBLE.
select public.crear_pedido('Ana', '3515551234', null, 'coordinar', null, null, null, null,
  '[{"id":"bbb00000-0000-4000-8000-000000000001","cantidad":3}]'::jsonb, 0, 'checkout', p_cupon => 'VISIBLE');
-- 3
select ok(
  not exists (select 1 from public.cupones_disponibles() where codigo = 'VISIBLE'),
  'a coupon already used up by the customer disappears'
);
-- 4
select ok(
  not exists (select 1 from public.cupones_disponibles() where codigo = 'BIENVENIDA'),
  'a first-purchase coupon disappears after the first purchase'
);

reset role;
-- 5
insert into public.cupones (codigo, tipo, valor) values ('SINFLAG', 'monto', 100);
select is(
  (select visible_en_cuenta from public.cupones where codigo = 'SINFLAG'),
  false,
  'a new coupon is not shown in Mi cuenta unless the admin says so'
);
set local role anon;
-- 6
select throws_ok($$ select * from public.cupones_disponibles() $$, '42501', null, 'anon cannot call it');

select * from finish();

rollback;
