-- ============================================================================
-- pgTAP tests for migration 20261001070000_mis_resenas.sql
--   * returns only the reviews of the logged-in account (hidden ones too)
--   * anon cannot call it
-- ============================================================================

begin;

select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b8000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@mis.test', '{}', '{"nombre":"Ana"}', now(), now()),
  ('b8000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'otra@mis.test', '{}', '{"nombre":"Otra"}', now(), now());

insert into public.categorias (id, nombre) values ('b8c00000-0000-4000-8000-000000000001', 'Cat mis');
insert into public.productos (id, nombre, categoria_id, precio, stock) values
  ('b8b00000-0000-4000-8000-000000000001', 'Uno', 'b8c00000-0000-4000-8000-000000000001', 100, 5),
  ('b8b00000-0000-4000-8000-000000000002', 'Dos', 'b8c00000-0000-4000-8000-000000000001', 100, 5);

insert into public.resenas (producto_id, user_id, estrellas, comentario, oculta) values
  ('b8b00000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000001', 5, 'Lindo', false),
  ('b8b00000-0000-4000-8000-000000000002', 'b8000000-0000-4000-8000-000000000001', 2, null, true),
  ('b8b00000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000002', 4, null, false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"b8000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'b8000000-0000-4000-8000-000000000001';

-- 1
select is((select count(*)::int from public.mis_resenas()), 2, 'returns the two reviews of the account');
-- 2
select is(
  (select estrellas::int from public.mis_resenas() where producto_id = 'b8b00000-0000-4000-8000-000000000002'),
  2,
  'hidden reviews are included (the author still sees hers)'
);

set local request.jwt.claims = '{"sub":"b8000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'b8000000-0000-4000-8000-000000000002';
-- 3
select is((select count(*)::int from public.mis_resenas()), 1, 'another account sees only its own');

reset role;
set local role anon;
-- 4
select throws_ok($$ select * from public.mis_resenas() $$, '42501', null, 'anon cannot call it');

select * from finish();

rollback;
