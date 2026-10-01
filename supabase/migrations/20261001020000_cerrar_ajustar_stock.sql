-- ============================================================================
-- Pecora — Cierra ajustar_stock_pedido a la API.
--
-- Problema: ajustar_stock_pedido(jsonb, int) (0008) es SECURITY DEFINER y
-- nunca tuvo `revoke execute`. Supabase le da EXECUTE a PUBLIC (y por lo tanto
-- a anon y authenticated) en toda función nueva del esquema public, así que
-- cualquiera con la anon key podía llamar
--   POST /rest/v1/rpc/ajustar_stock_pedido
-- y sumar o restar stock a cualquier producto (y, al pasar de 0 a > 0, disparar
-- los mails de "volvió el stock").
--
-- La función solo la usan los triggers de pedidos (0008/0009), que son
-- SECURITY DEFINER: corren como el dueño y no necesitan que anon/authenticated
-- tengan EXECUTE. Revocarlo no cambia nada para la app.
--
-- Idempotente. Tests: supabase/tests/funciones_internas.test.sql.
-- ============================================================================

begin;

revoke execute on function public.ajustar_stock_pedido(jsonb, int)
  from public, anon, authenticated;

commit;
