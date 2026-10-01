-- ============================================================================
-- Pecora — Pedidos: estado "enviado", marca de pago y número de seguimiento.
--
-- Antes un pedido pasaba de "confirmado" (en preparación) a "entregado" sin
-- nada en el medio: una clienta con envío no tenía novedades mientras el
-- paquete viajaba, y no había forma de marcar qué pedidos estaban pagados
-- (los pagos son por transferencia o efectivo, coordinados por WhatsApp).
--
--   * estado acepta 'enviado' (entre 'confirmado' y 'entregado'). Reserva
--     stock igual que los demás estados no cancelados (pedido_reserva_stock
--     no cambia), así que pasar a "enviado" no toca el stock.
--   * pagado_at: cuándo se marcó como pagado (null = no pagado).
--   * seguimiento: código o link de seguimiento del correo (opcional).
--
-- Empleados: pueden cambiar estas dos columnas además de estado, eliminado_at
-- y total (trigger pedidos_limitar_empleado). La clienta las ve en "Mis
-- pedidos" (lectura de sus propios pedidos, sin cambios en RLS).
--
-- Idempotente. Tests: supabase/tests/pedido_enviado_pagado.test.sql.
-- ============================================================================

begin;

-- 1) estado: la check de la 0003 es inline (nombre generado). Se borra
--    cualquier check sobre `estado` que no sea la nueva y se crea la nueva.
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.pedidos'::regclass
       and c.contype = 'c'
       and c.conname <> 'pedidos_estado_valido'
       and pg_get_constraintdef(c.oid) ilike '%estado%'
  loop
    execute format('alter table public.pedidos drop constraint %I', v_nombre);
  end loop;
end $$;

alter table public.pedidos drop constraint if exists pedidos_estado_valido;
alter table public.pedidos add constraint pedidos_estado_valido
  check (estado in ('nuevo', 'confirmado', 'enviado', 'entregado', 'cancelado'));

-- 2) Pago y seguimiento.
alter table public.pedidos add column if not exists pagado_at timestamptz;
alter table public.pedidos add column if not exists seguimiento text;

alter table public.pedidos drop constraint if exists pedidos_seguimiento_largo;
alter table public.pedidos add constraint pedidos_seguimiento_largo
  check (seguimiento is null or char_length(seguimiento) <= 300);

create index if not exists pedidos_pagado_idx on public.pedidos ((pagado_at is null))
  where eliminado_at is null;

-- 3) Empleados: también pueden marcar el pago y cargar el seguimiento.
create or replace function public.pedidos_limitar_empleado()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_editables constant text[] := array['estado', 'eliminado_at', 'total', 'pagado_at', 'seguimiento'];
begin
  if current_user in ('authenticated', 'anon') and not coalesce(public.es_admin(), false) then
    if (to_jsonb(new) - v_editables) is distinct from (to_jsonb(old) - v_editables) then
      raise exception 'No autorizado: solo la admin puede modificar los datos del pedido'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

commit;
