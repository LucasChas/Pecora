-- ============================================================================
-- Pecora — "Mis pedidos" también muestra las compras por WhatsApp.
--
-- Las ventas por WhatsApp se cargan como pedido manual (origen 'admin') y su
-- user_id es el del staff, así que la clienta no las veía en "Mis pedidos" y
-- no podía calificar esos productos desde ahí.
--
-- mis_pedidos(p_numero default null): los pedidos de la cuenta logueada:
--   * los del checkout hechos con esa cuenta (como antes), y
--   * los manuales cargados con el email de la cuenta (sin importar
--     mayúsculas ni espacios), SOLO si ese email está confirmado. Si no, una
--     cuenta registrada con el email de otra persona vería sus pedidos
--     (dirección, teléfono).
-- Con p_numero, solo ese pedido (para el comprobante).
-- Las cuentas del staff no ven acá sus cargas manuales (no son compras suyas).
--
-- compra_verificada (reseñas) pasa a pedir lo mismo: email confirmado para
-- contar los pedidos manuales.
--
-- Idempotente. Tests: supabase/tests/mis_pedidos.test.sql.
-- ============================================================================

begin;

-- Email confirmado de la cuenta (minúsculas, sin espacios) o null.
create or replace function public.email_confirmado_de(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(btrim(u.email))
    from auth.users u
   where u.id = p_user_id
     and u.email_confirmed_at is not null
     and nullif(btrim(u.email), '') is not null;
$$;

revoke execute on function public.email_confirmado_de(uuid) from public, anon, authenticated;

create or replace function public.mis_pedidos(p_numero int default null)
returns setof public.pedidos
language sql
stable
security definer
set search_path = public
as $$
  with yo as (
    select auth.uid() as uid, public.email_confirmado_de(auth.uid()) as email
  )
  select p.*
    from public.pedidos p, yo
   where yo.uid is not null
     and (p_numero is null or p.numero = p_numero)
     and (
       (p.origen = 'checkout' and p.user_id = yo.uid)
       or (
         p.origen = 'admin'
         and yo.email is not null
         and lower(btrim(p.email)) = yo.email
       )
     )
   order by p.created_at desc;
$$;

revoke execute on function public.mis_pedidos(int) from public, anon;
grant execute on function public.mis_pedidos(int) to authenticated;

create or replace function public.compra_verificada(p_user_id uuid, p_producto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
     and p_producto_id is not null
     and exists (
       select 1
         from public.ventas_validas v
         join public.pedidos p on p.id = v.pedido_id
        where v.producto_id = p_producto_id
          and (
            (v.origen = 'checkout' and v.user_id = p_user_id)
            or (
              v.origen = 'admin'
              and nullif(btrim(p.email), '') is not null
              and lower(btrim(p.email)) = public.email_confirmado_de(p_user_id)
            )
          )
     );
$$;

revoke execute on function public.compra_verificada(uuid, uuid) from public, anon, authenticated;

commit;
