-- ============================================================================
-- Pecora — Migración 0007: la administradora puede borrar pedidos
--
-- Por qué: hasta ahora un pedido solo podía pasar a "cancelado". No había forma
-- de eliminar los de prueba desde el panel (la tabla no tenía policy de DELETE),
-- y la administradora no usa computadora: no puede ir al SQL Editor.
--
-- Solo admin. Las clientas no pueden borrar sus pedidos: si se arrepienten,
-- se cancela (queda el registro de lo que pasó).
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- ============================================================================

drop policy if exists "pedidos delete admin" on public.pedidos;
create policy "pedidos delete admin"
  on public.pedidos for delete to authenticated
  using (public.es_admin());

-- Índices para que el filtrado y la búsqueda del panel no degraden cuando la
-- tabla crezca (el panel filtra por estado y busca por número).
create index if not exists pedidos_estado_idx on public.pedidos (estado);
create index if not exists pedidos_numero_idx on public.pedidos (numero);
