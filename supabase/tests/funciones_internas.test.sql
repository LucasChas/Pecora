-- ============================================================================
-- pgTAP: qué funciones SECURITY DEFINER puede llamar cada rol de la API.
--
-- Una función SECURITY DEFINER corre con los permisos de su dueño (saltea RLS),
-- y Supabase le da EXECUTE a PUBLIC a toda función nueva de public. Si una
-- función interna se olvida el `revoke`, queda expuesta en /rest/v1/rpc/...
-- (pasó con ajustar_stock_pedido: ver 20261001020000_cerrar_ajustar_stock.sql).
--
-- Estas listas fijan las funciones que la app llama a propósito. Si agregás una
-- RPC pública nueva, sumala acá; si el test falla con una función que no es
-- una RPC, falta su `revoke execute ... from public, anon, authenticated`.
-- Las funciones de trigger quedan afuera: no se pueden llamar por la API.
-- ============================================================================

begin;

select plan(4);

-- 1
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.prosecdef
        and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', p.oid, 'execute')
        and p.proname not in (
          'es_admin', 'es_staff',                 -- usadas por las policies RLS
          'cotizar_envio', 'mas_vendidos',        -- checkout y catálogo
          'resenas_de_producto', 'resumen_resenas',
          'baja_aviso_stock'                      -- link de baja del mail (token)
        ) $$,
  'anon can execute only the public SECURITY DEFINER RPCs'
);

-- 2
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.prosecdef
        and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'execute')
        and p.proname not in (
          'es_admin', 'es_staff',
          'cotizar_envio', 'mas_vendidos',
          'resenas_de_producto', 'resumen_resenas',
          'baja_aviso_stock',
          'crear_pedido', 'validar_cupon',
          'suscribir_aviso_stock', 'cancelar_aviso_stock',
          'guardar_resena', 'borrar_resena', 'puede_resenar', 'mi_resena', 'mis_resenas', 'mis_pedidos',
          -- Solo staff/admin: cada una chequea el rol adentro (42501).
          'reenviar_emails_pedido', 'estadisticas', 'rentabilidad',
          'importar_productos', 'ocultar_resena', 'resenas_moderacion'
        ) $$,
  'authenticated can execute only the SECURITY DEFINER RPCs the app calls'
);

-- 3
select ok(
  not has_function_privilege('anon', 'public.ajustar_stock_pedido(jsonb, int)', 'execute'),
  'anon cannot execute ajustar_stock_pedido'
);

-- 4
select ok(
  not has_function_privilege('authenticated', 'public.ajustar_stock_pedido(jsonb, int)', 'execute'),
  'authenticated cannot execute ajustar_stock_pedido'
);

select * from finish();

rollback;
