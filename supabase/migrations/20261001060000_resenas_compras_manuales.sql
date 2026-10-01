-- ============================================================================
-- Pecora — Reseñas: también cuentan las compras cargadas a mano.
--
-- Problema: solo podía opinar quien compró por la web con su cuenta. Las
-- ventas por WhatsApp se cargan como pedido manual (origen 'admin') y ahí
-- user_id es la cuenta del staff, no la de la clienta: esas clientas nunca
-- podían dejar reseña, por más que hubieran comprado.
--
-- Ahora compra verificada = pedido no cancelado y fuera de la papelera que
-- incluye el producto, y además:
--   * del checkout hecho con esa cuenta (como antes), o
--   * cargado a mano con el email de esa cuenta (sin importar mayúsculas ni
--     espacios). El pedido manual tiene un campo Email opcional para esto; los
--     pedidos manuales no mandan mails, así que anotarlo no le envía nada.
--
-- Idempotente. Tests: supabase/tests/resenas_compras_manuales.test.sql.
-- ============================================================================

begin;

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
              and lower(btrim(p.email)) = (
                select lower(btrim(u.email)) from auth.users u where u.id = p_user_id
              )
            )
          )
     );
$$;

revoke execute on function public.compra_verificada(uuid, uuid) from public, anon, authenticated;

create index if not exists pedidos_email_manual_idx
  on public.pedidos (lower(btrim(email)))
  where origen = 'admin' and email is not null;

commit;
