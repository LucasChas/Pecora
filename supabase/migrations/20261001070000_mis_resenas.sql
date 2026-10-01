-- ============================================================================
-- Pecora — mis_resenas(): todas las reseñas de la cuenta en una sola llamada.
--
-- "Mis pedidos" muestra junto a cada producto comprado si ya lo calificó (y
-- con cuántas estrellas) y deja calificarlo desde ahí. Con mi_resena(p) haría
-- falta una llamada por producto; esta devuelve todas las propias juntas.
-- La columna user_id no se otorga a la API, por eso va como RPC.
--
-- Idempotente. Tests: supabase/tests/mis_resenas.test.sql.
-- ============================================================================

begin;

create or replace function public.mis_resenas()
returns table (
  id          uuid,
  producto_id uuid,
  estrellas   smallint,
  comentario  text,
  oculta      boolean,
  created_at  timestamptz,
  updated_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.producto_id, r.estrellas, r.comentario, r.oculta, r.created_at, r.updated_at
    from public.resenas r
   where r.user_id = auth.uid()
   order by r.created_at desc;
$$;

revoke execute on function public.mis_resenas() from public, anon;
grant execute on function public.mis_resenas() to authenticated;

commit;
