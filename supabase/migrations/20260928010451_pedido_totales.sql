-- ============================================================================
-- Pecora — Migración pedido_totales: descuento, envío y total del pedido,
-- provincia, idempotencia de crear_pedido y marcas de "mail enviado".
--
-- Qué cambia:
--   1) pedidos, columnas nuevas:
--        descuento, costo_envio   Los carga la admin desde el panel. >= 0.
--        total                    Generada: subtotal - descuento + costo_envio.
--                                 Nadie la escribe; la calcula la base.
--        provincia                Dato de entrega que faltaba.
--        idempotency_key          Clave (uuid) que genera el checkout. Un doble
--                                 click o un reintento de red con la misma clave
--                                 devuelve el mismo pedido en vez de crear otro
--                                 (y de descontar el stock dos veces).
--        email_enviado_at         Los setea la Edge Function enviar-recibo-pedido
--        aviso_duena_enviado_at   después de mandar cada mail. Si la función se
--                                 vuelve a invocar, no reenvía.
--   2) productos: check (precio >= 0).
--   3) crear_pedido: firma nueva (13 parámetros; los 3 últimos con default).
--        - origen 'admin' solo si quien llama es admin. Antes cualquier clienta
--          podía mandar p_origen = 'admin' y marcar su pedido como carga manual.
--        - Idempotencia por p_idempotency_key (ver arriba).
--        - Guarda la provincia.
--      Stock y precios: igual que la 0013. El stock se descuenta en la base, los
--      precios y el subtotal salen de productos y p_subtotal se sigue ignorando
--      (queda en la firma solo por compatibilidad con el front).
--
-- Compatibilidad: los parámetros nuevos tienen default, así que el front que
-- llama con 11 parámetros por nombre sigue funcionando con esta función. Se
-- puede aplicar la base antes de desplegar el front nuevo.
--
-- Es idempotente: se puede correr más de una vez. Al final está cómo revertirla.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) pedidos: columnas nuevas.
-- ----------------------------------------------------------------------------
alter table public.pedidos
  add column if not exists descuento              numeric(12,2) not null default 0,
  add column if not exists costo_envio            numeric(12,2) not null default 0,
  add column if not exists provincia              text,
  add column if not exists idempotency_key        uuid,
  add column if not exists email_enviado_at       timestamptz,
  add column if not exists aviso_duena_enviado_at timestamptz;

-- Columna generada aparte: tiene que existir todo lo que referencia.
alter table public.pedidos
  add column if not exists total numeric(12,2)
    generated always as (subtotal - descuento + costo_envio) stored;

do $$
begin
  alter table public.pedidos
    add constraint pedidos_descuento_no_negativo check (descuento >= 0);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pedidos
    add constraint pedidos_costo_envio_no_negativo check (costo_envio >= 0);
exception when duplicate_object then null;
end $$;

-- Los NULL no chocan entre sí en un índice único: los pedidos sin clave
-- (cargas manuales viejas, pedidos anteriores a esta migración) no se afectan.
create unique index if not exists pedidos_idempotency_key_key
  on public.pedidos (idempotency_key);

-- ----------------------------------------------------------------------------
-- 2) productos: el precio no puede ser negativo.
--
-- Si en producción hubiera algún producto con precio negativo, esta sentencia
-- falla y la migración entera se deshace (no queda nada a medias). Para ver
-- cuáles son antes de aplicarla:
--   select id, nombre, precio from public.productos where precio < 0;
-- ----------------------------------------------------------------------------
do $$
begin
  alter table public.productos
    add constraint productos_precio_no_negativo check (precio >= 0);
exception when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 3) crear_pedido con la firma nueva.
--
-- Se borra la firma de la 0013 (11 parámetros) en vez de dejar dos versiones:
-- con dos sobrecargas, PostgREST no sabría cuál llamar.
-- ----------------------------------------------------------------------------
drop function if exists public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text
);

create or replace function public.crear_pedido(
  p_nombre          text,
  p_telefono        text,
  p_email           text,
  p_entrega         text,
  p_direccion       text,
  p_localidad       text,
  p_cp              text,
  p_notas           text,
  p_items           jsonb,
  p_subtotal        numeric,
  p_origen          text default 'checkout',
  p_provincia       text default null,
  p_idempotency_key uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero   bigint;
  v_uid      uuid := auth.uid();
  v_duena    uuid;
  v_origen   text;
  v_item     jsonb;
  v_id       uuid;
  v_cantidad int;
  v_nombre   text;
  v_precio   numeric;
  v_stock    int;
  v_items    jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para hacer un pedido.';
  end if;

  -- Idempotencia. El lock serializa dos llamadas con la misma clave (doble
  -- click): la segunda espera a que termine la primera y, al seguir, ya ve el
  -- pedido creado. Se libera solo al terminar la transacción.
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(p_idempotency_key::text));

    select numero, user_id into v_numero, v_duena
      from public.pedidos
     where idempotency_key = p_idempotency_key;

    if found then
      if v_duena is distinct from v_uid then
        -- La clave es de otra cuenta. No se revela nada del pedido ajeno.
        raise exception 'No se pudo registrar el pedido. Recargá la página y volvé a intentar.';
      end if;
      -- Mismo pedido, misma clienta: se devuelve el número sin tocar el stock.
      return v_numero;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Tu carrito está vacío.';
  end if;

  -- Solo la admin puede registrar un pedido como carga manual.
  v_origen := case
    when public.es_admin() then coalesce(nullif(p_origen, ''), 'checkout')
    else 'checkout'
  end;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_id := (v_item->>'id')::uuid;
    v_cantidad := coalesce((v_item->>'cantidad')::int, 0);

    if v_cantidad <= 0 then
      raise exception 'La cantidad de uno de los productos no es válida.';
    end if;

    -- Descuenta el stock y lee el precio vigente en una sola operación. El
    -- "and stock >= v_cantidad" frena a dos clientas comprando la última unidad
    -- al mismo tiempo: la segunda no matchea ninguna fila y el pedido se corta.
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

  insert into public.pedidos
    (user_id, nombre, telefono, email, entrega, direccion, localidad, cp,
     provincia, notas, items, subtotal, origen, idempotency_key)
  values
    (v_uid, p_nombre, p_telefono, nullif(p_email, ''),
     coalesce(nullif(p_entrega, ''), 'coordinar'),
     p_direccion, p_localidad, p_cp, nullif(p_provincia, ''), p_notas,
     v_items, v_subtotal, v_origen, p_idempotency_key)
  returning numero into v_numero;

  return v_numero;
end;
$$;

-- Las funciones nacen con EXECUTE para PUBLIC (y Supabase además se lo da a
-- anon). Solo las cuentas logueadas pueden crear pedidos.
revoke execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid
) from public, anon;
grant execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid
) to authenticated;

-- ============================================================================
-- Cómo revertirla (hacer un backup antes). Vuelve a la crear_pedido de la 0013
-- y borra las columnas nuevas, CON sus datos (descuentos, envíos, provincias):
--
--   begin;
--   drop function if exists public.crear_pedido(
--     text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid);
--   -- Pegar acá la definición de crear_pedido de 0013_origen_pedido.sql
--   -- (create function + revoke/grant).
--   alter table public.pedidos
--     drop column if exists total,
--     drop column if exists descuento,
--     drop column if exists costo_envio,
--     drop column if exists provincia,
--     drop column if exists idempotency_key,
--     drop column if exists email_enviado_at,
--     drop column if exists aviso_duena_enviado_at;
--   alter table public.productos drop constraint if exists productos_precio_no_negativo;
--   commit;
--
-- Antes de revertir, desplegar la versión anterior de la Edge Function
-- enviar-recibo-pedido: la nueva lee estas columnas.
-- ============================================================================
