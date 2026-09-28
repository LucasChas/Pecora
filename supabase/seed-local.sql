-- =============================================================================
-- seed-local.sql: datos de prueba SOLO para el stack local de Supabase.
--
-- NO es supabase/seed.sql a propósito: `supabase db reset` en CI no lo carga,
-- así los tests pgTAP siguen corriendo sobre una base vacía.
--
-- Cuentas de prueba (solo existen en la base local, nunca en producción):
--   admin@pecora.test      rol admin
--   empleada@pecora.test   rol empleado
--   clienta1@pecora.test   rol cliente
--   clienta2@pecora.test   rol cliente
--   Contraseña (la misma para las cuatro): D5FWW6iruvttmQFV
--
-- Uso (ver CONTEXTO.md §14):
--   docker exec -i supabase_db_pecora psql -U postgres -v ON_ERROR_STOP=1 < supabase/seed-local.sql
--
-- Los gastos de prueba solo se cargan si la base ya tiene la tabla gastos
-- (migración gastos_rentabilidad).
--
-- Se puede volver a correr: primero borra lo que haya cargado antes (IDs fijos
-- y emails @pecora.test) y después lo vuelve a crear.
-- =============================================================================

begin;

-- Los pedidos se insertan directo (como postgres) en su estado final, con el
-- stock de los productos ya descontado. Por eso se apagan los triggers de
-- pedidos mientras dura la carga: ni se toca el stock ni se intenta mandar mails.
alter table public.pedidos disable trigger user;

-- -----------------------------------------------------------------------------
-- Limpieza de una carga anterior
-- -----------------------------------------------------------------------------
delete from public.pedidos
 where id::text like 'd0000000-0000-4000-8000-%'
    or user_id in (select id from auth.users where email like '%@pecora.test');
-- gastos solo existe si ya se aplicó la migración gastos_rentabilidad.
do $$
begin
  if to_regclass('public.gastos') is not null then
    delete from public.gastos where id::text like '60000000-0000-4000-8000-%';
  end if;
end;
$$;
delete from public.cupones
 where upper(codigo) in ('BIENVENIDA10', 'ENVIOGRATIS', 'INVIERNO3000');
delete from public.zonas_envio where id::text like 'e0000000-0000-4000-8000-%';
delete from public.productos   where id::text like 'b0000000-0000-4000-8000-%';
delete from public.categorias  where id::text like 'c0000000-0000-4000-8000-%';
-- Cascada: auth.identities, profiles, resenas, avisos_stock.
delete from auth.users where email like '%@pecora.test';

-- -----------------------------------------------------------------------------
-- Usuarios (auth.users + auth.identities; handle_new_user crea el perfil)
-- -----------------------------------------------------------------------------
create temporary table _seed_usuarios (
  id uuid, email text, nombre text, telefono text, rol text, dias int
) on commit drop;

insert into _seed_usuarios values
  ('a0000000-0000-4000-8000-000000000001', 'admin@pecora.test',    'Admin Pecora',     '3541 100001', 'admin',    200),
  ('a0000000-0000-4000-8000-000000000002', 'empleada@pecora.test', 'Laura Gómez',      '3541 100002', 'empleado', 180),
  ('a0000000-0000-4000-8000-000000000003', 'clienta1@pecora.test', 'Martina López',    '3541 200003', 'cliente',  120),
  ('a0000000-0000-4000-8000-000000000004', 'clienta2@pecora.test', 'Sofía Fernández',  '11 2345 6789', 'cliente', 112);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, extensions.crypt('D5FWW6iruvttmQFV', extensions.gen_salt('bf')),
       now() - make_interval(days => u.dias),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('nombre', u.nombre, 'telefono', u.telefono),
       now() - make_interval(days => u.dias), now() - make_interval(days => u.dias),
       '', '', '', '', '', '', '', ''
  from _seed_usuarios u;

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email,
                          'email_verified', true, 'phone_verified', false),
       'email', now() - make_interval(days => u.dias),
       now() - make_interval(days => u.dias), now() - make_interval(days => u.dias)
  from _seed_usuarios u;

-- Como postgres, proteger_rol_perfil deja cambiar el rol.
update public.profiles p
   set rol = u.rol,
       created_at = now() - make_interval(days => u.dias)
  from _seed_usuarios u
 where p.id = u.id;

-- -----------------------------------------------------------------------------
-- Catálogo
-- -----------------------------------------------------------------------------
insert into public.categorias (id, nombre, created_at) values
  ('c0000000-0000-4000-8000-000000000001', 'Baberos',           now() - interval '200 days'),
  ('c0000000-0000-4000-8000-000000000002', 'Mantas y arrullos', now() - interval '200 days'),
  ('c0000000-0000-4000-8000-000000000003', 'Cambiadores',       now() - interval '200 days'),
  ('c0000000-0000-4000-8000-000000000004', 'Accesorios',        now() - interval '200 days');

-- El stock ya refleja lo vendido por los pedidos de abajo. imagen_url null:
-- la app muestra su placeholder. El slug lo arma el trigger productos_set_slug.
insert into public.productos (id, categoria_id, nombre, descripcion, precio, stock, sku, created_at) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'Babero bandana de muselina', 'Doble capa de muselina de algodón con broche a presión.', 6500, 18, 'BAB-001', now() - interval '190 days'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   'Babero impermeable con bolsillo', 'Tela impermeable lavable, con bolsillo recolector.', 7800, 12, 'BAB-002', now() - interval '190 days'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001',
   'Set x3 baberos de toalla', 'Tres baberos de toalla de algodón en colores surtidos.', 14900, 0, 'BAB-003', now() - interval '185 days'),
  ('b0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002',
   'Manta de muselina doble gasa', 'Manta liviana de 110 x 110 cm, ideal para verano.', 21500, 9, 'MAN-001', now() - interval '185 days'),
  ('b0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002',
   'Arrullo de polar con capucha', 'Arrullo abrigado de polar antipilling con capucha.', 26900, 5, 'MAN-002', now() - interval '180 days'),
  ('b0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002',
   'Manta tejida de algodón', 'Tejida a mano en hilo de algodón peinado.', 38500, 0, null, now() - interval '170 days'),
  ('b0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000003',
   'Cambiador portátil acolchado', 'Plegable, con bolsillo para pañales y toallitas.', 24900, 7, 'CAM-001', now() - interval '170 days'),
  ('b0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000003',
   'Cambiador impermeable plegable', 'Superficie impermeable fácil de limpiar.', 18900, 11, 'CAM-002', now() - interval '165 days'),
  ('b0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000003',
   'Funda para cambiador', 'Funda de toalla ajustable con elástico.', 12500, 3, null, now() - interval '160 days'),
  ('b0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000004',
   'Toallón con capucha', 'Toallón de algodón con capucha bordada.', 19800, 14, 'ACC-001', now() - interval '160 days'),
  ('b0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000004',
   'Porta chupete de tela', 'Cinta de tela con broche y clip seguro.', 4900, 30, null, now() - interval '150 days'),
  ('b0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000004',
   'Bolso maternal de lona', 'Bolso amplio con cambiador incluido y bolsillo térmico.', 42000, 2, null, now() - interval '140 days');

-- -----------------------------------------------------------------------------
-- Zonas de envío y cupones
-- -----------------------------------------------------------------------------
insert into public.zonas_envio (id, nombre, provincias, cp_prefijos, precio, gratis_desde, orden) values
  ('e0000000-0000-4000-8000-000000000001', 'Córdoba', array['Córdoba'], array['50'], 3500, 60000, 1),
  ('e0000000-0000-4000-8000-000000000002', 'Buenos Aires y Santa Fe',
   array['Buenos Aires', 'CABA', 'Santa Fe'], array[]::text[], 7500, null, 2);

insert into public.cupones
  (id, codigo, descripcion, tipo, valor, minimo_compra, desde, hasta, usos_max, usos_por_cliente, solo_primera_compra, activo, created_at)
values
  ('f0000000-0000-4000-8000-000000000001', 'BIENVENIDA10', '10% en la primera compra',
   'porcentaje', 10, 0, null, null, null, 1, true, true, now() - interval '150 days'),
  ('f0000000-0000-4000-8000-000000000002', 'ENVIOGRATIS', 'Envío gratis desde $20.000',
   'envio_gratis', 0, 20000, null, null, 100, 2, false, true, now() - interval '60 days'),
  ('f0000000-0000-4000-8000-000000000003', 'INVIERNO3000', '$3.000 de descuento (campaña de invierno, vencido)',
   'monto', 3000, 25000, now() - interval '90 days', now() - interval '30 days', 50, 1, false, true, now() - interval '90 days');

-- -----------------------------------------------------------------------------
-- Pedidos
-- items: 'pNN:cantidad,...' -> se arma el mismo jsonb que guarda crear_pedido
-- ({id, nombre, precio, cantidad}) con el precio actual del producto.
-- -----------------------------------------------------------------------------
create temporary table _seed_pedidos (
  n int, usuario int, dias numeric, estado text, origen text, entrega text,
  zona int, papelera_dias numeric, cupon text, items text,
  nombre_manual text, telefono_manual text
) on commit drop;

-- usuario: 3 = clienta1, 4 = clienta2, 1 = admin (carga manual). zona: 1 Córdoba, 2 Bs As/Santa Fe.
insert into _seed_pedidos values
  ( 1, 3, 115.2, 'entregado',  'checkout', 'envio',     1, null, null,           'p04:1,p01:2',  null, null),
  ( 2, 4, 108.6, 'entregado',  'checkout', 'coordinar', null, null, 'BIENVENIDA10', 'p07:1',     null, null),
  ( 3, 3, 101.4, 'entregado',  'checkout', 'coordinar', null, null, null,        'p10:1,p11:2',  null, null),
  ( 4, 1,  95.7, 'entregado',  'admin',    'coordinar', null, null, null,        'p01:3',        'Carla Ruiz',  '3541 300004'),
  ( 5, 4,  88.3, 'entregado',  'checkout', 'envio',     2, null, null,           'p05:1,p02:1',  null, null),
  ( 6, 3,  80.5, 'cancelado',  'checkout', 'coordinar', null, null, null,        'p12:1',        null, null),
  ( 7, 4,  72.1, 'entregado',  'checkout', 'envio',     1, null, null,           'p04:2',        null, null),
  ( 8, 3,  64.8, 'entregado',  'checkout', 'coordinar', null, null, 'INVIERNO3000', 'p08:1,p09:1', null, null),
  ( 9, 4,  57.2, 'entregado',  'checkout', 'coordinar', null, null, null,        'p01:1,p11:1',  null, null),
  (10, 1,  50.6, 'entregado',  'admin',    'coordinar', null, null, null,        'p07:1,p10:1',  'Valeria Sosa', '351 555 0110'),
  (11, 3,  43.3, 'confirmado', 'checkout', 'envio',     2, null, 'ENVIOGRATIS', 'p03:1,p02:2',  null, null),
  (12, 4,  36.9, 'cancelado',  'checkout', 'envio',     1, null, null,           'p06:1',        null, null),
  (13, 3,  29.4, 'entregado',  'checkout', 'coordinar', null, null, null,        'p04:1,p05:1',  null, null),
  (14, 4,  22.2, 'confirmado', 'checkout', 'envio',     1, null, null,           'p12:1,p01:1',  null, null),
  (15, 1,  15.5, 'confirmado', 'admin',    'coordinar', null, null, null,        'p11:4',        'Julieta Paz', '3541 300015'),
  (16, 3,  10.1, 'nuevo',      'checkout', 'coordinar', null, 8.0, null,         'p07:1',        null, null),
  (17, 4,   6.4, 'nuevo',      'checkout', 'envio',     1, null, null,           'p06:1,p04:1',  null, null),
  (18, 3,   2.3, 'nuevo',      'checkout', 'coordinar', null, null, null,        'p10:2,p01:1',  null, null);

with items as (
  select s.n,
         jsonb_agg(jsonb_build_object(
                     'id', pr.id, 'nombre', pr.nombre, 'precio', pr.precio,
                     'cantidad', split_part(it, ':', 2)::int)
                   order by ord) as items,
         sum(pr.precio * split_part(it, ':', 2)::int) as subtotal
    from _seed_pedidos s
    cross join lateral regexp_split_to_table(s.items, ',') with ordinality as t(it, ord)
    join public.productos pr
      on pr.id = ('b0000000-0000-4000-8000-0000000000' || substr(split_part(it, ':', 1), 2))::uuid
   group by s.n
),
calc as (
  select s.*, i.items as items_json, i.subtotal,
         u.id as user_id, u.nombre as u_nombre, u.telefono as u_telefono, u.email as u_email,
         z.id as zona_id, z.nombre as zona_nombre, z.precio as zona_precio, z.gratis_desde,
         c.id as cupon_id, c.codigo as cupon_codigo, c.tipo as cupon_tipo, c.valor as cupon_valor,
         now() - make_interval(secs => s.dias * 86400) as creado
    from _seed_pedidos s
    join items i on i.n = s.n
    join _seed_usuarios u on u.id = ('a0000000-0000-4000-8000-00000000000' || s.usuario)::uuid
    left join public.zonas_envio z
      on s.entrega = 'envio' and z.id = ('e0000000-0000-4000-8000-00000000000' || s.zona)::uuid
    left join public.cupones c on upper(c.codigo) = s.cupon
)
insert into public.pedidos (
  id, user_id, nombre, telefono, email, entrega, direccion, localidad, cp, provincia,
  notas, items, subtotal, estado, origen, created_at, eliminado_at,
  descuento, costo_envio, cupon_id, cupon_codigo, zona_id, zona_nombre,
  email_enviado_at, aviso_duena_enviado_at
)
select
  ('d0000000-0000-4000-8000-0000000000' || lpad(c.n::text, 2, '0'))::uuid,
  c.user_id,
  coalesce(c.nombre_manual, c.u_nombre),
  coalesce(c.telefono_manual, c.u_telefono),
  case when c.origen = 'checkout' then c.u_email end,
  c.entrega,
  case when c.entrega = 'envio' then case c.zona when 1 then 'Av. Colón 1234' else 'Calle 7 N° 845' end end,
  case when c.entrega = 'envio' then case c.zona when 1 then 'Córdoba' else 'La Plata' end end,
  case when c.entrega = 'envio' then case c.zona when 1 then '5000' else '1900' end end,
  case when c.entrega = 'envio' then case c.zona when 1 then 'Córdoba' else 'Buenos Aires' end end,
  case when c.origen = 'admin' then 'Venta en el local' end,
  c.items_json,
  c.subtotal,
  c.estado,
  c.origen,
  c.creado,
  case when c.papelera_dias is not null then now() - make_interval(secs => c.papelera_dias * 86400) end,
  case c.cupon_tipo
    when 'porcentaje' then round(c.subtotal * c.cupon_valor / 100, 2)
    when 'monto'      then least(c.cupon_valor, c.subtotal)
    else 0
  end,
  case
    when c.zona_id is null or c.cupon_tipo = 'envio_gratis' then 0
    when c.gratis_desde is not null and c.subtotal >= c.gratis_desde then 0
    else c.zona_precio
  end,
  c.cupon_id, c.cupon_codigo, c.zona_id, c.zona_nombre,
  case when c.origen = 'checkout' then c.creado + interval '1 minute' end,
  c.creado + interval '1 minute'
from calc c;

-- Uso de cupones (como lo registra crear_pedido: user_id de la clienta).
insert into public.cupon_usos (cupon_id, pedido_id, user_id, created_at)
select p.cupon_id, p.id, p.user_id, p.created_at
  from public.pedidos p
 where p.id::text like 'd0000000-0000-4000-8000-%'
   and p.cupon_id is not null;

-- -----------------------------------------------------------------------------
-- Reseñas (solo de compras checkout válidas) y aviso de stock
-- -----------------------------------------------------------------------------
insert into public.resenas (producto_id, user_id, estrellas, comentario, oculta, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', 5,
   'Súper suave, la uso todos los días para el cochecito.', false, now() - interval '100 days', now() - interval '100 days'),
  ('b0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000003', 4,
   'Muy lindo y absorbe bien. La capucha es un poco chica.', false, now() - interval '90 days', now() - interval '90 days'),
  ('b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000003', 5,
   null, false, now() - interval '55 days', now() - interval '55 days'),
  ('b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000004', 5,
   'Práctico para llevar en la cartera. Excelente calidad.', false, now() - interval '95 days', now() - interval '95 days'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000004', 4,
   'Abriga mucho, ideal para el invierno.', false, now() - interval '70 days', now() - interval '70 days'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 2,
   'Me llegó con una costura floja, no lo recomiendo.', true, now() - interval '50 days', now() - interval '45 days');

insert into public.avisos_stock (producto_id, user_id, email, created_at) values
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000003',
   'clienta1@pecora.test', now() - interval '20 days');

-- -----------------------------------------------------------------------------
-- Gastos (compras de materiales, packaging, envíos). Solo si la base ya tiene
-- la tabla (migración gastos_rentabilidad). Con producto + cantidad se estima
-- el costo por unidad; el arrullo de polar (p05) queda sin datos de costo a
-- propósito, para ver el aviso en Rentabilidad.
-- -----------------------------------------------------------------------------
do $$
declare
  hoy date := (now() at time zone 'America/Argentina/Cordoba')::date;
begin
  if to_regclass('public.gastos') is null then
    raise notice 'Sin tabla gastos: se saltean los gastos de prueba.';
    return;
  end if;

  insert into public.gastos (id, fecha, concepto, categoria, monto, producto_id, cantidad, notas, created_by) values
    ('60000000-0000-4000-8000-000000000001', hoy - 120, 'Muselina doble gasa (10 m)', 'materiales', 42000,
     'b0000000-0000-4000-8000-000000000004', 8, 'Rinde para 8 mantas', 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000002', hoy - 118, 'Muselina y broches para baberos', 'materiales', 26000,
     'b0000000-0000-4000-8000-000000000001', 20, null, 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000003', hoy - 110, 'Tela impermeable y guata', 'materiales', 54000,
     'b0000000-0000-4000-8000-000000000007', 6, null, 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000004', hoy - 100, 'Toalla de algodón y bies', 'materiales', 39600,
     'b0000000-0000-4000-8000-000000000010', 6, null, 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000005', hoy - 95, 'Cintas y clips para porta chupetes', 'materiales', 9000,
     'b0000000-0000-4000-8000-000000000011', 15, null, 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000006', hoy - 90, 'Bolsas kraft y etiquetas', 'packaging', 18500,
     null, null, null, 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000007', hoy - 88, 'Envío a La Plata', 'envios', 7500,
     null, null, 'Pedido de Sofía', 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000008', hoy - 60, 'Muselina doble gasa (reposición)', 'materiales', 28000,
     'b0000000-0000-4000-8000-000000000004', 5, null, 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000009', hoy - 45, 'Stickers con el logo', 'packaging', 12000,
     null, null, null, 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000010', hoy - 30, 'Publicidad en Instagram', 'otros', 15000,
     null, null, 'Campaña de una semana', 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000011', hoy - 20, 'Cadete a Córdoba capital', 'envios', 3500,
     null, null, null, 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000012', hoy - 12, 'Muselina para baberos (reposición)', 'materiales', 15600,
     'b0000000-0000-4000-8000-000000000001', 12, null, 'a0000000-0000-4000-8000-000000000001'),
    ('60000000-0000-4000-8000-000000000013', hoy - 5, 'Hilo y agujas', 'materiales', 6000,
     null, null, null, 'a0000000-0000-4000-8000-000000000001');
end;
$$;

alter table public.pedidos enable trigger user;

commit;
