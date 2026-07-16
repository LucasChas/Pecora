-- ============================================================================
-- Pecora — Migración 0003: pedidos (checkout como invitada)
-- Crea la tabla de pedidos que genera el checkout del catálogo público.
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- ============================================================================

create table if not exists public.pedidos (
  id         uuid primary key default gen_random_uuid(),
  -- Número de orden corto y legible para hablar por WhatsApp ("pedido #12").
  numero     bigint generated always as identity,
  -- Datos de la clienta (compra como invitada, sin cuenta).
  nombre     text not null,
  telefono   text not null,
  email      text,
  -- Entrega: 'envio' (a domicilio) o 'coordinar' (retiro / a convenir).
  entrega    text not null default 'coordinar' check (entrega in ('envio', 'coordinar')),
  direccion  text,
  localidad  text,
  cp         text,
  notas      text,
  -- Foto de los ítems al momento del pedido: [{id, nombre, precio, cantidad}].
  items      jsonb not null,
  subtotal   numeric(10,2) not null default 0,
  -- Estado del pedido para el seguimiento del admin.
  estado     text not null default 'nuevo'
             check (estado in ('nuevo', 'confirmado', 'entregado', 'cancelado')),
  created_at timestamptz not null default now()
);

create index if not exists pedidos_created_at_idx on public.pedidos (created_at desc);

-- ----------------------------------------------------------------------------
-- RLS: cualquiera puede CREAR un pedido (checkout público, sin login),
-- pero solo la administradora autenticada puede verlos y gestionarlos.
-- ----------------------------------------------------------------------------
alter table public.pedidos enable row level security;

drop policy if exists "pedidos insert publico" on public.pedidos;
create policy "pedidos insert publico"
  on public.pedidos for insert
  to anon, authenticated
  with check (true);

drop policy if exists "pedidos lectura autenticada" on public.pedidos;
create policy "pedidos lectura autenticada"
  on public.pedidos for select
  to authenticated
  using (true);

drop policy if exists "pedidos gestion autenticada" on public.pedidos;
create policy "pedidos gestion autenticada"
  on public.pedidos for update
  to authenticated
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- Realtime: publicar la tabla para que el panel de pedidos se actualice solo
-- cuando entra un pedido nuevo o cambia un estado.
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.pedidos;
  exception when duplicate_object then null;
  end;
end $$;
