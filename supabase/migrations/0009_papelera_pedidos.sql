-- ============================================================================
-- Pecora — Migración 0009: papelera de pedidos (borrar y reflotar)
--
-- Por qué: borrar un pedido era definitivo. Ahora "borrar" lo manda a la
-- papelera (queda oculto pero recuperable) y desde ahí se puede restaurar o
-- eliminar para siempre.
--
-- Además unifica la lógica de stock de la 0008. Antes había dos reglas sueltas
-- (cambio de estado / borrado); ahora hay UNA sola idea:
--
--     un pedido "reserva" mercadería si NO está cancelado y NO está en la papelera
--
-- Cada vez que esa condición cambia, el stock se ajusta en consecuencia. Así
-- quedan cubiertos todos los casos sin contar dos veces: cancelar, descancelar,
-- mandar a la papelera, restaurar y eliminar definitivamente.
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- ============================================================================

alter table public.pedidos
  add column if not exists eliminado_at timestamptz;

-- El panel filtra por papelera en casi todas las consultas.
create index if not exists pedidos_eliminado_at_idx on public.pedidos (eliminado_at);

-- ¿Este pedido tiene mercadería reservada (descontada del stock)?
create or replace function public.pedido_reserva_stock(p_estado text, p_eliminado timestamptz)
returns boolean language sql immutable as $$
  select p_estado <> 'cancelado' and p_eliminado is null;
$$;

-- Ajusta el stock cuando cambia si el pedido reserva mercadería o no.
create or replace function public.pedido_estado_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_antes  boolean := public.pedido_reserva_stock(old.estado, old.eliminado_at);
  v_ahora  boolean := public.pedido_reserva_stock(new.estado, new.eliminado_at);
begin
  if v_antes = v_ahora then
    return new;
  end if;

  if v_antes and not v_ahora then
    -- Deja de reservar (se canceló o fue a la papelera): vuelve al stock.
    perform public.ajustar_stock_pedido(new.items, 1);
  else
    -- Vuelve a reservar (se restauró o se descanceló): hay que descontar otra vez.
    begin
      perform public.ajustar_stock_pedido(new.items, -1);
    exception when check_violation then
      raise exception 'No hay stock suficiente para reactivar el pedido #%.', new.numero;
    end;
  end if;

  return new;
end;
$$;

-- Ahora escuchamos cualquier update (no solo el de "estado"), porque mandar a la
-- papelera y restaurar también cambian la reserva.
drop trigger if exists pedidos_estado_stock on public.pedidos;
create trigger pedidos_estado_stock
  after update on public.pedidos
  for each row execute function public.pedido_estado_stock();

-- Borrado definitivo: solo devuelve stock si el pedido todavía lo reservaba
-- (si estaba en la papelera o cancelado, ya se había devuelto).
create or replace function public.pedido_borrado_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.pedido_reserva_stock(old.estado, old.eliminado_at) then
    perform public.ajustar_stock_pedido(old.items, 1);
  end if;
  return old;
end;
$$;

drop trigger if exists pedidos_borrado_stock on public.pedidos;
create trigger pedidos_borrado_stock
  after delete on public.pedidos
  for each row execute function public.pedido_borrado_stock();

-- La clienta no debe ver en "Mis pedidos" los que la admin mandó a la papelera.
drop policy if exists "pedidos select propio o admin" on public.pedidos;
create policy "pedidos select propio o admin"
  on public.pedidos for select to authenticated
  using ((user_id = auth.uid() and eliminado_at is null) or public.es_admin());
