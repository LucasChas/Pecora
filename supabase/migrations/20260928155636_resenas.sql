-- ============================================================================
-- Pecora — Migración resenas: reseñas con estrellas de compradoras verificadas.
--
-- Qué agrega:
--   1) Tabla public.resenas: una reseña por (producto, cuenta), con estrellas
--      (1 a 5), comentario opcional (sin espacios en los extremos, hasta 1000
--      caracteres) y `oculta` para moderación.
--   2) Compra verificada = la cuenta tiene al menos un pedido propio del
--      checkout (origen 'checkout'), no cancelado y fuera de la papelera, que
--      incluye el producto. Es la misma regla que ventas_validas. Se excluyen
--      las cargas manuales (origen 'admin'): ahí user_id es la cuenta del
--      staff que cargó el pedido, no la de la clienta.
--   3) RPCs (SECURITY DEFINER, única vía de escritura):
--        guardar_resena(p_producto_id, p_estrellas, p_comentario) -> uuid
--            alta o edición de la reseña propia; 42501 sin login o sin compra
--            verificada. Editar no des-oculta una reseña moderada.
--        borrar_resena(p_producto_id) -> boolean      borra la propia
--        ocultar_resena(p_id, p_oculta) -> boolean   moderación, SOLO admin
--   4) Lectura pública sin exponer cuentas:
--        resenas_de_producto(p_producto_id)  visibles, con nombre_corto (solo
--                                            el primer nombre, nunca el email)
--        resumen_resenas(p_producto_id)      promedio y cantidad (visibles)
--        puede_resenar(p_producto_id)        para mostrar el formulario
--        mi_resena(p_producto_id)            la propia (aunque esté oculta)
--        resenas_moderacion(p_solo_ocultas, p_limite)   lista del panel, admin
--      Además la tabla se puede leer directo con RLS: anon y clientas ven solo
--      las visibles; el staff (admin o empleado) ve todas. La columna user_id
--      NO se otorga a anon/authenticated (permisos por columna), así no se
--      pueden agrupar reseñas por cuenta desde la API.
--
-- Moderación solo admin (no empleado): ocultar una reseña es una decisión
-- sobre lo que ve el público, como los cupones o los envíos, y vive en
-- "Ajustes", que es solo de la admin (lib/roles.ts). El empleado igual puede
-- LEER las ocultas (RLS de staff), pero no cambiarlas.
--
-- Si un pedido se cancela después, la reseña queda (la puede borrar su autora
-- o la admin ocultarla), pero ya no se puede editar.
--
-- Es idempotente. Al final están la verificación y cómo revertirla.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabla.
-- ----------------------------------------------------------------------------
create table if not exists public.resenas (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  estrellas   smallint not null,
  comentario  text,
  oculta      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint resenas_una_por_cuenta unique (producto_id, user_id),
  constraint resenas_estrellas_rango check (estrellas between 1 and 5),
  constraint resenas_comentario_valido check (
    comentario is null
    or (comentario = btrim(comentario) and char_length(comentario) between 1 and 1000)
  )
);

create index if not exists resenas_user_id_idx on public.resenas (user_id);
-- Listado público por producto (las más nuevas primero).
create index if not exists resenas_producto_visibles_idx
  on public.resenas (producto_id, created_at desc)
  where not oculta;

drop trigger if exists resenas_set_updated_at on public.resenas;
create trigger resenas_set_updated_at
  before update on public.resenas
  for each row execute function public.set_updated_at();

alter table public.resenas enable row level security;

-- Lectura: visibles para todos; el staff ve también las ocultas.
drop policy if exists "resenas lectura visibles o staff" on public.resenas;
create policy "resenas lectura visibles o staff"
  on public.resenas for select
  to anon, authenticated
  using (not oculta or public.es_staff());

-- Sin policies de insert/update/delete: se escribe solo por los RPCs.
-- Permisos explícitos (no depender del "auto expose" del proyecto). user_id
-- queda afuera a propósito.
revoke all on table public.resenas from public, anon, authenticated;
grant select (id, producto_id, estrellas, comentario, oculta, created_at, updated_at)
  on table public.resenas to anon, authenticated;
grant all on table public.resenas to service_role;

-- ----------------------------------------------------------------------------
-- 2) Helpers internos (sin EXECUTE para la API).
-- ----------------------------------------------------------------------------

-- ¿La cuenta compró el producto? (pedido propio del checkout, no cancelado y
-- fuera de la papelera). Dentro de una función SECURITY DEFINER
-- ventas_validas no filtra por cuenta: se filtra acá.
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
       select 1 from public.ventas_validas v
        where v.user_id = p_user_id
          and v.producto_id = p_producto_id
          and v.origen = 'checkout'
     );
$$;

revoke execute on function public.compra_verificada(uuid, uuid) from public, anon, authenticated;

-- Nombre para mostrar: solo el primer nombre del perfil (hasta 30
-- caracteres). Si está vacío o parece un email, 'Cliente'.
create or replace function public.nombre_corto_resena(p_nombre text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when v.primero is null or v.primero = '' or v.primero like '%@%' then 'Cliente'
    else left(v.primero, 30)
  end
  from (select split_part(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), ' ', 1)
                 as primero) v;
$$;

revoke execute on function public.nombre_corto_resena(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) Escritura (clienta).
-- ----------------------------------------------------------------------------

-- Crea o edita la reseña propia. Devuelve su id.
create or replace function public.guardar_resena(
  p_producto_id uuid,
  p_estrellas   int,
  p_comentario  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_comentario text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_id         uuid;
begin
  if v_uid is null then
    raise exception 'Tenés que ingresar a tu cuenta para dejar una reseña.'
      using errcode = '42501';
  end if;

  if p_estrellas is null or p_estrellas < 1 or p_estrellas > 5 then
    raise exception 'Elegí entre 1 y 5 estrellas.' using errcode = '22023';
  end if;

  if v_comentario is not null and char_length(v_comentario) > 1000 then
    raise exception 'El comentario puede tener hasta 1000 caracteres.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.productos where id = p_producto_id) then
    raise exception 'El producto no existe.' using errcode = 'P0002';
  end if;

  if not public.compra_verificada(v_uid, p_producto_id) then
    raise exception 'Solo pueden opinar quienes compraron este producto.'
      using errcode = '42501';
  end if;

  -- `oculta` no se toca: editar no des-oculta una reseña moderada.
  insert into public.resenas (producto_id, user_id, estrellas, comentario)
  values (p_producto_id, v_uid, p_estrellas, v_comentario)
  on conflict (producto_id, user_id) do update
    set estrellas  = excluded.estrellas,
        comentario = excluded.comentario
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.guardar_resena(uuid, int, text) from public, anon;
grant execute on function public.guardar_resena(uuid, int, text) to authenticated;

-- Borra la reseña propia del producto. true si había una.
create or replace function public.borrar_resena(p_producto_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Tenés que ingresar a tu cuenta.' using errcode = '42501';
  end if;

  delete from public.resenas
   where producto_id = p_producto_id
     and user_id = v_uid;

  return found;
end;
$$;

revoke execute on function public.borrar_resena(uuid) from public, anon;
grant execute on function public.borrar_resena(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Moderación (solo admin).
-- ----------------------------------------------------------------------------

-- Oculta o vuelve a mostrar una reseña. true si existía.
create or replace function public.ocultar_resena(p_id uuid, p_oculta boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.es_admin(), false) then
    raise exception 'Solo la administradora puede moderar reseñas.' using errcode = '42501';
  end if;

  update public.resenas
     set oculta = coalesce(p_oculta, true)
   where id = p_id;

  return found;
end;
$$;

revoke execute on function public.ocultar_resena(uuid, boolean) from public, anon;
grant execute on function public.ocultar_resena(uuid, boolean) to authenticated;

-- Lista para el panel: las más nuevas primero, con el producto y el nombre
-- corto de la autora (tampoco acá hace falta el email).
create or replace function public.resenas_moderacion(
  p_solo_ocultas boolean default false,
  p_limite       int default 100
)
returns table (
  id              uuid,
  producto_id     uuid,
  producto_nombre text,
  producto_slug   text,
  estrellas       smallint,
  comentario      text,
  nombre_corto    text,
  oculta          boolean,
  created_at      timestamptz,
  updated_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(public.es_admin(), false) then
    raise exception 'Solo la administradora puede moderar reseñas.' using errcode = '42501';
  end if;

  return query
    select r.id, r.producto_id, pr.nombre, pr.slug, r.estrellas, r.comentario,
           public.nombre_corto_resena(pf.nombre), r.oculta, r.created_at, r.updated_at
      from public.resenas r
      join public.productos pr on pr.id = r.producto_id
      left join public.profiles pf on pf.id = r.user_id
     where not coalesce(p_solo_ocultas, false) or r.oculta
     order by r.created_at desc, r.id
     limit greatest(1, least(coalesce(p_limite, 100), 500));
end;
$$;

revoke execute on function public.resenas_moderacion(boolean, int) from public, anon;
grant execute on function public.resenas_moderacion(boolean, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) Lectura pública.
-- ----------------------------------------------------------------------------

-- Reseñas visibles de un producto (las más nuevas primero). es_mia marca la
-- de quien consulta, para ofrecerle editarla.
create or replace function public.resenas_de_producto(p_producto_id uuid)
returns table (
  id           uuid,
  estrellas    smallint,
  comentario   text,
  nombre_corto text,
  created_at   timestamptz,
  updated_at   timestamptz,
  es_mia       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.estrellas, r.comentario, public.nombre_corto_resena(pf.nombre),
         r.created_at, r.updated_at,
         coalesce(r.user_id = auth.uid(), false)
    from public.resenas r
    left join public.profiles pf on pf.id = r.user_id
   where r.producto_id = p_producto_id
     and not r.oculta
   order by r.created_at desc, r.id
   limit 200;
$$;

revoke execute on function public.resenas_de_producto(uuid) from public;
grant execute on function public.resenas_de_producto(uuid) to anon, authenticated;

-- Promedio (1 decimal) y cantidad de reseñas visibles. Sin reseñas:
-- promedio null y cantidad 0.
create or replace function public.resumen_resenas(p_producto_id uuid)
returns table (promedio numeric, cantidad int)
language sql
stable
security definer
set search_path = public
as $$
  select round(avg(r.estrellas)::numeric, 1), count(*)::int
    from public.resenas r
   where r.producto_id = p_producto_id
     and not r.oculta;
$$;

revoke execute on function public.resumen_resenas(uuid) from public;
grant execute on function public.resumen_resenas(uuid) to anon, authenticated;

-- ¿Quien consulta puede reseñar el producto? (logueada y con compra
-- verificada). Si ya tiene reseña también es true: puede editarla.
create or replace function public.puede_resenar(p_producto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.compra_verificada(auth.uid(), p_producto_id);
$$;

revoke execute on function public.puede_resenar(uuid) from public, anon;
grant execute on function public.puede_resenar(uuid) to authenticated;

-- La reseña propia del producto (0 o 1 fila), aunque esté oculta: así la
-- autora puede editarla o borrarla y ve que está en revisión.
create or replace function public.mi_resena(p_producto_id uuid)
returns table (
  id         uuid,
  estrellas  smallint,
  comentario text,
  oculta     boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.estrellas, r.comentario, r.oculta, r.created_at, r.updated_at
    from public.resenas r
   where r.producto_id = p_producto_id
     and r.user_id = auth.uid();
$$;

revoke execute on function public.mi_resena(uuid) from public, anon;
grant execute on function public.mi_resena(uuid) to authenticated;

-- ============================================================================
-- Verificación (correr DESPUÉS de aplicar la migración, en el SQL Editor)
--
-- a) Permisos. Resultado esperado: false, true, false, false, true, false.
--
--      select
--        has_column_privilege('anon', 'public.resenas', 'user_id', 'SELECT')          as anon_ve_user_id,
--        has_column_privilege('anon', 'public.resenas', 'estrellas', 'SELECT')        as anon_ve_estrellas,
--        has_table_privilege('authenticated', 'public.resenas', 'INSERT')             as clienta_inserta,
--        has_function_privilege('anon', 'public.guardar_resena(uuid, int, text)', 'EXECUTE') as anon_guarda,
--        has_function_privilege('anon', 'public.resenas_de_producto(uuid)', 'EXECUTE')       as anon_lee,
--        has_function_privilege('anon', 'public.compra_verificada(uuid, uuid)', 'EXECUTE')   as anon_helper;
--
-- b) Las reseñas publicadas no muestran emails. Resultado esperado: 0.
--
--      select count(*) from (select distinct producto_id from public.resenas) r
--       cross join lateral public.resenas_de_producto(r.producto_id) x
--       where x.nombre_corto like '%@%';
--
-- ============================================================================
-- Cómo revertirla (el front muestra "las reseñas todavía no están
-- disponibles" si los RPCs no existen):
--
--   begin;
--   drop function if exists public.mi_resena(uuid);
--   drop function if exists public.puede_resenar(uuid);
--   drop function if exists public.resumen_resenas(uuid);
--   drop function if exists public.resenas_de_producto(uuid);
--   drop function if exists public.resenas_moderacion(boolean, int);
--   drop function if exists public.ocultar_resena(uuid, boolean);
--   drop function if exists public.borrar_resena(uuid);
--   drop function if exists public.guardar_resena(uuid, int, text);
--   drop function if exists public.nombre_corto_resena(text);
--   drop function if exists public.compra_verificada(uuid, uuid);
--   drop table if exists public.resenas;
--   commit;
--
-- Borrar la tabla borra las reseñas (datos de clientas): hacer un backup antes.
-- ============================================================================
