-- ============================================================================
-- Pecora — Migración 0013: origen del pedido (checkout de la clienta vs. carga
-- manual de la admin cuando el pedido llega por WhatsApp).
-- ============================================================================

alter table public.pedidos add column if not exists origen text not null default 'checkout';

do $$
begin
  alter table public.pedidos add constraint pedidos_origen_valido check (origen in ('checkout', 'admin'));
exception when duplicate_object then null;
end $$;

drop function if exists public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric
);

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
  p_subtotal  numeric,
  p_origen    text default 'checkout'
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
    (user_id, nombre, telefono, email, entrega, direccion, localidad, cp, notas, items, subtotal, origen)
  values
    (v_uid, p_nombre, p_telefono, nullif(p_email, ''),
     coalesce(nullif(p_entrega, ''), 'coordinar'),
     p_direccion, p_localidad, p_cp, p_notas, v_items, v_subtotal,
     coalesce(nullif(p_origen, ''), 'checkout'))
  returning numero into v_numero;

  return v_numero;
end;
$$;

revoke execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text
) from anon;
grant execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text
) to authenticated;
