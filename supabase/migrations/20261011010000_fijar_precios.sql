-- ============================================================================
-- Pecora — Fijar precios en bloque.
--
-- "Ajustar precios" solo subía o bajaba un %. Para dejar todos los productos
-- (o los de una categoría) en un precio en particular (ej. todas las medias a
-- $5.000) había que editarlos uno por uno.
--
-- fijar_precios(p_precio, p_categoria_id, p_simular):
--   * p_precio: el precio nuevo, mayor a 0 (hasta 99.999.999,99, lo que entra
--     en productos.precio numeric(10,2)). Se guarda con 2 decimales.
--   * p_categoria_id: null = todos los productos; si no, solo esa categoría.
--   * p_simular (default true): no cambia nada, devuelve la vista previa.
--
-- Devuelve lo mismo que ajustar_precios: { cambios: [{id, nombre, antes,
-- despues}], cantidad }; los productos que ya tienen ese precio no aparecen.
-- Todo o nada. SECURITY INVOKER (el UPDATE pasa por la RLS de productos) +
-- chequeo de es_staff() para dar un error claro (42501).
--
-- Idempotente. Tests: supabase/tests/fijar_precios.test.sql.
-- ============================================================================

begin;

create or replace function public.fijar_precios(
  p_precio       numeric,
  p_categoria_id uuid default null,
  p_simular      boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_precio  numeric := round(p_precio, 2);
  v_cambios jsonb;
begin
  if not coalesce(public.es_staff(), false) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_precio is null or v_precio <= 0 or v_precio > 99999999.99 then
    raise exception 'El precio tiene que ser mayor a 0' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'nombre', p.nombre, 'antes', p.precio, 'despues', v_precio
         ) order by p.nombre), '[]'::jsonb)
    into v_cambios
    from public.productos p
   where (p_categoria_id is null or p.categoria_id = p_categoria_id)
     and p.precio <> v_precio;

  if not coalesce(p_simular, true) then
    update public.productos p
       set precio = v_precio
      from jsonb_array_elements(v_cambios) c
     where p.id = (c ->> 'id')::uuid;
  end if;

  return jsonb_build_object('cambios', v_cambios, 'cantidad', jsonb_array_length(v_cambios));
end;
$$;

revoke execute on function public.fijar_precios(numeric, uuid, boolean) from public, anon;
grant execute on function public.fijar_precios(numeric, uuid, boolean) to authenticated;

commit;
