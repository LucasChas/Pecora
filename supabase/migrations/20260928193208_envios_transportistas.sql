-- ============================================================================
-- Pecora — Migración envios_transportistas: cotización con Andreani y Correo
-- Argentino.
--
--   1) productos: peso_g (gramos) y alto_cm / ancho_cm / largo_cm, opcionales
--      y > 0. Los edita el staff con las policies existentes de productos.
--      (importar_productos todavía no los carga: queda como pendiente.)
--   2) cotizaciones_envio: cada opción que devuelve la Edge Function
--      cotizar-envio (transportista, servicio, sucursal, precio, plazo) para
--      un CP / provincia / carrito. Vence a los 30 minutos y se usa una sola
--      vez. RLS activado y SIN policies: anon y authenticated no la leen ni
--      la escriben; solo service_role (la Edge Function) inserta.
--   3) pedidos: transportista, servicio_envio, sucursal_envio (texto con el id
--      y el nombre/dirección de la sucursal al momento de comprar) y
--      cotizacion_envio_id.
--   4) crear_pedido con un parámetro más al final, p_cotizacion_envio uuid
--      default null (15 parámetros). Se borra la firma de 14 para que
--      PostgREST no tenga dos sobrecargas.
--        - null: exactamente la lógica por zona de siempre.
--        - con valor y entrega = 'envio': bloquea la cotización y exige que
--          exista, no esté vencida ni usada, y que CP, provincia y productos /
--          cantidades coincidan con el pedido. costo_envio = precio de la
--          cotización (un cupón de envío gratis lo sigue dejando en 0). Guarda
--          transportista / servicio / sucursal y marca la cotización como
--          usada. Si no vale: error 22023 con un mensaje para la clienta.
--        - con valor y entrega = 'coordinar': se ignora (no hay envío).
--
-- Tests: supabase/tests/envios_transportistas.test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) productos: peso y medidas para cotizar.
-- ----------------------------------------------------------------------------
alter table public.productos
  add column if not exists peso_g   integer,
  add column if not exists alto_cm  numeric(6,1),
  add column if not exists ancho_cm numeric(6,1),
  add column if not exists largo_cm numeric(6,1);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'productos_peso_g_positivo'
                    and conrelid = 'public.productos'::regclass) then
    alter table public.productos
      add constraint productos_peso_g_positivo check (peso_g is null or peso_g > 0);
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'productos_medidas_positivas'
                    and conrelid = 'public.productos'::regclass) then
    alter table public.productos
      add constraint productos_medidas_positivas check (
        (alto_cm  is null or alto_cm  > 0) and
        (ancho_cm is null or ancho_cm > 0) and
        (largo_cm is null or largo_cm > 0)
      );
  end if;
end $$;

comment on column public.productos.peso_g is
  'Peso en gramos (con embalaje) para cotizar envíos. Null = peso por defecto de la Edge Function.';
comment on column public.productos.alto_cm is 'Alto en cm para cotizar envíos (null = medida por defecto).';
comment on column public.productos.ancho_cm is 'Ancho en cm para cotizar envíos (null = medida por defecto).';
comment on column public.productos.largo_cm is 'Largo en cm para cotizar envíos (null = medida por defecto).';

-- ----------------------------------------------------------------------------
-- 2) cotizaciones_envio
-- ----------------------------------------------------------------------------
create table if not exists public.cotizaciones_envio (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  expira_at         timestamptz not null default now() + interval '30 minutes',
  cp_destino        text not null,
  provincia         text not null,
  transportista     text not null,
  servicio          text not null,
  sucursal_id       text,
  -- Nombre y dirección de la sucursal, para la foto que queda en el pedido.
  sucursal_detalle  text,
  precio            numeric(12,2) not null,
  plazo             text,
  -- [{producto_id, cantidad}] agrupado por producto y ordenado por producto_id.
  items             jsonb not null,
  usada_at          timestamptz,
  constraint cotizaciones_envio_cp_valido check (cp_destino ~ '^[0-9]{4}$'),
  constraint cotizaciones_envio_provincia_no_vacia check (btrim(provincia) <> ''),
  constraint cotizaciones_envio_transportista_valido
    check (transportista in ('andreani', 'correo_argentino')),
  constraint cotizaciones_envio_servicio_valido
    check (servicio in ('domicilio', 'sucursal')),
  constraint cotizaciones_envio_sucursal_segun_servicio
    check ((servicio = 'sucursal') = (sucursal_id is not null)),
  constraint cotizaciones_envio_precio_no_negativo check (precio >= 0),
  constraint cotizaciones_envio_items_array
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0)
);

create index if not exists cotizaciones_envio_expira_at_idx
  on public.cotizaciones_envio (expira_at);

alter table public.cotizaciones_envio enable row level security;

-- Sin policies a propósito. Además se sacan los permisos de tabla (el
-- proyecto expone las tablas nuevas por defecto, ver config.toml).
revoke all on table public.cotizaciones_envio from public, anon, authenticated;
grant select, insert, update, delete on table public.cotizaciones_envio to service_role;

-- ----------------------------------------------------------------------------
-- 3) pedidos: datos del transportista elegido.
-- ----------------------------------------------------------------------------
alter table public.pedidos
  add column if not exists transportista       text,
  add column if not exists servicio_envio      text,
  add column if not exists sucursal_envio      text,
  add column if not exists cotizacion_envio_id uuid
    references public.cotizaciones_envio (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pedidos_transportista_valido'
                    and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos
      add constraint pedidos_transportista_valido
      check (transportista is null or transportista in ('andreani', 'correo_argentino'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'pedidos_servicio_envio_valido'
                    and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos
      add constraint pedidos_servicio_envio_valido
      check (servicio_envio is null or servicio_envio in ('domicilio', 'sucursal'));
  end if;
end $$;

-- Una cotización corresponde a un solo pedido.
create unique index if not exists pedidos_cotizacion_envio_id_key
  on public.pedidos (cotizacion_envio_id) where cotizacion_envio_id is not null;

-- ----------------------------------------------------------------------------
-- 4) crear_pedido con 15 parámetros.
-- ----------------------------------------------------------------------------
drop function if exists public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text
);

create or replace function public.crear_pedido(
  p_nombre           text,
  p_telefono         text,
  p_email            text,
  p_entrega          text,
  p_direccion        text,
  p_localidad        text,
  p_cp               text,
  p_notas            text,
  p_items            jsonb,
  p_subtotal         numeric,
  p_origen           text default 'checkout',
  p_provincia        text default null,
  p_idempotency_key  uuid default null,
  p_cupon            text default null,
  p_cotizacion_envio uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero        bigint;
  v_pedido_id     uuid;
  v_uid           uuid := auth.uid();
  v_duena         uuid;
  v_origen        text;
  v_entrega       text;
  v_item          jsonb;
  v_id            uuid;
  v_cantidad      int;
  v_nombre        text;
  v_precio        numeric;
  v_stock         int;
  v_items         jsonb := '[]'::jsonb;
  v_subtotal      numeric := 0;
  v_zona          public.zonas_envio%rowtype;
  v_costo_envio   numeric := 0;
  v_descuento     numeric := 0;
  v_cupon         jsonb;
  v_cupon_id      uuid;
  v_cupon_cod     text;
  v_manual        boolean;
  v_cot           public.cotizaciones_envio%rowtype;
  v_cot_usada     boolean := false;
  v_transportista text;
  v_servicio      text;
  v_sucursal      text;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para hacer un pedido.';
  end if;

  -- Idempotencia. El lock serializa dos llamadas con la misma clave (doble
  -- click): la segunda espera a que termine la primera y, al seguir, ya ve el
  -- pedido creado. Un reintento no vuelve a contar el uso del cupón ni vuelve
  -- a validar la cotización (que ya quedó usada por el primer intento).
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(p_idempotency_key::text));

    select numero, user_id into v_numero, v_duena
      from public.pedidos
     where idempotency_key = p_idempotency_key;

    if found then
      if v_duena is distinct from v_uid then
        raise exception 'No se pudo registrar el pedido. Recargá la página y volvé a intentar.';
      end if;
      return v_numero;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Tu carrito está vacío.';
  end if;

  -- Carga manual: la puede hacer el staff (admin o empleado).
  v_origen := case
    when public.es_staff() then coalesce(nullif(p_origen, ''), 'checkout')
    else 'checkout'
  end;
  v_entrega := coalesce(nullif(p_entrega, ''), 'coordinar');
  -- Pedido manual: lo carga el staff para una clienta. v_origen solo puede ser
  -- 'admin' si es_staff(), pero se vuelve a chequear por claridad.
  v_manual := v_origen = 'admin' and coalesce(public.es_staff(), false);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_id := (v_item->>'id')::uuid;
    v_cantidad := coalesce((v_item->>'cantidad')::int, 0);

    if v_cantidad <= 0 then
      raise exception 'La cantidad de uno de los productos no es válida.';
    end if;

    update public.productos
       set stock = stock - v_cantidad
     where id = v_id
       and stock >= v_cantidad
    returning nombre, precio into v_nombre, v_precio;

    if not found then
      select nombre, stock into v_nombre, v_stock
        from public.productos where id = v_id;
      if v_nombre is null then
        raise exception 'Uno de los productos de tu carrito ya no está disponible.';
      end if;
      raise exception 'De "%" nos %. Ajustá la cantidad y volvé a intentar.',
        v_nombre,
        case when v_stock = 1 then 'queda 1 unidad'
             else 'quedan ' || v_stock || ' unidades' end;
    end if;

    v_subtotal := v_subtotal + v_precio * v_cantidad;
    v_items := v_items || jsonb_build_object(
      'id', v_id, 'nombre', v_nombre, 'precio', v_precio, 'cantidad', v_cantidad
    );
  end loop;

  if v_entrega = 'envio' and p_cotizacion_envio is not null then
    -- Envío con transportista: el precio sale de la cotización guardada por
    -- la Edge Function cotizar-envio. La fila se bloquea para que dos pedidos
    -- no usen la misma cotización.
    select * into v_cot from public.cotizaciones_envio
     where id = p_cotizacion_envio
       for update;

    if not found then
      raise exception 'La cotización del envío no es válida. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;
    if v_cot.usada_at is not null then
      raise exception 'La cotización del envío ya se usó en otro pedido. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;
    if v_cot.expira_at <= now() then
      raise exception 'La cotización del envío venció. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;
    if public.normalizar_cp(p_cp) is distinct from v_cot.cp_destino
       or public.slugify(p_provincia) is distinct from public.slugify(v_cot.provincia) then
      raise exception 'El código postal o la provincia no coinciden con los del envío cotizado. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;
    -- Mismos productos y cantidades (agrupados por producto, sin importar el
    -- orden ni si un producto vino repetido en el carrito).
    if (select coalesce(jsonb_agg(jsonb_build_array(pid, cant) order by pid), '[]'::jsonb)
          from (select (e->>'id')::uuid as pid, sum((e->>'cantidad')::int) as cant
                  from jsonb_array_elements(p_items) e group by 1) pedido)
       is distinct from
       (select coalesce(jsonb_agg(jsonb_build_array(pid, cant) order by pid), '[]'::jsonb)
          from (select c.producto_id as pid, sum(c.cantidad) as cant
                  from jsonb_to_recordset(v_cot.items) as c(producto_id uuid, cantidad int)
                 group by 1) cotizado) then
      raise exception 'Tu carrito cambió desde que cotizaste el envío. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;

    v_costo_envio   := v_cot.precio;
    v_transportista := v_cot.transportista;
    v_servicio      := v_cot.servicio;
    v_sucursal      := case when v_cot.sucursal_id is null then null
                            else concat_ws(' — ', v_cot.sucursal_id, v_cot.sucursal_detalle) end;
    v_cot_usada     := true;
  elsif v_entrega = 'envio' then
    -- Envío por zona: misma lógica que cotizar_envio. Sin zona -> 0 (se coordina).
    select * into v_zona from public.zonas_envio
     where id = public.buscar_zona_envio(p_provincia, p_cp);
    if found then
      v_costo_envio := case
        when v_zona.gratis_desde is not null and v_subtotal >= v_zona.gratis_desde then 0
        else v_zona.precio
      end;
    end if;
  end if;

  -- Cupón: misma lógica que validar_cupon, con la fila del cupón bloqueada.
  -- Si no vale, el error deshace todo (incluido el stock ya descontado). En un
  -- pedido manual no hay chequeos por clienta (quien llama es el staff).
  if nullif(btrim(coalesce(p_cupon, '')), '') is not null then
    v_cupon := public.evaluar_cupon(p_cupon, v_subtotal, v_uid, true, v_manual);
    if not (v_cupon->>'valido')::boolean then
      raise exception '%', v_cupon->>'mensaje';
    end if;
    v_cupon_id  := (v_cupon->>'cupon_id')::uuid;
    v_cupon_cod := v_cupon->>'codigo';
    v_descuento := (v_cupon->>'descuento')::numeric;
    if (v_cupon->>'envio_gratis')::boolean then
      v_costo_envio := 0;
    end if;
  end if;

  insert into public.pedidos
    (user_id, nombre, telefono, email, entrega, direccion, localidad, cp,
     provincia, notas, items, subtotal, origen, idempotency_key,
     descuento, costo_envio, cupon_id, cupon_codigo, zona_id, zona_nombre,
     transportista, servicio_envio, sucursal_envio, cotizacion_envio_id)
  values
    (v_uid, p_nombre, p_telefono, nullif(p_email, ''), v_entrega,
     p_direccion, p_localidad, p_cp, nullif(p_provincia, ''), p_notas,
     v_items, v_subtotal, v_origen, p_idempotency_key,
     v_descuento, v_costo_envio, v_cupon_id, v_cupon_cod, v_zona.id, v_zona.nombre,
     v_transportista, v_servicio, v_sucursal,
     case when v_cot_usada then v_cot.id end)
  returning id, numero into v_pedido_id, v_numero;

  if v_cot_usada then
    update public.cotizaciones_envio set usada_at = now() where id = v_cot.id;
  end if;

  if v_cupon_id is not null then
    -- Pedido manual: user_id null, así no consume el cupo por clienta de quien
    -- lo cargó (sí cuenta para usos_max).
    insert into public.cupon_usos (cupon_id, pedido_id, user_id)
    values (v_cupon_id, v_pedido_id, case when v_manual then null else v_uid end);
  end if;

  return v_numero;
end;
$$;

revoke execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text, uuid
) from public, anon;
grant execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text, uuid
) to authenticated;

-- ----------------------------------------------------------------------------
-- Volver atrás (a mano, en este orden):
--   1) recrear crear_pedido de 14 parámetros (copiar la de
--      20260928144833_roles_empleados.sql) después de
--        drop function public.crear_pedido(text, text, text, text, text, text,
--          text, text, jsonb, numeric, text, text, uuid, text, uuid);
--   2) drop index if exists public.pedidos_cotizacion_envio_id_key;
--      alter table public.pedidos drop column if exists cotizacion_envio_id,
--        drop column if exists sucursal_envio, drop column if exists servicio_envio,
--        drop column if exists transportista;
--   3) drop table if exists public.cotizaciones_envio;
--   4) alter table public.productos drop constraint if exists productos_medidas_positivas,
--        drop constraint if exists productos_peso_g_positivo,
--        drop column if exists largo_cm, drop column if exists ancho_cm,
--        drop column if exists alto_cm, drop column if exists peso_g;
-- ----------------------------------------------------------------------------
