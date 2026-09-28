-- ============================================================================
-- Pecora — Migración ventas_validas: una fila por producto vendido.
--
-- Por qué: los reportes (más vendidos, ventas por período) tienen que salir de
-- una sola definición de "venta" en vez de repetir el filtro en cada pantalla.
-- Venta válida = ítem de un pedido que NO está cancelado y NO está en la
-- papelera (la misma regla con la que el pedido reserva stock, ver la 0009).
--
-- security_invoker = true: la vista corre con los permisos de quien consulta,
-- así que valen las policies de pedidos. La admin ve todas las ventas; una
-- clienta, solo las de sus pedidos. Sin esta opción la vista correría como su
-- dueño (postgres) y cualquier cuenta logueada vería las ventas de todas.
--
-- Los ítems salen de pedidos.items (la foto del pedido: nombre y precio al
-- momento de la compra, no los de hoy). Los pedidos anteriores a la 0006
-- guardaban los ítems tal cual los mandaba el navegador; por eso los casts son
-- defensivos: un dato inválido queda en NULL en vez de romper la vista entera.
--
-- Es idempotente. Para revertirla: drop view if exists public.ventas_validas;
-- ============================================================================

create or replace view public.ventas_validas
with (security_invoker = true)
as
select
  p.id          as pedido_id,
  p.numero,
  p.created_at,
  p.user_id,
  p.origen,
  i.producto_id,
  i.nombre,
  i.precio,
  i.cantidad,
  i.precio * i.cantidad as importe
from public.pedidos p
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(p.items) = 'array' then p.items else '[]'::jsonb end
) as e(item)
cross join lateral (
  select
    case
      when e.item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (e.item->>'id')::uuid
    end as producto_id,
    e.item->>'nombre' as nombre,
    case
      when jsonb_typeof(e.item->'precio') = 'number'
      then (e.item->>'precio')::numeric
    end as precio,
    case
      when jsonb_typeof(e.item->'cantidad') = 'number'
      then round((e.item->>'cantidad')::numeric)::int
    end as cantidad
) as i
where p.estado <> 'cancelado'
  and p.eliminado_at is null;

comment on view public.ventas_validas is
  'Una fila por ítem vendido (pedidos no cancelados y fuera de la papelera). '
  'security_invoker: respeta el RLS de pedidos.';

-- Solo lectura y solo para cuentas logueadas (el RLS de pedidos decide qué
-- filas ve cada una). anon no la necesita.
revoke all on public.ventas_validas from public, anon, authenticated;
grant select on public.ventas_validas to authenticated;
