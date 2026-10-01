-- ============================================================================
-- Pecora — Favoritos y direcciones guardadas de la clienta.
--
--   1) favoritos (user_id, producto_id): el corazón de las cards y la ficha.
--      Cada cuenta ve, agrega y borra solo los suyos (RLS). Si se borra el
--      producto o la cuenta, se borran solos.
--   2) direcciones: hasta 10 por cuenta, con un alias ("Casa", "Trabajo"),
--      dirección, localidad, CP y provincia. Una puede ser la principal (la
--      que el checkout propone primero). Solo la dueña las ve y las cambia.
--
-- user_id se completa con auth.uid() y no se puede poner el de otra cuenta.
-- Idempotente. Tests: supabase/tests/favoritos_direcciones.test.sql.
-- ============================================================================

begin;

-- ---- Favoritos ----------------------------------------------------------------
create table if not exists public.favoritos (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, producto_id)
);

create index if not exists favoritos_producto_idx on public.favoritos (producto_id);

alter table public.favoritos enable row level security;

drop policy if exists "favoritos propios" on public.favoritos;
create policy "favoritos propios"
  on public.favoritos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.favoritos from public, anon, authenticated;
grant select, insert, delete on table public.favoritos to authenticated;
grant all on table public.favoritos to service_role;

-- ---- Direcciones ---------------------------------------------------------------
create table if not exists public.direcciones (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  alias      text not null,
  direccion  text not null,
  localidad  text not null,
  cp         text,
  provincia  text,
  principal  boolean not null default false,
  created_at timestamptz not null default now(),
  constraint direcciones_textos check (
    char_length(btrim(alias)) between 1 and 40
    and char_length(btrim(direccion)) between 1 and 200
    and char_length(btrim(localidad)) between 1 and 100
    and char_length(coalesce(cp, '')) <= 20
    and char_length(coalesce(provincia, '')) <= 60
  )
);

create index if not exists direcciones_user_idx on public.direcciones (user_id);
-- Una sola principal por cuenta.
create unique index if not exists direcciones_una_principal
  on public.direcciones (user_id) where principal;

alter table public.direcciones enable row level security;

drop policy if exists "direcciones propias" on public.direcciones;
create policy "direcciones propias"
  on public.direcciones for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.direcciones from public, anon, authenticated;
grant select, insert, update, delete on table public.direcciones to authenticated;
grant all on table public.direcciones to service_role;

-- Máximo 10 por cuenta; al marcar una como principal, las otras dejan de serlo.
create or replace function public.direcciones_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('direcciones:' || new.user_id::text));
    if (select count(*) from public.direcciones where user_id = new.user_id) >= 10 then
      raise exception 'Podés guardar hasta 10 direcciones.' using errcode = 'P0001';
    end if;
  end if;
  if new.principal and (tg_op = 'INSERT' or not old.principal) then
    update public.direcciones set principal = false
     where user_id = new.user_id and principal and id <> new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.direcciones_antes() from public, anon, authenticated;

drop trigger if exists direcciones_antes on public.direcciones;
create trigger direcciones_antes
  before insert or update on public.direcciones
  for each row execute function public.direcciones_antes();

commit;
