-- ============================================================================
-- Pecora — Migración importar_productos: SKU y carga masiva de productos.
--
-- Qué agrega:
--   1) productos.sku text: opcional, único sin distinguir mayúsculas. Se guarda
--      sin espacios alrededor; vacío -> null. Hasta 64 caracteres.
--   2) importar_productos(p_filas jsonb, p_simular boolean default true)
--      returns jsonb — solo staff (admin o empleado; 42501 para el resto).
--
--      p_filas: array (1..500) de objetos
--        { sku, nombre, descripcion?, precio, stock, categoria?, imagen_url? }
--
--      Por cada fila, por SKU (sin distinguir mayúsculas):
--        * SKU nuevo     -> alta. Obligatorios: nombre, precio, stock.
--        * SKU existente -> actualiza SOLO los campos que vienen con valor
--                           (nombre, descripcion, precio, stock, categoria,
--                           imagen_url). Un campo ausente, null o "" no cambia
--                           nada (así una celda vacía no borra datos).
--      categoria: por nombre (sin distinguir mayúsculas ni espacios de más).
--      Si no existe, se crea (solo cuando p_simular = false).
--      imagen_url: http(s). Pasa a ser la portada (primera de la galería).
--      stock: valor absoluto (reemplaza el actual).
--      precio: número o texto ("1500", "1500.50", "1500,50"), >= 0.
--
--      Devuelve:
--        { simulado, aplicado, nuevos, actualizados,
--          categorias_nuevas: [nombre],
--          errores: [{fila, mensaje}] }
--      fila = posición en p_filas empezando en 1 (la primera fila de datos).
--      Todo o nada: si hay algún error no se escribe nada (aplicado = false)
--      y se devuelven todos los errores. Con p_simular = true (default) nunca
--      escribe: devuelve el plan. Si algo falla al escribir (por ejemplo, otra
--      persona cargó el mismo SKU en ese momento), la función entera se deshace.
--      Errores de estructura (no es un array, vacío, más de 500 filas) -> 22023.
--
-- Nota: cada alta/cambio dispara los eventos de realtime de productos, y una
-- reposición (stock de 0 a > 0) dispara los avisos de "volvió" (avisos_stock).
--
-- Es idempotente. Al final está cómo revertirla.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) productos.sku
-- ----------------------------------------------------------------------------
alter table public.productos add column if not exists sku text;

create or replace function public.productos_normalizar_sku()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.sku := nullif(btrim(new.sku), '');
  return new;
end;
$$;

drop trigger if exists productos_normalizar_sku on public.productos;
create trigger productos_normalizar_sku
  before insert or update of sku on public.productos
  for each row execute function public.productos_normalizar_sku();

do $$
begin
  alter table public.productos
    add constraint productos_sku_valido
    check (sku is null or (btrim(sku) <> '' and length(sku) <= 64));
exception when duplicate_object then null;
end $$;

-- Los NULL no chocan entre sí: los productos sin SKU no se afectan.
create unique index if not exists productos_sku_key on public.productos (upper(sku));

-- ----------------------------------------------------------------------------
-- 2) importar_productos
-- ----------------------------------------------------------------------------
create or replace function public.importar_productos(
  p_filas   jsonb,
  p_simular boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max        constant int := 500;
  v_simular    boolean := coalesce(p_simular, true);
  v_fila       jsonb;
  v_total      int;
  v_errores    jsonb := '[]'::jsonb;
  v_err_fila   text[];
  v_plan       jsonb := '[]'::jsonb;
  v_skus       jsonb := '{}'::jsonb;   -- upper(sku) -> fila donde apareció
  v_cats_nuevas text[] := '{}'::text[];
  v_nuevos     int := 0;
  v_actualiz   int := 0;
  -- valores de la fila
  v_sku        text;
  v_nombre     text;
  v_desc       text;
  v_precio_raw text;
  v_precio     numeric;
  v_stock_raw  text;
  v_stock      int;
  v_cat        text;
  v_img        text;
  v_existente  uuid;
  v_cat_id     uuid;
  v_paso       jsonb;
begin
  if not coalesce(public.es_staff(), false) then
    raise exception 'No autorizado: solo el equipo de la tienda puede importar productos'
      using errcode = '42501';
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'El archivo no tiene el formato esperado (lista de filas).'
      using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_filas);
  if v_total = 0 then
    raise exception 'El archivo no tiene filas para importar.' using errcode = '22023';
  end if;
  if v_total > c_max then
    raise exception 'Se pueden importar hasta % filas por vez (el archivo tiene %).',
      c_max, v_total using errcode = '22023';
  end if;

  -- Dos importaciones a la vez se ordenan (una espera a la otra).
  if not v_simular then
    perform pg_advisory_xact_lock(hashtext('pecora.importar_productos'));
  end if;

  -- --------------------------------------------------------------------------
  -- Pasada 1: validar todo y armar el plan (sin escribir).
  -- --------------------------------------------------------------------------
  for v_n in 1..v_total loop
    v_fila := p_filas -> (v_n - 1);
    v_err_fila := '{}'::text[];

    if jsonb_typeof(v_fila) is distinct from 'object' then
      v_errores := v_errores || jsonb_build_object(
        'fila', v_n, 'mensaje', 'La fila no tiene el formato esperado.');
      continue;
    end if;

    -- Texto de cada campo: strings y números; "" y null = sin valor.
    v_sku   := nullif(btrim(case when jsonb_typeof(v_fila->'sku') in ('string', 'number')
                                 then v_fila->>'sku' end), '');
    v_nombre := nullif(btrim(case when jsonb_typeof(v_fila->'nombre') in ('string', 'number')
                                  then v_fila->>'nombre' end), '');
    v_desc  := nullif(btrim(case when jsonb_typeof(v_fila->'descripcion') in ('string', 'number')
                                 then v_fila->>'descripcion' end), '');
    v_precio_raw := nullif(btrim(case when jsonb_typeof(v_fila->'precio') in ('string', 'number')
                                      then v_fila->>'precio' end), '');
    v_stock_raw := nullif(btrim(case when jsonb_typeof(v_fila->'stock') in ('string', 'number')
                                     then v_fila->>'stock' end), '');
    -- Categoría: espacios internos colapsados ("Bodies  bebé" = "Bodies bebé").
    v_cat   := nullif(regexp_replace(btrim(case when jsonb_typeof(v_fila->'categoria') in ('string', 'number')
                                                then v_fila->>'categoria' end), '\s+', ' ', 'g'), '');
    v_img   := nullif(btrim(case when jsonb_typeof(v_fila->'imagen_url') = 'string'
                                 then v_fila->>'imagen_url' end), '');
    v_precio := null;
    v_stock  := null;
    v_existente := null;

    -- SKU
    if v_sku is null then
      v_err_fila := v_err_fila || text 'Falta el SKU.';
    elsif length(v_sku) > 64 then
      v_err_fila := v_err_fila || text 'El SKU no puede tener más de 64 caracteres.';
    elsif v_skus ? upper(v_sku) then
      v_err_fila := v_err_fila || format('El SKU "%s" está repetido (también en la fila %s).',
                                         v_sku, v_skus->>upper(v_sku));
    else
      v_skus := v_skus || jsonb_build_object(upper(v_sku), v_n);
      select id into v_existente from public.productos where upper(sku) = upper(v_sku);
    end if;

    -- nombre
    if v_nombre is not null and length(v_nombre) > 200 then
      v_err_fila := v_err_fila || text 'El nombre no puede tener más de 200 caracteres.';
    end if;

    -- precio: "1500", "1500.5", "1500,50" (sin separador de miles).
    if v_precio_raw is not null then
      if v_precio_raw ~ '^[0-9]{1,8}([.,][0-9]{1,2})?$' then
        v_precio := replace(v_precio_raw, ',', '.')::numeric;
      elsif v_precio_raw ~ '^-' then
        v_err_fila := v_err_fila || text 'El precio no puede ser negativo.';
      else
        v_err_fila := v_err_fila || format(
          'El precio "%s" no es válido (usá solo números, por ejemplo 1500 o 1500,50).',
          v_precio_raw);
      end if;
    end if;

    -- stock: entero >= 0 (acepta "10" y 10.0).
    if v_stock_raw is not null then
      if v_stock_raw ~ '^[0-9]{1,7}(\.0+)?$' then
        v_stock := v_stock_raw::numeric::int;
      elsif v_stock_raw ~ '^-' then
        v_err_fila := v_err_fila || text 'El stock no puede ser negativo.';
      else
        v_err_fila := v_err_fila || format(
          'El stock "%s" no es válido (tiene que ser un número entero).', v_stock_raw);
      end if;
    end if;

    -- categoría
    if v_cat is not null and length(v_cat) > 100 then
      v_err_fila := v_err_fila || text 'La categoría no puede tener más de 100 caracteres.';
    end if;

    -- imagen
    if v_img is not null and v_img !~* '^https?://[^\s]+$' then
      v_err_fila := v_err_fila || text 'La imagen tiene que ser un link que empiece con http:// o https://.';
    end if;

    -- Obligatorios para un producto nuevo.
    if v_sku is not null and v_existente is null then
      if v_nombre is null then
        v_err_fila := v_err_fila || text 'Falta el nombre (obligatorio para un producto nuevo).';
      end if;
      if v_precio_raw is null then
        v_err_fila := v_err_fila || text 'Falta el precio (obligatorio para un producto nuevo).';
      end if;
      if v_stock_raw is null then
        v_err_fila := v_err_fila || text 'Falta el stock (obligatorio para un producto nuevo).';
      end if;
    end if;

    if cardinality(v_err_fila) > 0 then
      v_errores := v_errores || (
        select coalesce(jsonb_agg(jsonb_build_object('fila', v_n, 'mensaje', m)), '[]'::jsonb)
          from unnest(v_err_fila) m);
      continue;
    end if;

    -- Categoría nueva (una sola vez por nombre).
    if v_cat is not null
       and not exists (select 1 from public.categorias c
                        where lower(regexp_replace(btrim(c.nombre), '\s+', ' ', 'g')) = lower(v_cat))
       and not exists (select 1 from unnest(v_cats_nuevas) x where lower(x) = lower(v_cat)) then
      v_cats_nuevas := v_cats_nuevas || v_cat;
    end if;

    if v_existente is null then
      v_nuevos := v_nuevos + 1;
    else
      v_actualiz := v_actualiz + 1;
    end if;

    v_plan := v_plan || jsonb_build_object(
      'id', v_existente, 'sku', v_sku, 'nombre', v_nombre, 'descripcion', v_desc,
      'precio', v_precio, 'stock', v_stock, 'categoria', v_cat, 'imagen_url', v_img);
  end loop;

  if v_simular or jsonb_array_length(v_errores) > 0 then
    return jsonb_build_object(
      'simulado', v_simular,
      'aplicado', false,
      'nuevos', v_nuevos,
      'actualizados', v_actualiz,
      'categorias_nuevas', to_jsonb(v_cats_nuevas),
      'errores', v_errores);
  end if;

  -- --------------------------------------------------------------------------
  -- Pasada 2: escribir. Cualquier error acá deshace la función entera.
  -- --------------------------------------------------------------------------
  foreach v_cat in array v_cats_nuevas loop
    insert into public.categorias (nombre) values (v_cat);
  end loop;

  for v_paso in select * from jsonb_array_elements(v_plan) loop
    v_cat_id := null;
    if v_paso->>'categoria' is not null then
      select c.id into v_cat_id
        from public.categorias c
       where lower(regexp_replace(btrim(c.nombre), '\s+', ' ', 'g')) = lower(v_paso->>'categoria')
       order by c.created_at, c.id
       limit 1;
    end if;

    if v_paso->>'id' is null then
      insert into public.productos
        (sku, nombre, descripcion, precio, stock, categoria_id, imagen_url, imagenes)
      values
        (v_paso->>'sku', v_paso->>'nombre', v_paso->>'descripcion',
         (v_paso->>'precio')::numeric, (v_paso->>'stock')::int, v_cat_id,
         v_paso->>'imagen_url',
         case when v_paso->>'imagen_url' is null then '{}'::text[]
              else array[v_paso->>'imagen_url'] end);
    else
      update public.productos p
         set nombre       = coalesce(v_paso->>'nombre', p.nombre),
             descripcion  = coalesce(v_paso->>'descripcion', p.descripcion),
             precio       = coalesce((v_paso->>'precio')::numeric, p.precio),
             stock        = coalesce((v_paso->>'stock')::int, p.stock),
             categoria_id = coalesce(v_cat_id, p.categoria_id),
             imagen_url   = coalesce(v_paso->>'imagen_url', p.imagen_url),
             -- La imagen importada pasa a ser la portada; el resto de la
             -- galería se conserva.
             imagenes     = case when v_paso->>'imagen_url' is null then p.imagenes
                                 else array[v_paso->>'imagen_url']
                                      || array_remove(p.imagenes, v_paso->>'imagen_url') end
       where p.id = (v_paso->>'id')::uuid;
    end if;
  end loop;

  return jsonb_build_object(
    'simulado', false,
    'aplicado', true,
    'nuevos', v_nuevos,
    'actualizados', v_actualiz,
    'categorias_nuevas', to_jsonb(v_cats_nuevas),
    'errores', '[]'::jsonb);
end;
$$;

revoke execute on function public.importar_productos(jsonb, boolean) from public, anon;
grant execute on function public.importar_productos(jsonb, boolean) to authenticated;

-- ============================================================================
-- Cómo revertirla (los SKU cargados se pierden):
--
--   begin;
--   drop function if exists public.importar_productos(jsonb, boolean);
--   drop index if exists public.productos_sku_key;
--   drop trigger if exists productos_normalizar_sku on public.productos;
--   drop function if exists public.productos_normalizar_sku();
--   alter table public.productos drop constraint if exists productos_sku_valido;
--   alter table public.productos drop column if exists sku;
--   commit;
--
-- Antes, desplegar el front que no usa sku ni importar_productos.
-- ============================================================================
