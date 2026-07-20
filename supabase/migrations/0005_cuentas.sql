-- ============================================================================
-- Pecora — Migración 0005: cuentas de clientas + roles + seguridad
--
-- Introduce cuentas de clientas (Supabase Auth) y separa permisos:
--   - "cliente": puede crear pedidos y ver SOLO los suyos.
--   - "admin"  : gestiona productos/categorías/estados y ve TODOS los pedidos.
--
-- IMPORTANTE (pasos en el dashboard, aparte de este SQL):
--   1) Authentication → Providers → Email: activá "Enable Sign up".
--      (Opcional recomendado: desactivá "Confirm email" para que la clienta
--       pueda entrar apenas se registra, sin verificar mail.)
--   2) Este script marca como admin a la cuenta de abajo. CAMBIÁ el email si tu
--      cuenta de administradora es otra.
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Perfiles (1 por usuario de auth) con rol.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  telefono   text,
  rol        text not null default 'cliente' check (rol in ('cliente', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "perfil propio select" on public.profiles;
create policy "perfil propio select"
  on public.profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "perfil propio update" on public.profiles;
create policy "perfil propio update"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Crea el perfil automáticamente cuando se registra un usuario nuevo.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nombre, telefono)
  values (new.id, new.raw_user_meta_data->>'nombre', new.raw_user_meta_data->>'telefono')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ¿El usuario actual es admin? (se usa en las políticas RLS)
create or replace function public.es_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and rol = 'admin');
$$;

-- Marca como admin a la cuenta de la administradora.  <-- CAMBIÁ el email si hace falta
insert into public.profiles (id, rol, nombre)
select id, 'admin', 'Pecora'
from auth.users
where email = 'luquitaschasdiaz3@gmail.com'
on conflict (id) do update set rol = 'admin';

-- ----------------------------------------------------------------------------
-- Pedidos: se ligan a la cuenta de la clienta.
-- ----------------------------------------------------------------------------
alter table public.pedidos
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists pedidos_user_id_idx on public.pedidos (user_id);

-- Recreamos crear_pedido: ahora EXIGE estar logueada y guarda el user_id.
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
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para hacer un pedido.';
  end if;
  insert into public.pedidos
    (user_id, nombre, telefono, email, entrega, direccion, localidad, cp, notas, items, subtotal)
  values
    (v_uid, p_nombre, p_telefono, nullif(p_email, ''),
     coalesce(nullif(p_entrega, ''), 'coordinar'),
     p_direccion, p_localidad, p_cp, p_notas, p_items, coalesce(p_subtotal, 0))
  returning numero into v_numero;
  return v_numero;
end;
$$;

-- Ahora solo usuarios logueados pueden crear pedidos (ya no anónimos).
revoke execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric
) from anon;
grant execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric
) to authenticated;

-- RLS de pedidos: la clienta ve/gestiona SOLO los suyos; la admin, todos.
drop policy if exists "pedidos insert publico" on public.pedidos;
drop policy if exists "pedidos lectura autenticada" on public.pedidos;
drop policy if exists "pedidos gestion autenticada" on public.pedidos;

create policy "pedidos select propio o admin"
  on public.pedidos for select to authenticated
  using (user_id = auth.uid() or public.es_admin());

-- Solo la admin cambia el estado del pedido.
create policy "pedidos update admin"
  on public.pedidos for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ----------------------------------------------------------------------------
-- Escritura de productos y categorías: SOLO admin (antes era cualquier auth).
-- ----------------------------------------------------------------------------
drop policy if exists "productos escritura autenticada" on public.productos;
create policy "productos escritura admin"
  on public.productos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists "categorias escritura autenticada" on public.categorias;
create policy "categorias escritura admin"
  on public.categorias for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ----------------------------------------------------------------------------
-- Storage (bucket productos): subir/editar/borrar imágenes, SOLO admin.
-- ----------------------------------------------------------------------------
drop policy if exists "productos storage insert autenticada" on storage.objects;
create policy "productos storage insert admin"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'productos' and public.es_admin());

drop policy if exists "productos storage update autenticada" on storage.objects;
create policy "productos storage update admin"
  on storage.objects for update to authenticated
  using (bucket_id = 'productos' and public.es_admin());

drop policy if exists "productos storage delete autenticada" on storage.objects;
create policy "productos storage delete admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'productos' and public.es_admin());
