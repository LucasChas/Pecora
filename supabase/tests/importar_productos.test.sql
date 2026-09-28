-- ============================================================================
-- pgTAP tests for migration 20260928144838_importar_productos.sql
--   * productos.sku: trimmed, empty -> null, unique case-insensitively
--   * importar_productos: staff only; structural errors (22023); per-row
--     validation with Spanish messages and 1-based `fila`; simulation writes
--     nothing (and is the default); upsert by SKU (insert new, update only
--     the provided fields, categories created by name, image becomes the
--     cover); all-or-nothing (validation errors and write-time failures).
--
-- Run locally with:  supabase db start && supabase test db --local
--
-- Everything runs inside one transaction that is rolled back at the end.
-- auth.uid() reads `request.jwt.claim.sub` on some images and
-- `request.jwt.claims` ->> 'sub' on others, so both are always set.
-- ============================================================================

begin;

select plan(33);

-- ----------------------------------------------------------------------------
-- Fixtures (as postgres).
-- ----------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'clienta@import.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Clienta"}', now(), now()),
  ('e5000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'empleado@import.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Empleado"}', now(), now()),
  ('e5000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@import.test',
   '{"provider":"email","providers":["email"]}', '{"nombre":"Admin"}', now(), now());

update public.profiles set rol = 'empleado' where id = 'e5000000-0000-4000-8000-0000000000e1';
update public.profiles set rol = 'admin'    where id = 'e5000000-0000-4000-8000-0000000000ad';

insert into public.categorias (id, nombre)
values ('ca500000-0000-4000-8000-000000000001', 'Bodies Import');

insert into public.productos
  (id, sku, nombre, descripcion, precio, stock, categoria_id, imagen_url, imagenes)
values
  ('b5000000-0000-4000-8000-000000000001', 'ABC-1', 'Body viejo', 'desc vieja', 100, 0,
   'ca500000-0000-4000-8000-000000000001', 'https://img.test/old.jpg',
   array['https://img.test/old.jpg', 'https://img.test/otra.jpg']);

-- ----------------------------------------------------------------------------
-- productos.sku
-- ----------------------------------------------------------------------------
-- 1
select has_column('public', 'productos', 'sku', 'productos.sku exists');
-- 2
select throws_ok(
  $$ insert into public.productos (nombre, precio, stock, sku) values ('Dup', 1, 1, 'abc-1') $$,
  '23505', null,
  'sku is unique case-insensitively'
);
insert into public.productos (id, nombre, precio, stock, sku) values
  ('b5000000-0000-4000-8000-000000000002', 'Espacios', 1, 1, '  Z-1  '),
  ('b5000000-0000-4000-8000-000000000003', 'Vacio', 1, 1, '   ');
-- 3
select is(
  (select sku from public.productos where id = 'b5000000-0000-4000-8000-000000000002'),
  'Z-1',
  'sku is stored trimmed'
);
-- 4
select is(
  (select sku from public.productos where id = 'b5000000-0000-4000-8000-000000000003'),
  null,
  'an empty sku is stored as null'
);

-- ----------------------------------------------------------------------------
-- Access.
-- ----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.jwt.claim.sub = '';

-- 5
select throws_ok(
  $$ select public.importar_productos('[]'::jsonb) $$,
  '42501', null,
  'anon cannot call importar_productos'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e5000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000001';

-- 6
select throws_ok(
  $$ select public.importar_productos('[{"sku":"X","nombre":"x","precio":1,"stock":1}]'::jsonb, false) $$,
  '42501', 'No autorizado: solo el equipo de la tienda puede importar productos',
  'a customer cannot call importar_productos'
);

-- ----------------------------------------------------------------------------
-- As the empleado.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"e5000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-0000000000e1';

-- 7
select throws_ok(
  $$ select public.importar_productos('{"sku":"X"}'::jsonb) $$,
  '22023', null,
  'p_filas must be an array'
);
-- 8
select throws_ok(
  $$ select public.importar_productos('[]'::jsonb) $$,
  '22023', 'El archivo no tiene filas para importar.',
  'an empty import is rejected'
);
-- 9
select throws_ok(
  $$ select public.importar_productos(
       (select jsonb_agg(jsonb_build_object('sku', 'S' || g, 'nombre', 'n', 'precio', 1, 'stock', 1))
          from generate_series(1, 501) g)) $$,
  '22023', 'Se pueden importar hasta 500 filas por vez (el archivo tiene 501).',
  'more than 500 rows are rejected'
);
-- 10
select is(
  (select jsonb_build_object('nuevos', j->'nuevos', 'errores', j->'errores')
     from (select public.importar_productos(
             (select jsonb_agg(jsonb_build_object('sku', 'S' || g, 'nombre', 'n', 'precio', 1, 'stock', 1))
                from generate_series(1, 500) g)) as j) s),
  '{"nuevos":500,"errores":[]}'::jsonb,
  '500 rows are accepted'
);

-- The valid file used below: one update (price only, Spanish decimal comma),
-- one new product in a new category, one new product in an existing category
-- (matched case-insensitively and with extra spaces).
create temp table archivo as select '[
  {"sku":"abc-1","precio":"150,50"},
  {"sku":"NEW-1","nombre":"Nuevo uno","precio":200,"stock":3,"categoria":"Accesorios  Import ","imagen_url":"https://img.test/n1.jpg"},
  {"sku":"NEW-2","nombre":"Nuevo dos","descripcion":"Algodón","precio":"300","stock":"0","categoria":"bodies import"}
]'::jsonb as filas;

-- 11
select is(
  public.importar_productos((select filas from archivo)),
  '{"simulado":true,"aplicado":false,"nuevos":2,"actualizados":1,
    "categorias_nuevas":["Accesorios Import"],"errores":[]}'::jsonb,
  'simulation (the default) returns the plan'
);
-- 12
select is(
  (select jsonb_build_object(
     'nuevos', (select count(*) from public.productos where upper(sku) in ('NEW-1', 'NEW-2')),
     'categoria', (select count(*) from public.categorias where nombre = 'Accesorios Import'),
     'precio', (select precio from public.productos where sku = 'ABC-1'))),
  '{"nuevos":0,"categoria":0,"precio":100.00}'::jsonb,
  'simulation writes nothing'
);

-- Validation errors (fila is 1-based: the first element is fila 1).
create temp table archivo_malo as select '[
  {"nombre":"Sin sku","precio":1,"stock":1},
  {"sku":"E1","nombre":"x","precio":"abc","stock":1},
  {"sku":"E2","nombre":"x","precio":-5,"stock":1},
  {"sku":"E3","nombre":"x","precio":10,"stock":1.5},
  {"sku":"E4"},
  {"sku":"e1","nombre":"x","precio":1,"stock":1},
  "texto",
  {"sku":"E5","nombre":"x","precio":1,"stock":1,"imagen_url":"ftp://img.test/x.jpg"},
  {"sku":"ABC-1"},
  {"sku":"NEW-3","nombre":"Válido","precio":1,"stock":1}
]'::jsonb as filas;

create temp table res_malo as
  select public.importar_productos((select filas from archivo_malo), false) as j;

-- 13
select results_eq(
  $$ select e.fila, e.mensaje
       from res_malo, jsonb_to_recordset(res_malo.j->'errores') as e(fila int, mensaje text)
      order by e.fila, e.mensaje $$,
  $$ values
       (1, 'Falta el SKU.'),
       (2, 'El precio "abc" no es válido (usá solo números, por ejemplo 1500 o 1500,50).'),
       (3, 'El precio no puede ser negativo.'),
       (4, 'El stock "1.5" no es válido (tiene que ser un número entero).'),
       (5, 'Falta el nombre (obligatorio para un producto nuevo).'),
       (5, 'Falta el precio (obligatorio para un producto nuevo).'),
       (5, 'Falta el stock (obligatorio para un producto nuevo).'),
       (6, 'El SKU "e1" está repetido (también en la fila 2).'),
       (7, 'La fila no tiene el formato esperado.'),
       (8, 'La imagen tiene que ser un link que empiece con http:// o https://.') $$,
  'every invalid row is reported with its 1-based fila and a Spanish message'
);
-- 14
select is(
  (select j - 'errores' from res_malo),
  '{"simulado":false,"aplicado":false,"nuevos":1,"actualizados":1,"categorias_nuevas":[]}'::jsonb,
  'with errors, a real import is not applied'
);
-- 15
select is(
  (select count(*)::int from public.productos where upper(sku) in ('NEW-3', 'E1', 'E2', 'E5')),
  0,
  'all or nothing: the valid rows of a file with errors are not written'
);

-- Real import of the valid file.
create temp table res_ok as
  select public.importar_productos((select filas from archivo), false) as j;

-- 16
select is(
  (select j from res_ok),
  '{"simulado":false,"aplicado":true,"nuevos":2,"actualizados":1,
    "categorias_nuevas":["Accesorios Import"],"errores":[]}'::jsonb,
  'the empleado imports the file'
);
-- 17
select results_eq(
  $$ select nombre, descripcion, precio, stock, categoria_id, imagen_url, imagenes
       from public.productos where sku = 'ABC-1' $$,
  $$ values ('Body viejo'::text, 'desc vieja'::text, 150.50::numeric(10,2), 0,
             'ca500000-0000-4000-8000-000000000001'::uuid, 'https://img.test/old.jpg'::text,
             array['https://img.test/old.jpg', 'https://img.test/otra.jpg']) $$,
  'an existing product: only the provided fields change (precio), matched by SKU case-insensitively'
);
-- 18
select results_eq(
  $$ select p.nombre, p.descripcion, p.precio, p.stock, c.nombre, p.imagen_url, p.imagenes,
            p.slug is not null
       from public.productos p join public.categorias c on c.id = p.categoria_id
      where p.sku = 'NEW-1' $$,
  $$ values ('Nuevo uno'::text, null::text, 200.00::numeric(10,2), 3, 'Accesorios Import'::text,
             'https://img.test/n1.jpg'::text, array['https://img.test/n1.jpg'], true) $$,
  'a new product with a new category (created once, spaces collapsed) and its image as cover'
);
-- 19
select results_eq(
  $$ select p.nombre, p.descripcion, p.precio, p.stock, p.categoria_id, p.imagenes
       from public.productos p where p.sku = 'NEW-2' $$,
  $$ values ('Nuevo dos'::text, 'Algodón'::text, 300.00::numeric(10,2), 0,
             'ca500000-0000-4000-8000-000000000001'::uuid, '{}'::text[]) $$,
  'a new product in an existing category matched case-insensitively'
);
-- 20
select is(
  (select count(*)::int from public.categorias where lower(nombre) = 'accesorios import'),
  1,
  'the new category exists once'
);

-- Second import: update the image, stock and name; empty strings keep data.
-- 21
select is(
  public.importar_productos('[
    {"sku":"ABC-1","nombre":"Body nuevo","descripcion":"","stock":5,
     "imagen_url":"https://img.test/otra.jpg","categoria":"Accesorios Import"}
  ]'::jsonb, false) - 'errores',
  '{"simulado":false,"aplicado":true,"nuevos":0,"actualizados":1,"categorias_nuevas":[]}'::jsonb,
  'a second import updates the existing product'
);
-- 22
select results_eq(
  $$ select p.nombre, p.descripcion, p.stock, c.nombre, p.imagen_url, p.imagenes
       from public.productos p join public.categorias c on c.id = p.categoria_id
      where p.sku = 'ABC-1' $$,
  $$ values ('Body nuevo'::text, 'desc vieja'::text, 5, 'Accesorios Import'::text,
             'https://img.test/otra.jpg'::text,
             array['https://img.test/otra.jpg', 'https://img.test/old.jpg']) $$,
  'the imported image becomes the cover without duplicates; "" does not clear descripcion'
);
-- 23
select is(
  (select stock from public.productos where sku = 'ABC-1'),
  5,
  'stock is replaced (absolute value)'
);

-- Write-time failure (simulated with a trigger): nothing stays written.
reset role;
create function pg_temp.explotar() returns trigger language plpgsql as $$
begin
  if new.nombre = 'BOOM' then
    raise exception 'falla simulada';
  end if;
  return new;
end;
$$;
create trigger explotar before insert or update on public.productos
  for each row execute function pg_temp.explotar();
set local role authenticated;

-- 24
select throws_ok(
  $$ select public.importar_productos('[
       {"sku":"NEW-4","nombre":"Antes del error","precio":1,"stock":1,"categoria":"Categoria efimera"},
       {"sku":"ABC-1","precio":999},
       {"sku":"NEW-5","nombre":"BOOM","precio":1,"stock":1}
     ]'::jsonb, false) $$,
  'P0001', 'falla simulada',
  'an error while writing aborts the import'
);
-- 25
select is(
  (select jsonb_build_object(
     'nuevo', (select count(*) from public.productos where sku = 'NEW-4'),
     'categoria', (select count(*) from public.categorias where nombre = 'Categoria efimera'),
     'precio', (select precio from public.productos where sku = 'ABC-1'))),
  '{"nuevo":0,"categoria":0,"precio":150.50}'::jsonb,
  'all or nothing: rows and categories written before the failure are rolled back'
);

reset role;
drop trigger explotar on public.productos;
set local role authenticated;

-- 26 (numbers as text and 10.0 as stock are accepted)
select is(
  public.importar_productos('[{"sku":"NUM-1","nombre":"Num","precio":"1500.5","stock":10.0}]'::jsonb)
    -> 'errores',
  '[]'::jsonb,
  'precio "1500.5" and stock 10.0 are valid'
);
-- 27
select is(
  (public.importar_productos('[{"sku":"LARGO","nombre":"x","precio":123456789,"stock":1}]'::jsonb)
    -> 'errores' -> 0 ->> 'mensaje'),
  'El precio "123456789" no es válido (usá solo números, por ejemplo 1500 o 1500,50).',
  'a price that does not fit numeric(10,2) is rejected'
);
-- 28
select is(
  (public.importar_productos(jsonb_build_array(jsonb_build_object(
     'sku', repeat('x', 65), 'nombre', 'x', 'precio', 1, 'stock', 1))) -> 'errores' -> 0 ->> 'mensaje'),
  'El SKU no puede tener más de 64 caracteres.',
  'a SKU longer than 64 characters is rejected'
);
-- 29
select is(
  (public.importar_productos('[{"sku":"NEG","nombre":"x","precio":1,"stock":-1}]'::jsonb)
    -> 'errores' -> 0 ->> 'mensaje'),
  'El stock no puede ser negativo.',
  'a negative stock is rejected'
);
-- 30
select is(
  (public.importar_productos('[{"sku":"  ","nombre":"x","precio":1,"stock":1}]'::jsonb)
    -> 'errores' -> 0 ->> 'mensaje'),
  'Falta el SKU.',
  'a blank SKU counts as missing'
);

-- ----------------------------------------------------------------------------
-- As the admin.
-- ----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"e5000000-0000-4000-8000-0000000000ad","role":"authenticated"}';
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-0000000000ad';

-- 31
select is(
  (public.importar_productos('[{"sku":"ADM-1","nombre":"De la admin","precio":10,"stock":1}]'::jsonb, false))
    ->> 'aplicado',
  'true',
  'the admin can import too'
);
-- 32
select is(
  (select nombre from public.productos where sku = 'ADM-1'),
  'De la admin',
  'the admin import is written'
);

-- ----------------------------------------------------------------------------
-- Schema (as postgres).
-- ----------------------------------------------------------------------------
reset role;
-- 33
select is(
  (select prosecdef from pg_proc where oid = to_regprocedure('public.importar_productos(jsonb,boolean)')),
  true,
  'importar_productos is SECURITY DEFINER (checks es_staff itself)'
);

select * from finish();

rollback;
