-- ============================================================================
-- Pecora — Migración 0004: función para crear pedidos (checkout público)
--
-- Por qué: el checkout necesita INSERTAR el pedido Y recibir de vuelta el número
-- de orden. Pero la lectura de "pedidos" es solo para la admin (RLS). Si el alta
-- intenta devolver la fila (insert ... returning), RLS la bloquea para la clienta.
--
-- Solución: una función SECURITY DEFINER que corre con permisos del dueño (saltea
-- RLS solo para esta operación controlada): inserta el pedido y devuelve el número.
-- Así la clienta obtiene su número de orden SIN poder leer los demás pedidos.
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
  v_numero bigint;
begin
  insert into public.pedidos
    (nombre, telefono, email, entrega, direccion, localidad, cp, notas, items, subtotal)
  values
    (p_nombre, p_telefono, nullif(p_email, ''),
     coalesce(nullif(p_entrega, ''), 'coordinar'),
     p_direccion, p_localidad, p_cp, p_notas, p_items, coalesce(p_subtotal, 0))
  returning numero into v_numero;
  return v_numero;
end;
$$;

-- Cualquiera (clienta anónima o admin) puede LLAMAR a la función.
grant execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric
) to anon, authenticated;
