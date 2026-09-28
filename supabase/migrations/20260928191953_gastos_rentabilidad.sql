-- ============================================================================
-- Pecora — Migración gastos_rentabilidad: gastos del negocio y
-- rentabilidad (ingresos vs. gastos vs. beneficio).
--
-- Qué agrega:
--   1) Tabla public.gastos — SOLO admin (select/insert/update/delete con
--      es_admin(); anon sin permisos). Una fila por compra o gasto:
--        fecha       date, por defecto hoy en hora de Argentina
--        concepto    texto obligatorio (se recorta; 1 a 200 caracteres)
--        categoria   'materiales' | 'packaging' | 'envios' | 'otros'
--        monto       numeric(12,2) > 0
--        producto_id opcional: la compra es para un producto puntual
--                    (on delete set null: si se borra el producto, el gasto
--                    queda como gasto general y sigue sumando)
--        cantidad    opcional (> 0): unidades del producto que cubre la compra
--                    (ej.: tela para 10 baberos). Con producto + cantidad se
--                    estima el costo por unidad.
--        notas       opcional (se recorta; vacío = null; hasta 1000)
--        created_at, created_by (lo fija el trigger con auth.uid(); no se
--                    puede falsear desde el cliente ni cambiar después)
--   2) rentabilidad(p_desde date, p_hasta date) returns jsonb — SOLO admin
--      (42501 para cualquier otra cuenta, incluido el empleado). Mismo rango
--      y zona horaria que estadisticas() (America/Argentina/Cordoba):
--        {
--          por_mes:  [{mes: 'YYYY-MM', ingresos, gastos, beneficio, margen}]
--                    todos los meses del rango, en orden, con 0 si no hubo
--                    movimiento. margen = beneficio / ingresos * 100
--                    (1 decimal), null sin ingresos.
--          totales:  {ingresos, gastos, beneficio, margen, pedidos}
--          productos: [{producto_id, nombre, unidades_vendidas, ingresos,
--                       costo_unitario_estimado, costo_estimado,
--                       beneficio_estimado, margen, gastos_periodo}]
--                    productos vendidos en el rango o con gastos propios en
--                    el rango. Orden: beneficio_estimado desc (sin costo al
--                    final), ingresos desc.
--          gastos_por_categoria: [{categoria, total}] las 4, en orden fijo
--          gastos_generales: gastos del rango sin producto asociado
--        }
--      Ingresos por mes y totales: pedidos.total (subtotal - descuento +
--      envío) de pedidos no cancelados y fuera de la papelera: son los mismos
--      números que "Ventas por mes" de estadisticas(). Ingresos por producto:
--      ventas_validas.importe (precio del pedido x cantidad, sin descuentos
--      ni envío), igual que "Lo más vendido".
--      Gastos: por gastos.fecha (ya es una fecha de Argentina).
--      costo_unitario_estimado = promedio ponderado de TODAS las compras del
--      producto con cantidad hasta p_hasta (sum(monto) / sum(cantidad)); una
--      compra sirve para ventas de meses posteriores. null sin datos.
--      costo_estimado = costo unitario x unidades vendidas en el rango.
--
-- Es idempotente. Para revertirla:
--   drop function if exists public.rentabilidad(date, date);
--   drop table if exists public.gastos;
--   drop function if exists public.gastos_normalizar();
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) gastos
-- ----------------------------------------------------------------------------
create table if not exists public.gastos (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null default ((now() at time zone 'America/Argentina/Cordoba')::date),
  concepto    text not null,
  categoria   text not null default 'materiales',
  monto       numeric(12,2) not null,
  producto_id uuid references public.productos(id) on delete set null,
  cantidad    integer,
  notas       text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  constraint gastos_concepto_valido
    check (btrim(concepto) <> '' and char_length(concepto) <= 200),
  constraint gastos_categoria_valida
    check (categoria in ('materiales', 'packaging', 'envios', 'otros')),
  constraint gastos_monto_positivo check (monto > 0),
  constraint gastos_cantidad_positiva check (cantidad is null or cantidad > 0),
  constraint gastos_notas_largo check (notas is null or char_length(notas) <= 1000)
);

create index if not exists gastos_fecha_idx on public.gastos (fecha);
create index if not exists gastos_producto_idx on public.gastos (producto_id)
  where producto_id is not null;

-- Recorta los textos y fija quién cargó el gasto (el cliente no lo decide).
create or replace function public.gastos_normalizar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.concepto := btrim(new.concepto);
  new.notas := nullif(btrim(coalesce(new.notas, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists gastos_normalizar on public.gastos;
create trigger gastos_normalizar
  before insert or update on public.gastos
  for each row execute function public.gastos_normalizar();

alter table public.gastos enable row level security;

drop policy if exists "gastos select admin" on public.gastos;
create policy "gastos select admin"
  on public.gastos for select to authenticated
  using (public.es_admin());

drop policy if exists "gastos insert admin" on public.gastos;
create policy "gastos insert admin"
  on public.gastos for insert to authenticated
  with check (public.es_admin());

drop policy if exists "gastos update admin" on public.gastos;
create policy "gastos update admin"
  on public.gastos for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists "gastos delete admin" on public.gastos;
create policy "gastos delete admin"
  on public.gastos for delete to authenticated
  using (public.es_admin());

revoke all on table public.gastos from public, anon, authenticated;
grant select, insert, update, delete on table public.gastos to authenticated;

-- ----------------------------------------------------------------------------
-- 2) rentabilidad
-- ----------------------------------------------------------------------------
create or replace function public.rentabilidad(p_desde date, p_hasta date)
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
    raise exception 'No autorizado: la rentabilidad es solo para la admin'
      using errcode = '42501';
  end if;

  if p_desde is null or p_hasta is null then
    raise exception 'Indicá las fechas desde y hasta.' using errcode = '22023';
  end if;
  if p_desde > p_hasta then
    raise exception 'La fecha desde no puede ser posterior a la fecha hasta.'
      using errcode = '22023';
  end if;

  -- [inicio, fin) en hora de Argentina, igual que estadisticas().
  v_inicio := p_desde::timestamp at time zone c_tz;
  v_fin    := (p_hasta + 1)::timestamp at time zone c_tz;

  with meses as (
    select to_char(m, 'YYYY-MM') as mes
      from generate_series(date_trunc('month', p_desde::timestamp),
                           date_trunc('month', p_hasta::timestamp),
                           interval '1 month') m
  ),
  -- Ventas = pedidos no cancelados y fuera de la papelera (regla de
  -- ventas_validas y de estadisticas()).
  pedidos_rango as (
    select p.total, to_char(p.created_at at time zone c_tz, 'YYYY-MM') as mes
      from public.pedidos p
     where p.estado <> 'cancelado'
       and p.eliminado_at is null
       and p.created_at >= v_inicio
       and p.created_at <  v_fin
  ),
  gastos_rango as (
    select g.*, to_char(g.fecha, 'YYYY-MM') as mes
      from public.gastos g
     where g.fecha between p_desde and p_hasta
  ),
  por_mes as (
    select m.mes,
           coalesce((select sum(pr.total) from pedidos_rango pr where pr.mes = m.mes), 0)::numeric as ingresos,
           coalesce((select sum(g.monto)  from gastos_rango  g  where g.mes  = m.mes), 0)::numeric as gastos
      from meses m
  ),
  ventas as (
    select v.producto_id,
           max(v.nombre)                         as nombre_pedido,
           sum(v.cantidad)::int                  as unidades,
           coalesce(sum(v.importe), 0)::numeric  as ingresos
      from public.ventas_validas v
     where v.producto_id is not null
       and v.cantidad is not null
       and v.created_at >= v_inicio
       and v.created_at <  v_fin
     group by v.producto_id
  ),
  gastos_producto as (
    select g.producto_id, sum(g.monto)::numeric as gastos
      from gastos_rango g
     where g.producto_id is not null
     group by g.producto_id
  ),
  -- Costo por unidad: todas las compras con cantidad hasta p_hasta.
  costos as (
    select g.producto_id,
           sum(g.monto)::numeric   as monto,
           sum(g.cantidad)::numeric as cantidad
      from public.gastos g
     where g.producto_id is not null
       and g.cantidad is not null
       and g.fecha <= p_hasta
     group by g.producto_id
  ),
  productos_rango as (
    select coalesce(v.producto_id, gp.producto_id) as producto_id,
           v.nombre_pedido,
           coalesce(v.unidades, 0)   as unidades,
           coalesce(v.ingresos, 0)   as ingresos,
           coalesce(gp.gastos, 0)    as gastos_periodo
      from ventas v
      full join gastos_producto gp on gp.producto_id = v.producto_id
  ),
  prod as (
    select pr.producto_id,
           coalesce(p.nombre, pr.nombre_pedido, 'Producto eliminado') as nombre,
           pr.unidades,
           pr.ingresos,
           pr.gastos_periodo,
           case when c.cantidad > 0 then round(c.monto / c.cantidad, 2) end as costo_unitario,
           case when c.cantidad > 0 then round(c.monto * pr.unidades / c.cantidad, 2) end as costo_estimado
      from productos_rango pr
      left join public.productos p on p.id = pr.producto_id
      left join costos c on c.producto_id = pr.producto_id
  ),
  prod_final as (
    select prod.*,
           prod.ingresos - prod.costo_estimado as beneficio
      from prod
  ),
  totales as (
    select coalesce(sum(ingresos), 0)::numeric as ingresos,
           coalesce(sum(gastos), 0)::numeric   as gastos,
           (select count(*)::int from pedidos_rango) as pedidos
      from por_mes
  ),
  categorias(categoria, orden) as (
    values ('materiales', 1), ('packaging', 2), ('envios', 3), ('otros', 4)
  )
  select jsonb_build_object(
    'por_mes', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'mes', mes, 'ingresos', ingresos, 'gastos', gastos,
                'beneficio', ingresos - gastos,
                'margen', case when ingresos > 0
                               then round((ingresos - gastos) / ingresos * 100, 1) end)
              order by mes)
         from por_mes), '[]'::jsonb),
    'totales', jsonb_build_object(
      'ingresos', t.ingresos,
      'gastos', t.gastos,
      'beneficio', t.ingresos - t.gastos,
      'margen', case when t.ingresos > 0
                     then round((t.ingresos - t.gastos) / t.ingresos * 100, 1) end,
      'pedidos', t.pedidos),
    'productos', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'producto_id', producto_id,
                'nombre', nombre,
                'unidades_vendidas', unidades,
                'ingresos', ingresos,
                'costo_unitario_estimado', costo_unitario,
                'costo_estimado', costo_estimado,
                'beneficio_estimado', beneficio,
                'margen', case when ingresos > 0 and beneficio is not null
                               then round(beneficio / ingresos * 100, 1) end,
                'gastos_periodo', gastos_periodo)
              order by beneficio desc nulls last, ingresos desc, nombre, producto_id)
         from prod_final), '[]'::jsonb),
    'gastos_por_categoria', (
      select jsonb_agg(jsonb_build_object(
               'categoria', c.categoria,
               'total', coalesce((select sum(g.monto) from gastos_rango g
                                   where g.categoria = c.categoria), 0)::numeric)
             order by c.orden)
        from categorias c),
    'gastos_generales', coalesce(
      (select sum(g.monto) from gastos_rango g where g.producto_id is null), 0)::numeric
  )
  into v_res
  from totales t;

  return v_res;
end;
$$;

revoke execute on function public.rentabilidad(date, date) from public, anon;
grant execute on function public.rentabilidad(date, date) to authenticated;
