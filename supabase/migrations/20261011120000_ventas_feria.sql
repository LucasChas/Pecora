-- ============================================================================
-- Pecora — Ventas en la feria.
--
-- La admin vende también en ferias. Esas ventas se cargan desde el mismo
-- "Nuevo pedido" del panel (modo Feria): no llevan datos de la clienta, sino
-- la feria (nombre + fecha) y el medio de pago.
--
-- Una venta de feria es un pedido más (origen 'feria'), así descuenta stock y
-- talles con crear_pedido y cuenta en ventas_validas, estadísticas,
-- rentabilidad y "más vendidos" sin repetir lógica. Cada clienta que compra es
-- un pedido.
--
-- Cambios:
--   1) Tabla ferias (nombre, fecha, activa). Solo el staff la ve y la cambia;
--      borrar, solo la admin (y solo si la feria no tiene ventas).
--   2) pedidos: origen acepta 'feria'; columnas feria_id y medio_pago
--      (efectivo / transferencia / mercadopago). Un pedido de feria siempre
--      tiene feria y medio de pago.
--   3) Trigger pedidos_venta_feria (BEFORE INSERT): un pedido de feria solo se
--      crea con registrar_venta_feria, que le pasa la feria y el medio de pago
--      por una variable de la transacción. El trigger los completa y deja la
--      venta entregada y pagada.
--   4) registrar_venta_feria(p_feria_id, p_medio_pago, p_items,
--      p_idempotency_key): RPC solo staff (42501). Llama a crear_pedido con
--      origen 'feria' y el nombre de la feria como nombre del pedido.
--   5) Mails: el trigger del mail de pedido no llama a la Edge Function para
--      las ventas de feria, y reenviar_emails_pedido las rechaza como a las
--      cargas manuales.
--   6) estadisticas(): por_origen suma 'feria' y hay un resumen por_feria
--      (ventas y total por medio de pago de cada feria del período).
--
-- Idempotente. Tests: supabase/tests/ventas_feria.test.sql.
-- ============================================================================

begin;

-- ---- 1) Ferias ----------------------------------------------------------------
create table if not exists public.ferias (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  fecha      date not null default (now() at time zone 'America/Argentina/Cordoba')::date,
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint ferias_nombre_largo check (char_length(btrim(nombre)) between 1 and 80)
);

-- Misma feria el mismo día = una sola (sin importar mayúsculas ni espacios).
create unique index if not exists ferias_nombre_fecha_unico
  on public.ferias (lower(btrim(nombre)), fecha);

-- El nombre se guarda sin espacios de más.
create or replace function public.ferias_normalizar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.nombre := btrim(regexp_replace(new.nombre, '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists ferias_normalizar on public.ferias;
create trigger ferias_normalizar
  before insert or update of nombre on public.ferias
  for each row execute function public.ferias_normalizar();

alter table public.ferias enable row level security;

drop policy if exists "ferias select staff" on public.ferias;
create policy "ferias select staff"
  on public.ferias for select to authenticated
  using (public.es_staff());

drop policy if exists "ferias insert staff" on public.ferias;
create policy "ferias insert staff"
  on public.ferias for insert to authenticated
  with check (public.es_staff());

drop policy if exists "ferias update staff" on public.ferias;
create policy "ferias update staff"
  on public.ferias for update to authenticated
  using (public.es_staff()) with check (public.es_staff());

drop policy if exists "ferias delete admin" on public.ferias;
create policy "ferias delete admin"
  on public.ferias for delete to authenticated
  using (public.es_admin());

revoke all on table public.ferias from public, anon, authenticated;
grant select, insert, update, delete on table public.ferias to authenticated;

-- ---- 2) pedidos: origen 'feria', feria y medio de pago --------------------------
alter table public.pedidos drop constraint if exists pedidos_origen_valido;
alter table public.pedidos add constraint pedidos_origen_valido
  check (origen in ('checkout', 'admin', 'feria'));

-- on delete restrict: una feria con ventas no se borra (se archiva con activa).
alter table public.pedidos
  add column if not exists feria_id uuid references public.ferias (id) on delete restrict;
alter table public.pedidos add column if not exists medio_pago text;

alter table public.pedidos drop constraint if exists pedidos_medio_pago_valido;
alter table public.pedidos add constraint pedidos_medio_pago_valido
  check (medio_pago is null or medio_pago in ('efectivo', 'transferencia', 'mercadopago'));

-- Feria <-> origen 'feria', y toda venta de feria con medio de pago.
alter table public.pedidos drop constraint if exists pedidos_feria_coherente;
alter table public.pedidos add constraint pedidos_feria_coherente
  check ((origen = 'feria') = (feria_id is not null)
         and (origen <> 'feria' or medio_pago is not null));

create index if not exists pedidos_feria_id_idx on public.pedidos (feria_id)
  where feria_id is not null;

-- ---- 3) Trigger: completa la venta de feria -------------------------------------
create or replace function public.pedidos_venta_feria()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_feria text := nullif(current_setting('pecora.venta_feria', true), '');
  v_medio text := nullif(current_setting('pecora.venta_feria_medio_pago', true), '');
begin
  if new.origen is distinct from 'feria' then
    return new;
  end if;

  if v_feria is null then
    raise exception 'Las ventas de feria se registran con registrar_venta_feria.'
      using errcode = 'P0001';
  end if;

  new.feria_id   := v_feria::uuid;
  new.medio_pago := v_medio;
  -- Venta en mano: ya está entregada y cobrada.
  new.estado     := 'entregado';
  new.pagado_at  := now();
  return new;
end;
$$;

drop trigger if exists pedidos_venta_feria on public.pedidos;
create trigger pedidos_venta_feria
  before insert on public.pedidos
  for each row execute function public.pedidos_venta_feria();

-- ---- 4) registrar_venta_feria -------------------------------------------------------
-- SECURITY INVOKER: lee la feria con el RLS de quien llama (staff) y el alta
-- la hace crear_pedido, que ya descuenta stock y talles.
create or replace function public.registrar_venta_feria(
  p_feria_id        uuid,
  p_medio_pago      text,
  p_items           jsonb,
  p_idempotency_key uuid default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nombre text;
  v_activa boolean;
  v_numero bigint;
begin
  if not coalesce(public.es_staff(), false) then
    raise exception 'Solo el equipo de la tienda puede registrar ventas de feria.'
      using errcode = '42501';
  end if;

  if p_medio_pago is null or p_medio_pago not in ('efectivo', 'transferencia', 'mercadopago') then
    raise exception 'Elegí cómo te pagaron: efectivo, transferencia o Mercado Pago.'
      using errcode = '22023';
  end if;

  select nombre, activa into v_nombre, v_activa
    from public.ferias where id = p_feria_id;
  if not found then
    raise exception 'Elegí una feria.' using errcode = '22023';
  end if;
  if not v_activa then
    raise exception 'La feria "%" está archivada. Elegí otra o volvé a activarla.', v_nombre
      using errcode = '22023';
  end if;

  -- Variables locales a la transacción: las lee pedidos_venta_feria.
  perform set_config('pecora.venta_feria', p_feria_id::text, true);
  perform set_config('pecora.venta_feria_medio_pago', p_medio_pago, true);

  v_numero := public.crear_pedido(
    p_nombre          => v_nombre,
    p_telefono        => '',
    p_email           => null,
    p_entrega         => 'coordinar',
    p_direccion       => null,
    p_localidad       => null,
    p_cp              => null,
    p_notas           => null,
    p_items           => p_items,
    p_subtotal        => 0,
    p_origen          => 'feria',
    p_idempotency_key => p_idempotency_key
  );

  perform set_config('pecora.venta_feria', '', true);
  perform set_config('pecora.venta_feria_medio_pago', '', true);

  return v_numero;
end;
$$;

revoke execute on function public.registrar_venta_feria(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.registrar_venta_feria(uuid, text, jsonb, uuid) to authenticated;

-- ---- 5) Mails: las ventas de feria no mandan nada --------------------------------
create or replace function public.pedido_creado_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
begin
  -- Venta de feria: no hay clienta a quien escribirle y la dueña ya lo sabe.
  if new.origen = 'feria' then
    return new;
  end if;

  begin
    perform public.invocar_email_pedido(new.id);
  exception when others then
    -- Cualquier falla acá (red, Vault, pg_net) NUNCA debe tumbar el pedido.
    null;
  end;

  return new;
end;
$$;

create or replace function public.reenviar_emails_pedido(p_pedido_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen     text;
  v_request_id bigint;
begin
  if not coalesce(public.es_staff(), false) then
    raise exception 'Solo la administradora puede reenviar los mails de un pedido.'
      using errcode = '42501';
  end if;

  select origen into v_origen from public.pedidos where id = p_pedido_id;
  if not found then
    raise exception 'El pedido no existe.' using errcode = 'P0002';
  end if;

  -- La Edge Function no manda nada para las cargas manuales ni las ventas de
  -- feria: no tiene sentido llamarla.
  if v_origen in ('admin', 'feria') then
    raise exception 'Los pedidos cargados a mano no mandan mails.';
  end if;

  v_request_id := public.invocar_email_pedido(p_pedido_id);
  if v_request_id is null then
    raise exception 'El envío de mails no está configurado: faltan la URL o el token de la función en Vault.';
  end if;

  return v_request_id;
end;
$$;

revoke execute on function public.reenviar_emails_pedido(uuid) from public, anon;
grant execute on function public.reenviar_emails_pedido(uuid) to authenticated;

-- ---- 6) estadisticas: feria en por_origen y resumen por_feria ---------------------
-- Igual que en 20260928144835_estadisticas_mas_vendidos.sql, más:
--   por_origen.feria: {pedidos, total}
--   por_feria: [{feria_id, nombre, fecha, pedidos, total, efectivo,
--                transferencia, mercadopago}] de las ferias con ventas en el
--                período, de la más reciente a la más vieja.
create or replace function public.estadisticas(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_tz      constant text := 'America/Argentina/Cordoba';
  v_inicio  timestamptz;
  v_fin     timestamptz;
  v_res     jsonb;
begin
  if not coalesce(public.es_admin(), false) then
    raise exception 'No autorizado: las estadísticas son solo para la admin'
      using errcode = '42501';
  end if;

  if p_desde is null or p_hasta is null then
    raise exception 'Indicá las fechas desde y hasta.' using errcode = '22023';
  end if;
  if p_desde > p_hasta then
    raise exception 'La fecha desde no puede ser posterior a la fecha hasta.'
      using errcode = '22023';
  end if;

  v_inicio := p_desde::timestamp at time zone c_tz;
  v_fin    := (p_hasta + 1)::timestamp at time zone c_tz;

  with pedidos_rango as (
    select p.id, p.user_id, p.origen, p.total, p.feria_id, p.medio_pago,
           to_char(p.created_at at time zone c_tz, 'YYYY-MM') as mes
      from public.pedidos p
     where p.estado <> 'cancelado'
       and p.eliminado_at is null
       and p.created_at >= v_inicio
       and p.created_at <  v_fin
  ),
  meses as (
    select to_char(m, 'YYYY-MM') as mes
      from generate_series(date_trunc('month', p_desde::timestamp),
                           date_trunc('month', p_hasta::timestamp),
                           interval '1 month') m
  ),
  por_mes as (
    select m.mes,
           count(pr.id)::int                as pedidos,
           coalesce(sum(pr.total), 0)::numeric as total
      from meses m
      left join pedidos_rango pr on pr.mes = m.mes
     group by m.mes
     order by m.mes
  ),
  top as (
    select v.producto_id,
           coalesce(max(pr.nombre), max(v.nombre)) as nombre,
           sum(v.cantidad)::int                    as unidades,
           coalesce(sum(v.importe), 0)::numeric    as importe
      from public.ventas_validas v
      left join public.productos pr on pr.id = v.producto_id
     where v.producto_id is not null
       and v.cantidad is not null
       and v.created_at >= v_inicio
       and v.created_at <  v_fin
     group by v.producto_id
     order by unidades desc, importe desc, v.producto_id
     limit 10
  ),
  ferias_rango as (
    select f.id, f.nombre, f.fecha,
           count(*)::int                       as pedidos,
           coalesce(sum(pr.total), 0)::numeric as total,
           coalesce(sum(pr.total) filter (where pr.medio_pago = 'efectivo'), 0)::numeric      as efectivo,
           coalesce(sum(pr.total) filter (where pr.medio_pago = 'transferencia'), 0)::numeric as transferencia,
           coalesce(sum(pr.total) filter (where pr.medio_pago = 'mercadopago'), 0)::numeric   as mercadopago
      from pedidos_rango pr
      join public.ferias f on f.id = pr.feria_id
     group by f.id, f.nombre, f.fecha
  ),
  totales as (
    select count(*)::int as pedidos, coalesce(sum(total), 0)::numeric as total
      from pedidos_rango
  )
  select jsonb_build_object(
    'ventas_por_mes', coalesce(
      (select jsonb_agg(jsonb_build_object('mes', mes, 'pedidos', pedidos, 'total', total)
                        order by mes)
         from por_mes), '[]'::jsonb),
    'total_periodo',   t.total,
    'pedidos_periodo', t.pedidos,
    'ticket_promedio', case when t.pedidos > 0 then round(t.total / t.pedidos, 2) else 0 end,
    'mas_vendidos', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'producto_id', producto_id, 'nombre', nombre,
                'unidades', unidades, 'importe', importe)
              order by unidades desc, importe desc, producto_id)
         from top), '[]'::jsonb),
    'clientas_nuevas', (
      select count(*)::int from public.profiles pf
       where pf.rol = 'cliente'
         and pf.created_at >= v_inicio
         and pf.created_at <  v_fin),
    'clientas_con_compra', (
      select count(distinct user_id)::int from pedidos_rango
       where origen = 'checkout' and user_id is not null),
    'por_origen', jsonb_build_object(
      'checkout', (select jsonb_build_object('pedidos', count(*)::int,
                                             'total', coalesce(sum(total), 0)::numeric)
                     from pedidos_rango where origen = 'checkout'),
      'admin',    (select jsonb_build_object('pedidos', count(*)::int,
                                             'total', coalesce(sum(total), 0)::numeric)
                     from pedidos_rango where origen = 'admin'),
      'feria',    (select jsonb_build_object('pedidos', count(*)::int,
                                             'total', coalesce(sum(total), 0)::numeric)
                     from pedidos_rango where origen = 'feria')),
    'por_feria', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'feria_id', id, 'nombre', nombre, 'fecha', fecha,
                'pedidos', pedidos, 'total', total, 'efectivo', efectivo,
                'transferencia', transferencia, 'mercadopago', mercadopago)
              order by fecha desc, nombre)
         from ferias_rango), '[]'::jsonb)
  )
  into v_res
  from totales t;

  return v_res;
end;
$$;

revoke execute on function public.estadisticas(date, date) from public, anon;
grant execute on function public.estadisticas(date, date) to authenticated;

commit;
