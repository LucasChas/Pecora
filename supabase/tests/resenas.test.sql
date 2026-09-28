-- ============================================================================
-- pgTAP tests for migration *_resenas.sql (star reviews from verified buyers)
--   * public.resenas: RLS (visible rows for everyone, hidden rows for staff),
--     no direct writes, user_id not granted to the API roles.
--   * guardar_resena / borrar_resena: login + verified purchase required
--     (own checkout order, not cancelled, not trashed), one review per
--     account and product, estrellas 1..5, comment trimmed and <= 1000.
--   * ocultar_resena / resenas_moderacion: admin only.
--   * Public outputs expose only the first name, never emails or user ids.
--
-- Run locally with:  supabase db start && supabase test db --local
--
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(62);

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres).
--   ...01 Ana    buyer of P1 (order nuevo) and P2 (order entregado)
--   ...02 Bea    P1 only in a cancelled order and a trashed order
--   ...03 Cora   no orders
--   ...04 Emi    empleado
--   ...05 Admin  admin; P1 only in a manual order (origen 'admin')
--   ...06 Dora   buyer of P1; her profile name is an email address
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana@resenas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"  Ana   María Pérez "}', now(), now()),
  ('a5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bea@resenas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Bea"}', now(), now()),
  ('a5000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cora@resenas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Cora"}', now(), now()),
  ('a5000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'emi@resenas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Emi"}', now(), now()),
  ('a5000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@resenas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now()),
  ('a5000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dora@resenas.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"dora@resenas.test"}', now(), now());

update public.profiles set rol = 'empleado' where id = 'a5000000-0000-4000-8000-000000000004';
update public.profiles set rol = 'admin'    where id = 'a5000000-0000-4000-8000-000000000005';

insert into public.productos (id, nombre, precio, stock) values
  ('b5000000-0000-4000-8000-000000000001', 'Body reseñas', 1000, 10),
  ('b5000000-0000-4000-8000-000000000002', 'Gorro reseñas', 500, 10);

-- Orders are inserted directly (inserting does not touch stock).
insert into public.pedidos
  (id, user_id, nombre, telefono, items, subtotal, estado, eliminado_at, origen)
values
  ('d5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001',
   'Ana', '111',
   '[{"id":"b5000000-0000-4000-8000-000000000001","nombre":"Body","precio":1000,"cantidad":1}]',
   1000, 'nuevo', null, 'checkout'),
  ('d5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001',
   'Ana', '111',
   '[{"id":"b5000000-0000-4000-8000-000000000002","nombre":"Gorro","precio":500,"cantidad":1}]',
   500, 'entregado', null, 'checkout'),
  ('d5000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000002',
   'Bea', '222',
   '[{"id":"b5000000-0000-4000-8000-000000000001","nombre":"Body","precio":1000,"cantidad":1}]',
   1000, 'cancelado', null, 'checkout'),
  ('d5000000-0000-4000-8000-000000000004', 'a5000000-0000-4000-8000-000000000002',
   'Bea', '222',
   '[{"id":"b5000000-0000-4000-8000-000000000001","nombre":"Body","precio":1000,"cantidad":1}]',
   1000, 'confirmado', now(), 'checkout'),
  ('d5000000-0000-4000-8000-000000000005', 'a5000000-0000-4000-8000-000000000005',
   'Por WhatsApp', '555',
   '[{"id":"b5000000-0000-4000-8000-000000000001","nombre":"Body","precio":1000,"cantidad":1}]',
   1000, 'nuevo', null, 'admin'),
  ('d5000000-0000-4000-8000-000000000006', 'a5000000-0000-4000-8000-000000000006',
   'Dora', '666',
   '[{"id":"b5000000-0000-4000-8000-000000000001","nombre":"Body","precio":1000,"cantidad":2}]',
   2000, 'confirmado', null, 'checkout');

-- ----------------------------------------------------------------------------
-- Definition and privileges.
-- ----------------------------------------------------------------------------
-- 1
select has_table('public', 'resenas', 'resenas exists');
-- 2
select is(
  (select relrowsecurity from pg_class where oid = 'public.resenas'::regclass),
  true, 'resenas has RLS enabled');
-- 3
select is(has_column_privilege('anon', 'public.resenas', 'estrellas', 'SELECT'), true,
  'anon can read estrellas (RLS: visible rows)');
-- 4
select is(has_column_privilege('anon', 'public.resenas', 'user_id', 'SELECT'), false,
  'anon cannot read user_id');
-- 5
select is(has_column_privilege('authenticated', 'public.resenas', 'user_id', 'SELECT'), false,
  'authenticated cannot read user_id');
-- 6
select is(has_table_privilege('authenticated', 'public.resenas', 'INSERT'), false,
  'authenticated cannot insert directly');
-- 7
select is(has_table_privilege('authenticated', 'public.resenas', 'UPDATE'), false,
  'authenticated cannot update directly');
-- 8
select is(has_table_privilege('authenticated', 'public.resenas', 'DELETE'), false,
  'authenticated cannot delete directly');
-- 9
select is_definer('public', 'guardar_resena', array['uuid', 'integer', 'text'],
  'guardar_resena is SECURITY DEFINER');
-- 10
select is(has_function_privilege('anon', 'public.guardar_resena(uuid, int, text)', 'EXECUTE'), false,
  'anon cannot execute guardar_resena');
-- 11
select is(has_function_privilege('anon', 'public.borrar_resena(uuid)', 'EXECUTE'), false,
  'anon cannot execute borrar_resena');
-- 12
select is(has_function_privilege('anon', 'public.ocultar_resena(uuid, boolean)', 'EXECUTE'), false,
  'anon cannot execute ocultar_resena');
-- 13
select is(has_function_privilege('anon', 'public.resenas_de_producto(uuid)', 'EXECUTE'), true,
  'anon can execute resenas_de_producto');
-- 14
select is(has_function_privilege('anon', 'public.resumen_resenas(uuid)', 'EXECUTE'), true,
  'anon can execute resumen_resenas');
-- 15
select is(has_function_privilege('authenticated', 'public.compra_verificada(uuid, uuid)', 'EXECUTE'), false,
  'authenticated cannot execute the compra_verificada helper');
-- 16
select is(
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p
    where p.oid = to_regprocedure('public.guardar_resena(uuid, int, text)')),
  true, 'PUBLIC has no EXECUTE on guardar_resena');
-- 17
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('resenas_de_producto', 'resumen_resenas', 'mi_resena', 'resenas_moderacion')
      and p.proargnames && array['user_id', 'email']),
  0, 'public review outputs have no user_id or email column');

-- ----------------------------------------------------------------------------
-- As anon.
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 18
select throws_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000001', 5, 'Hola') $$,
  '42501', null, 'anon cannot write a review');
-- 19
select throws_ok(
  $$ insert into public.resenas (producto_id, user_id, estrellas)
     values ('b5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 5) $$,
  '42501', null, 'anon cannot insert directly');

-- ----------------------------------------------------------------------------
-- Non-buyers.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000003';

-- 20
select is(public.puede_resenar('b5000000-0000-4000-8000-000000000001'), false,
  'a customer without orders cannot review');
-- 21
select throws_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000001', 5, null) $$,
  '42501', 'Solo pueden opinar quienes compraron este producto.',
  'a non-buyer is rejected');
-- 22
select throws_ok(
  $$ insert into public.resenas (producto_id, user_id, estrellas)
     values ('b5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000003', 5) $$,
  '42501', null, 'a customer cannot insert directly');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000002';

-- 23
select is(public.puede_resenar('b5000000-0000-4000-8000-000000000001'), false,
  'a cancelled or trashed order does not count as a purchase');
-- 24
select throws_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000001', 4, null) $$,
  '42501', null, 'a buyer of a cancelled/trashed order is rejected');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000005","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000005';

-- 25
select is(public.puede_resenar('b5000000-0000-4000-8000-000000000001'), false,
  'a manual order loaded by the staff does not make the staff a buyer');

-- ----------------------------------------------------------------------------
-- Verified buyer Ana.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000001';

-- 26
select is(public.puede_resenar('b5000000-0000-4000-8000-000000000001'), true,
  'a verified buyer can review');
-- 27
select throws_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000001', 0, null) $$,
  '22023', null, '0 stars is rejected');
-- 28
select throws_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000001', 6, null) $$,
  '22023', null, '6 stars is rejected');
-- 29
select throws_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000001', null, null) $$,
  '22023', null, 'null stars is rejected');
-- 30
select throws_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000001', 5, repeat('a', 1001)) $$,
  '22023', null, 'a comment over 1000 characters is rejected');
-- 31
select throws_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-0000000000ff', 5, null) $$,
  'P0002', null, 'a missing product is rejected');
-- 32
select isnt(
  public.guardar_resena('b5000000-0000-4000-8000-000000000001', 4, '  Muy lindo  '),
  null, 'a verified buyer creates a review');
-- 33
select results_eq(
  $$ select estrellas::int, comentario, oculta from public.mi_resena('b5000000-0000-4000-8000-000000000001') $$,
  $$ values (4, 'Muy lindo'::text, false) $$,
  'the comment is stored trimmed');
-- 34
select is(
  public.guardar_resena('b5000000-0000-4000-8000-000000000001', 5, '   '),
  (select id from public.mi_resena('b5000000-0000-4000-8000-000000000001')),
  'saving again updates the same review');
-- 35
select results_eq(
  $$ select estrellas::int, comentario from public.mi_resena('b5000000-0000-4000-8000-000000000001') $$,
  $$ values (5, null::text) $$,
  'the review was updated (blank comment -> null)');
-- 36
select is(
  (select count(*)::int from public.resenas
    where producto_id = 'b5000000-0000-4000-8000-000000000001'),
  1, 'only one review per account and product');
-- 37
select lives_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000002', 3, 'Abriga bien') $$,
  'a buyer of a delivered order can review too');
-- 38
select throws_ok(
  $$ update public.resenas set estrellas = 1 $$,
  '42501', null, 'a customer cannot update directly');
-- 39
select throws_ok(
  $$ select public.ocultar_resena(
       (select id from public.mi_resena('b5000000-0000-4000-8000-000000000001')), true) $$,
  '42501', null, 'a customer cannot hide reviews');
-- 40
select throws_ok(
  $$ select * from public.resenas_moderacion() $$,
  '42501', null, 'a customer cannot list reviews for moderation');

-- Dora reviews P1 as well.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000006","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000006';

-- 41
select lives_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000001', 2, 'Talle chico') $$,
  'another verified buyer reviews the same product');

-- ----------------------------------------------------------------------------
-- Public reads (anon): names are first names only, no emails.
-- ----------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 42
select results_eq(
  $$ select nombre_corto, estrellas::int, es_mia
       from public.resenas_de_producto('b5000000-0000-4000-8000-000000000001')
      order by nombre_corto $$,
  $$ values ('Ana'::text, 5, false), ('Cliente'::text, 2, false) $$,
  'public list shows first names only (an email-like name becomes Cliente)');
-- 43
select is(
  (select count(*)::int
     from public.resenas_de_producto('b5000000-0000-4000-8000-000000000001') x
    where x::text like '%@%'),
  0, 'public list contains no email');
-- 44
select results_eq(
  $$ select promedio, cantidad from public.resumen_resenas('b5000000-0000-4000-8000-000000000001') $$,
  $$ values (3.5::numeric, 2) $$,
  'summary: average and count');
-- 45
select is(
  (select count(*)::int from public.resenas
    where producto_id = 'b5000000-0000-4000-8000-000000000001'),
  2, 'anon reads visible reviews directly');
-- 46
select throws_ok(
  $$ select user_id from public.resenas $$,
  '42501', null, 'anon cannot select user_id');

-- ----------------------------------------------------------------------------
-- Moderation.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000004","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000004';

-- 47
select throws_ok(
  $$ select public.ocultar_resena(
       (select id from public.resenas
         where producto_id = 'b5000000-0000-4000-8000-000000000001' and estrellas = 2), true) $$,
  '42501', null, 'an empleado cannot hide reviews (admin only)');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000005","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000005';

-- 48
select is(
  public.ocultar_resena(
    (select id from public.resenas
      where producto_id = 'b5000000-0000-4000-8000-000000000001' and estrellas = 2), true),
  true, 'the admin hides a review');
-- 49
select is(public.ocultar_resena('e5000000-0000-4000-8000-0000000000ff', true), false,
  'hiding a missing review returns false');
-- 50
select results_eq(
  $$ select nombre_corto, oculta from public.resenas_moderacion(true) $$,
  $$ values ('Cliente'::text, true) $$,
  'the admin lists hidden reviews');
-- 51
select is((select count(*)::int from public.resenas_moderacion()), 3,
  'the admin lists all reviews');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 52
select is(
  (select count(*)::int from public.resenas_de_producto('b5000000-0000-4000-8000-000000000001')),
  1, 'hidden reviews are not in the public list');
-- 53
select results_eq(
  $$ select promedio, cantidad from public.resumen_resenas('b5000000-0000-4000-8000-000000000001') $$,
  $$ values (5.0::numeric, 1) $$,
  'hidden reviews do not count in the summary');
-- 54
select is(
  (select count(*)::int from public.resenas where oculta),
  0, 'anon cannot read hidden reviews directly');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000004","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000004';

-- 55
select is(
  (select count(*)::int from public.resenas where oculta),
  1, 'staff (empleado) reads hidden reviews');

-- The author still sees her hidden review; editing does not unhide it.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000006","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000006';

-- 56
select is(
  (select oculta from public.mi_resena('b5000000-0000-4000-8000-000000000001')),
  true, 'the author sees her hidden review');
-- 57
select lives_ok(
  $$ select public.guardar_resena('b5000000-0000-4000-8000-000000000001', 3, 'Editada') $$,
  'the author can edit her hidden review');
-- 58
select is(
  (select oculta from public.mi_resena('b5000000-0000-4000-8000-000000000001')),
  true, 'editing does not unhide a moderated review');

-- ----------------------------------------------------------------------------
-- Delete own.
-- ----------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000001';

-- 59
select is(public.borrar_resena('b5000000-0000-4000-8000-000000000001'), true,
  'the author deletes her review');
-- 60
select is(public.borrar_resena('b5000000-0000-4000-8000-000000000001'), false,
  'deleting again returns false');

reset role;

-- 61
select is(
  (select count(*)::int from public.resenas
    where producto_id = 'b5000000-0000-4000-8000-000000000001'),
  1, 'deleting her review does not touch other reviews');
-- 62
select throws_ok(
  $$ insert into public.resenas (producto_id, user_id, estrellas)
     values ('b5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000006', 5) $$,
  '23505', null, 'the table enforces one review per account and product');

select * from finish();
rollback;
