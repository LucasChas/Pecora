-- ============================================================================
-- Pecora — Cupones que la clienta ve en "Mi cuenta".
--
-- cupones.visible_en_cuenta (default false): la admin elige qué cupones se
-- muestran en Mi cuenta (ej. uno de bienvenida). Los demás siguen siendo
-- códigos que solo conoce quien los recibe.
--
-- cupones_disponibles(): para la cuenta logueada, los cupones visibles que
-- hoy podría usar. Mismas reglas que evaluar_cupon (activo, vigencia, usos
-- totales, usos por clienta, solo primera compra); la compra mínima se
-- muestra pero no filtra (depende del carrito). Devuelve solo lo que la
-- clienta necesita ver.
--
-- Idempotente. Tests: supabase/tests/cupones_visibles.test.sql.
-- ============================================================================

begin;

alter table public.cupones add column if not exists visible_en_cuenta boolean not null default false;

create or replace function public.cupones_disponibles()
returns table (
  codigo              text,
  descripcion         text,
  tipo                text,
  valor               numeric,
  minimo_compra       numeric,
  hasta               timestamptz,
  solo_primera_compra boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.codigo, c.descripcion, c.tipo, c.valor, c.minimo_compra, c.hasta, c.solo_primera_compra
    from public.cupones c
   where auth.uid() is not null
     and c.visible_en_cuenta
     and c.activo
     and (c.desde is null or now() >= c.desde)
     and (c.hasta is null or now() <= c.hasta)
     and (
       c.usos_max is null
       or (select count(*) from public.cupon_usos u join public.pedidos p on p.id = u.pedido_id
            where u.cupon_id = c.id and p.estado <> 'cancelado' and p.eliminado_at is null) < c.usos_max
     )
     and (
       c.usos_por_cliente is null
       or (select count(*) from public.cupon_usos u join public.pedidos p on p.id = u.pedido_id
            where u.cupon_id = c.id and u.user_id = auth.uid()
              and p.estado <> 'cancelado' and p.eliminado_at is null) < c.usos_por_cliente
     )
     and (
       not c.solo_primera_compra
       or not exists (
         select 1 from public.pedidos p
          where p.user_id = auth.uid() and p.origen = 'checkout'
            and p.estado <> 'cancelado' and p.eliminado_at is null
       )
     )
   order by c.hasta nulls last, c.created_at desc;
$$;

revoke execute on function public.cupones_disponibles() from public, anon;
grant execute on function public.cupones_disponibles() to authenticated;

commit;
