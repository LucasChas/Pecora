-- ============================================================================
-- Pecora — Ajuste de precios en bloque.
--
-- Con la inflación, subir todos los precios un X % era editar producto por
-- producto desde el celular (o armar un CSV, que necesita computadora).
--
-- ajustar_precios(p_porcentaje, p_categoria_id, p_redondeo, p_simular):
--   * p_porcentaje: -90 a 500 (ej. 10 = +10 %, -15 = -15 %).
--   * p_categoria_id: null = todos los productos; si no, solo esa categoría.
--   * p_redondeo: 0 = sin redondear; si no, al múltiplo más cercano
--     (ej. 100 → $12.340 queda $12.300). Si el redondeo dejaría un precio en 0
--     o lo movería al revés de lo pedido, ese producto no cambia.
--   * p_simular (default true): no cambia nada, devuelve la vista previa.
--
-- Devuelve jsonb: { cambios: [{id, nombre, antes, despues}], cantidad }.
-- Todo o nada (una sola transacción). Solo staff: es SECURITY INVOKER, así que
-- el UPDATE pasa por la RLS de productos ("productos escritura staff"); además
-- se chequea es_staff() al principio para dar un error claro (42501).
--
-- Idempotente. Tests: supabase/tests/ajustar_precios.test.sql.
-- ============================================================================

begin;

create or replace function public.ajustar_precios(
  p_porcentaje   numeric,
  p_categoria_id uuid default null,
  p_redondeo     int default 0,
  p_simular      boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_redondeo int := coalesce(p_redondeo, 0);
  v_cambios  jsonb;
begin
  if not coalesce(public.es_staff(), false) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_porcentaje is null or p_porcentaje < -90 or p_porcentaje > 500 or p_porcentaje = 0 then
    raise exception 'El porcentaje tiene que estar entre -90 y 500 (y no ser 0)' using errcode = '22023';
  end if;
  if v_redondeo < 0 or v_redondeo > 10000 then
    raise exception 'Redondeo inválido' using errcode = '22023';
  end if;

  -- Si el redondeo deja el precio en 0 o lo mueve al revés de lo pedido (ej.
  -- $800 a -10 % redondeado a $1.000 da $1.000), ese producto queda igual.
  with base as (
    select p.id, p.nombre, p.precio as antes,
           case
             when v_redondeo = 0 then round(p.precio * (1 + p_porcentaje / 100), 2)
             else round(p.precio * (1 + p_porcentaje / 100) / v_redondeo) * v_redondeo
           end as calculado
      from public.productos p
     where p_categoria_id is null or p.categoria_id = p_categoria_id
  ),
  calculo as (
    select id, nombre, antes,
           case
             when calculado <= 0 then antes
             when p_porcentaje > 0 and calculado < antes then antes
             when p_porcentaje < 0 and calculado > antes then antes
             else calculado
           end as despues
      from base
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'nombre', nombre, 'antes', antes, 'despues', despues
         ) order by nombre), '[]'::jsonb)
    into v_cambios
    from calculo
   where despues <> antes;

  if not coalesce(p_simular, true) then
    update public.productos p
       set precio = (c ->> 'despues')::numeric
      from jsonb_array_elements(v_cambios) c
     where p.id = (c ->> 'id')::uuid;
  end if;

  return jsonb_build_object('cambios', v_cambios, 'cantidad', jsonb_array_length(v_cambios));
end;
$$;

revoke execute on function public.ajustar_precios(numeric, uuid, int, boolean) from public, anon;
grant execute on function public.ajustar_precios(numeric, uuid, int, boolean) to authenticated;

commit;
