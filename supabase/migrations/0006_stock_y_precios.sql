-- ============================================================================
-- Pecora — Migración 0006: el pedido descuenta stock y se arma con los precios
-- de la base.
--
-- Por qué:
--   1) Hasta ahora crear_pedido registraba el pedido pero NO tocaba el stock.
--      Con 3 unidades se podían vender 3 veces 3: la disponibilidad del
--      muestrario (stock > 0) mentía y había que descontar a mano en el panel.
--   2) El precio y el subtotal llegaban tal cual desde el navegador. Con la anon
--      key (que es pública por diseño) cualquiera podía registrar un pedido de $1.
--      Hoy lo salva que la admin cobra por WhatsApp, pero con MercadoPago sería
--      un agujero de cobro.
--
-- La función sigue siendo SECURITY DEFINER: corre con permisos del dueño, así que
-- puede tocar productos aunque la escritura esté reservada a la admin (RLS).
-- Todo pasa dentro de una transacción: si un ítem falla, se deshace el pedido
-- entero y los descuentos de los ítems anteriores.
--
-- La firma NO cambia (mismos parámetros), así que el front sigue funcionando sin
-- tocar nada. p_precio de cada ítem y p_subtotal ahora se IGNORAN: son datos del
-- cliente y no se pueden confiar.
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- ============================================================================

create or replace function public.crear_pedido(
  p_nombre    text,
  p_telefono  text,
  p_email     text,
  p_entrega   text,
  p_direccion text,
  p_localidad text,
  p_cp        text,
  p_notas     text,
  p_items     jsonb,
  p_subtotal  numeric
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero   bigint;
  v_uid      uuid := auth.uid();
  v_item     jsonb;
  v_id       uuid;
  v_cantidad int;
  v_nombre   text;
  v_precio   numeric;
  v_stock    int;
  -- Ítems reconstruidos con los datos de la base (no los que mandó el navegador).
  v_items    jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para hacer un pedido.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Tu carrito está vacío.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_id := (v_item->>'id')::uuid;
    v_cantidad := coalesce((v_item->>'cantidad')::int, 0);

    if v_cantidad <= 0 then
      raise exception 'La cantidad de uno de los productos no es válida.';
    end if;

    -- Descontamos el stock y leemos el precio vigente en UNA sola operación.
    -- El "and stock >= v_cantidad" es la protección contra dos clientas
    -- comprando la última unidad al mismo tiempo: la segunda no matchea ninguna
    -- fila y el pedido se corta entero.
    update public.productos
       set stock = stock - v_cantidad
     where id = v_id
       and stock >= v_cantidad
    returning nombre, precio into v_nombre, v_precio;

    if not found then
      -- No se pudo descontar: o el producto ya no existe, o no alcanza el stock.
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
    (user_id, nombre, telefono, email, entrega, direccion, localidad, cp, notas, items, subtotal)
  values
    (v_uid, p_nombre, p_telefono, nullif(p_email, ''),
     coalesce(nullif(p_entrega, ''), 'coordinar'),
     p_direccion, p_localidad, p_cp, p_notas, v_items, v_subtotal)
  returning numero into v_numero;

  return v_numero;
end;
$$;

-- Los permisos no cambian, pero los repetimos para que la migración sea
-- idempotente y se pueda re-correr sin dejar la función accesible a anónimos.
revoke execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric
) from anon;
grant execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric
) to authenticated;

-- ----------------------------------------------------------------------------
-- Red de seguridad: que el stock no pueda quedar negativo por ningún camino
-- (ni por la edición inline del panel).
-- ----------------------------------------------------------------------------
do $$
begin
  alter table public.productos add constraint productos_stock_no_negativo check (stock >= 0);
exception when duplicate_object then null;
end $$;
