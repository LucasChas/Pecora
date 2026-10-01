-- ============================================================================
-- Security fix: public.ajustar_stock_pedido (0008) is SECURITY DEFINER and
-- EXECUTE was never revoked, so PUBLIC (and therefore anon) could call it via
-- POST /rest/v1/rpc/ajustar_stock_pedido and set any product's stock.
--
-- It is only meant to be called from the order stock triggers
-- (pedido_estado_stock / pedido_borrado_stock), which are SECURITY DEFINER
-- themselves and run as the function owner, so they keep working.
-- ============================================================================

revoke execute on function public.ajustar_stock_pedido(jsonb, int)
  from public, anon, authenticated;
