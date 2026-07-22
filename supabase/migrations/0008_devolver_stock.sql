-- ============================================================================
-- Pecora — Migración 0008: cancelar o borrar un pedido devuelve el stock
--
-- Por qué: desde la 0006 el pedido descuenta stock al crearse, pero nada lo
-- reponía. Si un pedido se cancelaba o se borraba, esas unidades quedaban
-- descontadas para siempre: la prenda estaba en el cajón pero el muestrario la
-- mostraba como "sin stock".
--
-- Lo resolvemos con triggers y no en el front, para que valga por cualquier
-- camino (panel, SQL Editor, o el futuro webhook de MercadoPago).
--
-- Reglas:
--   * pasa a 'cancelado'        -> devuelve el stock
--   * sale de 'cancelado'       -> lo vuelve a descontar (si no alcanza, falla)
--   * se borra un pedido activo -> devuelve el stock
--   * se borra uno ya cancelado -> no toca nada (ya se había devuelto)
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- ============================================================================

-- Suma (signo +1) o resta (signo -1) al stock las cantidades de un pedido.
-- Agrupa por producto: si el mismo ítem aparece repetido en el jsonb, se suman
-- las cantidades en vez de perderse una.
create or replace function public.ajustar_stock_pedido(p_items jsonb, p_signo int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_items is null then return; end if;

  update public.productos p
     set stock = p.stock + p_signo * i.cantidad
    from (
      select (value->>'id')::uuid as id,
             sum((value->>'cantidad')::int) as cantidad
        from jsonb_array_elements(p_items)
       group by 1
    ) i
   where p.id = i.id;
end;
$$;

-- Reacciona a los cambios de estado del pedido.
create or replace function public.pedido_estado_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = old.estado then
    return new;
  end if;

  if new.estado = 'cancelado' then
    -- Se cancela: la mercadería vuelve a estar disponible.
    perform public.ajustar_stock_pedido(new.items, 1);

  elsif old.estado = 'cancelado' then
    -- Se reactiva un pedido cancelado: hay que volver a reservar la mercadería.
    -- Si no hay stock, el check (stock >= 0) de la 0006 corta la operación.
    begin
      perform public.ajustar_stock_pedido(new.items, -1);
    exception when check_violation then
      raise exception 'No hay stock suficiente para reactivar el pedido #%.', new.numero;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists pedidos_estado_stock on public.pedidos;
create trigger pedidos_estado_stock
  after update of estado on public.pedidos
  for each row execute function public.pedido_estado_stock();

-- Al borrar, devolvemos el stock salvo que el pedido ya estuviera cancelado
-- (en ese caso el trigger de arriba ya lo había repuesto).
create or replace function public.pedido_borrado_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.estado <> 'cancelado' then
    perform public.ajustar_stock_pedido(old.items, 1);
  end if;
  return old;
end;
$$;

drop trigger if exists pedidos_borrado_stock on public.pedidos;
create trigger pedidos_borrado_stock
  after delete on public.pedidos
  for each row execute function public.pedido_borrado_stock();
