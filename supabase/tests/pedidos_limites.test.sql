-- ============================================================================
-- pgTAP tests for migration 20261001050000_pedidos_limites.sql
--   * checkout orders: at most 5 per 10 minutes per account (stock rolls back)
--   * the order email is always the account email
--   * manual orders by staff are not limited and keep the typed email
--   * text length and item count limits (Spanish messages, only on insert:
--     an existing long order can still be updated)
--
-- Everything runs inside one transaction that is rolled back at the end.
-- ============================================================================

begin;

select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@limites.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Clienta"}', now(), now()),
  ('b6000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@limites.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());
update public.profiles set rol = 'admin' where id = 'b6000000-0000-4000-8000-0000000000ad';

insert into public.categorias (id, nombre) values ('b6c00000-0000-4000-8000-000000000001', 'Cat límites');
insert into public.productos (id, nombre, categoria_id, precio, stock)
values ('b6b00000-0000-4000-8000-000000000001', 'Prod límites', 'b6c00000-0000-4000-8000-000000000001', 100, 100);

create function pg_temp.pedir(p_email text default 'otro@spam.test', p_notas text default null,
                              p_origen text default 'checkout')
returns bigint language sql as $$
  select public.crear_pedido(
    'Clienta', '3515551234', p_email, 'coordinar', null, null, null, p_notas,
    '[{"id":"b6b00000-0000-4000-8000-000000000001","cantidad":1}]'::jsonb, 0, p_origen
  )
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b6000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'b6000000-0000-4000-8000-000000000001';

-- 1
select lives_ok(
  $$ select pg_temp.pedir() from generate_series(1, 5) $$,
  'five checkout orders in a row are accepted'
);
-- 2
select throws_ok(
  $$ select pg_temp.pedir() $$,
  'P0001', 'Hiciste muchos pedidos seguidos. Esperá un rato o escribinos por WhatsApp.',
  'the sixth one within 10 minutes is rejected'
);

reset role;
-- 3
select is(
  (select stock from public.productos where id = 'b6b00000-0000-4000-8000-000000000001'),
  95,
  'the rejected order does not keep stock'
);
-- 4
select is(
  (select array_agg(distinct email) from public.pedidos where user_id = 'b6000000-0000-4000-8000-000000000001'),
  array['clienta@limites.test']::text[],
  'checkout orders always use the account email, not the typed one'
);

-- Como admin: pedidos manuales sin límite y con el email que se cargó.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b6000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'b6000000-0000-4000-8000-0000000000ad';

-- 5
select lives_ok(
  $$ select pg_temp.pedir('cliente@manual.test', null, 'admin') from generate_series(1, 7) $$,
  'manual orders by staff are not rate limited'
);
reset role;
-- 6
select is(
  (select count(*)::int from public.pedidos
    where user_id = 'b6000000-0000-4000-8000-0000000000ad' and email = 'cliente@manual.test'),
  7,
  'manual orders keep the email typed by the staff'
);
-- 7
select throws_ok(
  $$ insert into public.pedidos (nombre, telefono, items, subtotal, notas)
     values ('X', '1', '[]', 0, repeat('n', 1001)) $$,
  'P0001', 'Las notas son demasiado largas (máximo 1000 letras).',
  'notes longer than 1000 characters are rejected'
);
-- 8
select throws_ok(
  $$ insert into public.pedidos (nombre, telefono, items, subtotal)
     values ('X', '1', (select jsonb_agg(jsonb_build_object('id', g)) from generate_series(1, 51) g), 0) $$,
  'P0001', 'El pedido tiene demasiados productos distintos (máximo 50).',
  'more than 50 items are rejected'
);
-- 9 (an old order with long notes, written before the limits, stays editable)
alter table public.pedidos disable trigger pedidos_proteger_checkout;
insert into public.pedidos (id, nombre, telefono, items, subtotal, notas)
values ('b6d00000-0000-4000-8000-000000000001', 'Vieja', '1', '[]', 0, repeat('n', 1500));
alter table public.pedidos enable trigger pedidos_proteger_checkout;
select lives_ok(
  $$ update public.pedidos set estado = 'confirmado' where id = 'b6d00000-0000-4000-8000-000000000001' $$,
  'an existing order with long notes can still change state'
);

select * from finish();

rollback;
