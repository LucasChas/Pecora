-- ============================================================================
-- Pecora — Migración estadisticas_mas_vendidos: reportes del panel y "más
-- vendidos" de la tienda.
--
-- Qué agrega:
--   1) estadisticas(p_desde date, p_hasta date) returns jsonb — SOLO admin
--      (42501 para cualquier otra cuenta, incluido el empleado). Rango de
--      fechas inclusivo, en hora de Argentina (America/Argentina/Cordoba):
--        {
--          ventas_por_mes:  [{mes: 'YYYY-MM', pedidos, total}]   todos los meses
--                           del rango, en orden, con 0 si no hubo ventas
--          total_periodo, pedidos_periodo, ticket_promedio (total / pedidos,
--                           redondeado a 2 decimales; 0 sin pedidos)
--          mas_vendidos:    [{producto_id, nombre, unidades, importe}] top 10
--                           por unidades (desempate: importe). nombre = el
--                           actual del producto o, si se borró, el del pedido
--          clientas_nuevas: perfiles con rol cliente creados en el rango
--          clientas_con_compra: cuentas distintas con al menos un pedido de
--                           checkout en el rango (las cargas manuales quedan
--                           a nombre de quien las cargó, por eso no cuentan)
--          por_origen:      {checkout: {pedidos, total}, admin: {pedidos, total}}
--        }
--      Venta = pedido no cancelado y fuera de la papelera (misma regla que la
--      vista ventas_validas y que la reserva de stock de la 0009). Montos de
--      pedidos: pedidos.total (subtotal - descuento + envío). Montos de
--      productos: precio del pedido x cantidad (ventas_validas.importe).
--   2) mas_vendidos(p_limite int default 8, p_dias int default 90)
--      returns table(producto_id uuid, unidades int) — pública (anon +
--      authenticated). Unidades vendidas en los últimos p_dias días, de ambos
--      orígenes (las ventas manuales también son ventas), solo de productos
--      que siguen existiendo. Sin datos personales. p_limite se acota a
--      1..24 y p_dias a 1..365.
--
-- Las dos son SECURITY DEFINER (leen todos los pedidos saltando el RLS) y
-- hacen su propio control de acceso.
--
-- Es idempotente. Para revertirla:
--   drop function if exists public.estadisticas(date, date);
--   drop function if exists public.mas_vendidos(int, int);
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) estadisticas
-- ----------------------------------------------------------------------------
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

  -- [inicio, fin): desde las 00:00 de p_desde hasta las 00:00 del día
  -- siguiente a p_hasta, en hora de Argentina.
  v_inicio := p_desde::timestamp at time zone c_tz;
  v_fin    := (p_hasta + 1)::timestamp at time zone c_tz;

  with pedidos_rango as (
    select p.id, p.user_id, p.origen, p.total,
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
                     from pedidos_rango where origen = 'admin'))
  )
  into v_res
  from totales t;

  return v_res;
end;
$$;

revoke execute on function public.estadisticas(date, date) from public, anon;
grant execute on function public.estadisticas(date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) mas_vendidos (tienda pública)
-- ----------------------------------------------------------------------------
create or replace function public.mas_vendidos(p_limite int default 8, p_dias int default 90)
returns table (producto_id uuid, unidades int)
language sql
stable
security definer
set search_path = public
as $$
  select v.producto_id, sum(v.cantidad)::int as unidades
    from public.ventas_validas v
    join public.productos pr on pr.id = v.producto_id
   where v.cantidad is not null
     and v.cantidad > 0
     and v.created_at >= now() - make_interval(
           days => greatest(1, least(coalesce(p_dias, 90), 365)))
   group by v.producto_id
   order by sum(v.cantidad) desc, max(v.created_at) desc, v.producto_id
   limit greatest(1, least(coalesce(p_limite, 8), 24));
$$;

revoke execute on function public.mas_vendidos(int, int) from public;
grant execute on function public.mas_vendidos(int, int) to anon, authenticated;
