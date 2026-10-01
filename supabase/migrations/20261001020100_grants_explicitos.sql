-- ============================================================================
-- Pecora — Permisos explícitos para las tablas y funciones de 0001→0014.
--
-- Por qué: esas migraciones nunca hacen GRANT a anon/authenticated. Dependen
-- de los permisos automáticos ("auto expose") con los que se creó el proyecto,
-- que en local reproducía `auto_expose_new_tables = true` en config.toml. Ese
-- campo desaparece el 2026-10-30: desde ahí, en una base nueva (local, CI o un
-- proyecto restaurado) nada de public queda accesible sin GRANT y el catálogo
-- deja de cargar.
--
-- En producción esto no cambia nada: los permisos ya existen (auto expose) y
-- un GRANT repetido no hace nada. Las tablas y funciones de las migraciones con
-- timestamp ya tienen sus propios grant/revoke.
--
-- Mantiene exactamente el acceso que fija supabase/tests/privilegios_base.test.sql
-- (y la consulta de CONTEXTO.md §8). Lo que no está acá queda sin permiso:
--   * anon no ve pedidos ni profiles;
--   * authenticated no inserta pedidos (solo por crear_pedido) ni actualiza
--     profiles salvo nombre/telefono (0014);
--   * la RLS de cada tabla sigue decidiendo qué filas ve cada uno.
--
-- Idempotente.
-- ============================================================================

begin;

-- Catálogo: lectura pública; escritura del staff (RLS: es_staff()).
grant select on public.categorias, public.productos to anon;
grant select, insert, update, delete on public.categorias, public.productos to authenticated;

-- Pedidos: la clienta lee los suyos, el staff los gestiona (RLS). El alta va
-- solo por crear_pedido (SECURITY DEFINER), así que no hay INSERT.
grant select, update, delete on public.pedidos to authenticated;

-- Perfiles: cada una lee el suyo; solo nombre y teléfono son editables (0014).
grant select on public.profiles to authenticated;
grant update (nombre, telefono) on public.profiles to authenticated;

-- Backend (Edge Functions con la service-role key; saltea RLS).
grant select, insert, update, delete
  on public.categorias, public.productos, public.pedidos, public.profiles
  to service_role;

-- Funciones auxiliares de 0001→0014 que se ejecutan con el rol de quien
-- consulta: las policies (es_admin), el trigger del slug al guardar un
-- producto (slugify, slug_unico) y la regla de stock reservado.
grant execute on function public.es_admin() to anon, authenticated, service_role;
grant execute on function public.slugify(text) to anon, authenticated, service_role;
grant execute on function public.slug_unico(text, uuid) to authenticated, service_role;
grant execute on function public.pedido_reserva_stock(text, timestamptz)
  to authenticated, service_role;

commit;
