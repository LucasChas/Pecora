-- ============================================================================
-- Pecora — Migración 0002: múltiples imágenes por producto
-- Agrega la columna "imagenes" (array de URLs) para la galería del detalle.
-- Se mantiene "imagen_url" como PORTADA (primera imagen) para la grilla del
-- catálogo y compatibilidad con lo ya cargado.
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- ============================================================================

-- Array de URLs públicas de Storage. Por defecto vacío.
alter table public.productos
  add column if not exists imagenes text[] not null default '{}';

-- Backfill: los productos que ya tenían una imagen (imagen_url) pasan a tener
-- esa foto como primer (y único) elemento de la galería.
update public.productos
set imagenes = array[imagen_url]
where imagen_url is not null
  and imagen_url <> ''
  and (imagenes is null or imagenes = '{}');
