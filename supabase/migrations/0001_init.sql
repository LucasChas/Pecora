-- ============================================================================
-- Pecora — Migración inicial
-- Crea tablas (categorias, productos), políticas RLS, bucket de Storage y
-- la validación de backend que impide borrar categorías con productos.
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- (Ver README.md, sección "Migraciones").
-- ============================================================================

-- gen_random_uuid() viene de pgcrypto; en Supabase ya está disponible,
-- pero lo dejamos explícito por las dudas.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Tabla: categorias
-- ----------------------------------------------------------------------------
create table if not exists public.categorias (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Tabla: productos
-- La disponibilidad NO es un campo: se calcula como (stock > 0).
-- on delete restrict => la base rechaza borrar una categoría que tenga
-- productos asociados (primera capa de protección en el backend).
-- ----------------------------------------------------------------------------
create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  categoria_id uuid references public.categorias(id) on delete restrict,
  descripcion  text,
  precio       numeric(10,2) not null default 0,
  stock        integer not null default 0,
  imagen_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Índice para filtrar/ordenar por categoría rápido.
create index if not exists productos_categoria_id_idx on public.productos (categoria_id);

-- ----------------------------------------------------------------------------
-- Trigger: mantener updated_at al día en cada UPDATE de productos
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists productos_set_updated_at on public.productos;
create trigger productos_set_updated_at
  before update on public.productos
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Trigger: bloquear el borrado de una categoría que tenga productos.
-- Es redundante con "on delete restrict", pero devuelve un mensaje claro
-- (segunda capa de protección, reforzada en el backend y no en el frontend).
-- ----------------------------------------------------------------------------
create or replace function public.impedir_borrar_categoria_con_productos()
returns trigger
language plpgsql
as $$
declare
  cantidad integer;
begin
  select count(*) into cantidad from public.productos where categoria_id = old.id;
  if cantidad > 0 then
    raise exception 'No se puede eliminar la categoría "%": tiene % producto(s) asociado(s).', old.nombre, cantidad;
  end if;
  return old;
end;
$$;

drop trigger if exists categorias_impedir_borrado on public.categorias;
create trigger categorias_impedir_borrado
  before delete on public.categorias
  for each row execute function public.impedir_borrar_categoria_con_productos();

-- ============================================================================
-- Row Level Security (RLS)
-- Lectura pública (para el catálogo). Escritura solo usuarios autenticados
-- (la administradora logueada).
-- ============================================================================
alter table public.categorias enable row level security;
alter table public.productos  enable row level security;

-- --- categorias ---
drop policy if exists "categorias lectura publica" on public.categorias;
create policy "categorias lectura publica"
  on public.categorias for select
  to anon, authenticated
  using (true);

drop policy if exists "categorias escritura autenticada" on public.categorias;
create policy "categorias escritura autenticada"
  on public.categorias for all
  to authenticated
  using (true)
  with check (true);

-- --- productos ---
drop policy if exists "productos lectura publica" on public.productos;
create policy "productos lectura publica"
  on public.productos for select
  to anon, authenticated
  using (true);

drop policy if exists "productos escritura autenticada" on public.productos;
create policy "productos escritura autenticada"
  on public.productos for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================================
-- Storage: bucket "productos" (público para lectura, escritura autenticada)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do nothing;

drop policy if exists "productos storage lectura publica" on storage.objects;
create policy "productos storage lectura publica"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'productos');

drop policy if exists "productos storage insert autenticada" on storage.objects;
create policy "productos storage insert autenticada"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'productos');

drop policy if exists "productos storage update autenticada" on storage.objects;
create policy "productos storage update autenticada"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'productos');

drop policy if exists "productos storage delete autenticada" on storage.objects;
create policy "productos storage delete autenticada"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'productos');

-- ============================================================================
-- Realtime: publicar cambios de ambas tablas para que el catálogo se
-- actualice solo (sin recargar la página).
-- ============================================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.productos;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.categorias;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- (Opcional) Datos de ejemplo para probar. Descomentá si querés arrancar
-- con algunas categorías cargadas.
-- ============================================================================
-- insert into public.categorias (nombre) values
--   ('Bodies'), ('Ajuares'), ('Gorros'), ('Enteritos')
-- on conflict (nombre) do nothing;
