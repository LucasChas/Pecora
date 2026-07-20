-- ============================================================================
-- Pecora — Migración 0010: la clienta ve sus pedidos eliminados como cancelados
--
-- La 0009 le ocultaba a la clienta los pedidos que la admin mandaba a la
-- papelera. Eso era peor: el pedido desaparecía sin explicación y la clienta no
-- tenía a qué agarrarse para preguntar qué pasó.
--
-- Ahora los sigue viendo (el front los muestra como "Cancelado", ver
-- MyOrdersPage) y desde ahí puede escribir por WhatsApp para consultar el motivo.
-- La papelera vuelve a ser lo que dice ser: una vista del panel, no un borrado
-- silencioso a espaldas de la clienta.
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- ============================================================================

drop policy if exists "pedidos select propio o admin" on public.pedidos;
create policy "pedidos select propio o admin"
  on public.pedidos for select to authenticated
  using (user_id = auth.uid() or public.es_admin());
