-- ============================================================================
-- Pecora — Migración cupones_y_envios: cupones de descuento y costo de envío
-- por zona, calculados en la base dentro de crear_pedido.
--
-- Qué cambia:
--   1) Tabla cupones (solo admin; no se pueden listar desde la tienda, así los
--      códigos no se pueden adivinar mirando la API).
--   2) Tabla cupon_usos: un uso por pedido. La escribe solo crear_pedido.
--   3) Tabla zonas_envio: precio por zona (provincias y/o prefijos de CP).
--      Lectura pública de las zonas activas; escritura solo admin.
--   4) pedidos: cupon_id, cupon_codigo, zona_id, zona_nombre (foto del cupón y
--      de la zona al momento de la compra) + check (total >= 0).
--   5) RPC validar_cupon(p_codigo, p_subtotal, p_pedido_manual) -> jsonb
--      (solo logueadas; p_pedido_manual solo cuenta si quien llama es admin).
--      RPC cotizar_envio(p_provincia, p_cp, p_subtotal) -> jsonb (anon + auth).
--   6) crear_pedido: firma nueva de 14 parámetros (p_cupon al final, con
--      default). Calcula costo_envio (si entrega = 'envio') con la misma lógica
--      que cotizar_envio y aplica el cupón con la misma lógica que
--      validar_cupon, en la misma transacción y con la fila del cupón bloqueada
--      (usos_max no se puede pasar con dos compras simultáneas). Cupón inválido
--      -> error P0001 con el mensaje de validación y no queda nada hecho.
--
-- Reglas:
--   * Usos de un cupón = filas de cupon_usos cuyo pedido sigue vigente (no
--     cancelado ni en la papelera). Cancelar un pedido libera el uso; borrarlo
--     definitivamente también (cascade).
--   * "Primera compra" = la clienta no tiene ningún pedido de checkout vigente
--     (no cancelado ni en la papelera).
--   * Pedido manual (crear_pedido con origen 'admin' hecho por una admin): el
--     cupón se evalúa SIN los chequeos por clienta (usos_por_cliente y
--     solo_primera_compra), porque quien llama es la admin y no la clienta.
--     Sí valen activo, vigencia, mínimo y usos_max (con la fila bloqueada). El
--     uso se guarda con user_id null, que no cuenta para ninguna clienta.
--   * El mínimo de compra y el "gratis desde" de la zona se comparan contra el
--     subtotal SIN descuento.
--   * porcentaje -> round(subtotal * valor / 100, 2); monto -> least(valor,
--     subtotal); envio_gratis -> costo_envio = 0 (descuento 0).
--   * Zona: primero la de menor `orden` cuyos prefijos de CP matcheen el CP
--     (a igual orden, el prefijo más largo); si no hay, la de menor `orden`
--     que incluya la provincia (sin distinguir mayúsculas ni acentos). Sin
--     zona -> disponible = false, costo 0 ("se coordina").
--
-- Compatibilidad: p_cupon tiene default, así que el front actual (13
-- parámetros por nombre) sigue funcionando. Se puede aplicar la base antes de
-- desplegar el front nuevo.
--
-- Permisos: las tablas nuevas tienen GRANTs explícitos (no dependen del "auto
-- expose" que se elimina el 2026-10-30).
--
-- Es idempotente: se puede correr más de una vez. Al final está cómo revertirla.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Helpers de formato / normalización (inmutables, sin datos).
-- ----------------------------------------------------------------------------

-- "15000" -> "15.000", "1500.5" -> "1.500,50". Para los mensajes al cliente.
create or replace function public.formato_pesos(p_monto numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(to_char(trunc(abs(coalesce(p_monto, 0))), 'FM999,999,999,990'), ',', '.')
         || case when coalesce(p_monto, 0) <> trunc(coalesce(p_monto, 0))
                 then ',' || lpad((round(abs(p_monto) * 100) % 100)::int::text, 2, '0')
                 else '' end;
$$;

-- CP normalizado: el primer grupo de dígitos. "X5000ABC" -> "5000",
-- " 5000 " -> "5000", "abc" -> null.
create or replace function public.normalizar_cp(p_cp text)
returns text
language sql
immutable
set search_path = public
as $$
  select substring(coalesce(p_cp, '') from '[0-9]+');
$$;

-- ----------------------------------------------------------------------------
-- 1) cupones
-- ----------------------------------------------------------------------------
create table if not exists public.cupones (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null,
  descripcion         text,
  tipo                text not null,
  valor               numeric(12,2) not null default 0,
  minimo_compra       numeric(12,2) not null default 0,
  desde               timestamptz,
  hasta               timestamptz,
  usos_max            int,
  usos_por_cliente    int default 1,
  solo_primera_compra boolean not null default false,
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  constraint cupones_tipo_valido
    check (tipo in ('porcentaje', 'monto', 'envio_gratis')),
  constraint cupones_codigo_no_vacio check (btrim(codigo) <> ''),
  constraint cupones_valor_valido check (
    valor >= 0
    and (tipo <> 'porcentaje' or (valor > 0 and valor <= 100))
    and (tipo <> 'monto' or valor > 0)
  ),
  constraint cupones_minimo_no_negativo check (minimo_compra >= 0),
  constraint cupones_usos_max_positivo check (usos_max is null or usos_max > 0),
  constraint cupones_usos_por_cliente_positivo
    check (usos_por_cliente is null or usos_por_cliente > 0),
  constraint cupones_vigencia_valida
    check (desde is null or hasta is null or hasta > desde)
);

-- Único sin distinguir mayúsculas (además el trigger lo guarda en mayúsculas).
create unique index if not exists cupones_codigo_key
  on public.cupones (upper(codigo));

create or replace function public.cupones_normalizar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.codigo := upper(btrim(new.codigo));
  return new;
end;
$$;

drop trigger if exists cupones_normalizar on public.cupones;
create trigger cupones_normalizar
  before insert or update of codigo on public.cupones
  for each row execute function public.cupones_normalizar();

alter table public.cupones enable row level security;

drop policy if exists "cupones admin" on public.cupones;
create policy "cupones admin"
  on public.cupones for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

revoke all on table public.cupones from anon, authenticated;
grant select, insert, update, delete on table public.cupones to authenticated;

-- ----------------------------------------------------------------------------
-- 2) zonas_envio (antes que pedidos, que la referencia)
-- ----------------------------------------------------------------------------
create table if not exists public.zonas_envio (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  provincias   text[] not null default '{}',
  cp_prefijos  text[] not null default '{}',
  precio       numeric(12,2) not null,
  gratis_desde numeric(12,2),
  activo       boolean not null default true,
  orden        int not null default 0,
  created_at   timestamptz not null default now(),
  constraint zonas_envio_nombre_no_vacio check (btrim(nombre) <> ''),
  constraint zonas_envio_precio_no_negativo check (precio >= 0),
  constraint zonas_envio_gratis_desde_no_negativo
    check (gratis_desde is null or gratis_desde >= 0)
);

create index if not exists zonas_envio_activo_orden_idx
  on public.zonas_envio (orden) where activo;

-- Guarda los prefijos de CP normalizados (solo el primer grupo de dígitos, sin
-- vacíos ni repetidos) y las provincias sin espacios de más.
create or replace function public.zonas_envio_normalizar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.nombre := btrim(new.nombre);
  new.cp_prefijos := coalesce(array(
    select distinct p
      from (select public.normalizar_cp(x) as p from unnest(new.cp_prefijos) x) s
     where p is not null
     order by p
  ), '{}');
  new.provincias := coalesce(array(
    select btrim(x) from unnest(new.provincias) x where btrim(coalesce(x, '')) <> ''
  ), '{}');
  return new;
end;
$$;

drop trigger if exists zonas_envio_normalizar on public.zonas_envio;
create trigger zonas_envio_normalizar
  before insert or update on public.zonas_envio
  for each row execute function public.zonas_envio_normalizar();

alter table public.zonas_envio enable row level security;

drop policy if exists "zonas_envio select activas o admin" on public.zonas_envio;
create policy "zonas_envio select activas o admin"
  on public.zonas_envio for select to anon, authenticated
  using (activo or public.es_admin());

drop policy if exists "zonas_envio insert admin" on public.zonas_envio;
create policy "zonas_envio insert admin"
  on public.zonas_envio for insert to authenticated
  with check (public.es_admin());

drop policy if exists "zonas_envio update admin" on public.zonas_envio;
create policy "zonas_envio update admin"
  on public.zonas_envio for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists "zonas_envio delete admin" on public.zonas_envio;
create policy "zonas_envio delete admin"
  on public.zonas_envio for delete to authenticated
  using (public.es_admin());

revoke all on table public.zonas_envio from anon, authenticated;
grant select on table public.zonas_envio to anon;
grant select, insert, update, delete on table public.zonas_envio to authenticated;

-- ----------------------------------------------------------------------------
-- 3) pedidos: columnas nuevas y total >= 0.
-- ----------------------------------------------------------------------------
alter table public.pedidos
  add column if not exists cupon_id     uuid references public.cupones (id) on delete set null,
  add column if not exists cupon_codigo text,
  add column if not exists zona_id      uuid references public.zonas_envio (id) on delete set null,
  add column if not exists zona_nombre  text;

create index if not exists pedidos_cupon_id_idx on public.pedidos (cupon_id);
create index if not exists pedidos_zona_id_idx on public.pedidos (zona_id);

-- Si en producción ya hubiera pedidos con total negativo (un descuento cargado
-- a mano mayor que subtotal + envío), la constraint se agrega NOT VALID: vale
-- para los pedidos nuevos y los cambios, sin romper la migración. Para verlos:
--   select numero, subtotal, descuento, costo_envio, total
--     from public.pedidos where total < 0;
do $$
begin
  if exists (select 1 from pg_constraint
              where conname = 'pedidos_total_no_negativo'
                and conrelid = 'public.pedidos'::regclass) then
    return;
  end if;
  if exists (select 1 from public.pedidos where total < 0) then
    raise notice 'Hay pedidos con total < 0: pedidos_total_no_negativo se agrega NOT VALID.';
    alter table public.pedidos
      add constraint pedidos_total_no_negativo check (total >= 0) not valid;
  else
    alter table public.pedidos
      add constraint pedidos_total_no_negativo check (total >= 0);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4) cupon_usos
-- ----------------------------------------------------------------------------
create table if not exists public.cupon_usos (
  id         uuid primary key default gen_random_uuid(),
  cupon_id   uuid not null references public.cupones (id) on delete cascade,
  pedido_id  uuid not null unique references public.pedidos (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists cupon_usos_cupon_user_idx
  on public.cupon_usos (cupon_id, user_id);

alter table public.cupon_usos enable row level security;

drop policy if exists "cupon_usos select admin" on public.cupon_usos;
create policy "cupon_usos select admin"
  on public.cupon_usos for select to authenticated
  using (public.es_admin());

revoke all on table public.cupon_usos from anon, authenticated;
grant select on table public.cupon_usos to authenticated;

-- ----------------------------------------------------------------------------
-- 5) Lógica compartida (internas: sin EXECUTE para public/anon/authenticated;
--    las llaman las funciones SECURITY DEFINER de abajo).
-- ----------------------------------------------------------------------------

-- Zona de envío para una provincia / CP, o null si no hay ninguna activa.
create or replace function public.buscar_zona_envio(p_provincia text, p_cp text)
returns uuid
language sql
stable
set search_path = public
as $$
  with entrada as (
    select public.normalizar_cp(p_cp) as cp, public.slugify(p_provincia) as prov
  ),
  por_cp as (
    select z.id, z.orden, z.created_at,
           (select max(length(pre)) from unnest(z.cp_prefijos) pre
             where e.cp like pre || '%') as largo
      from public.zonas_envio z, entrada e
     where z.activo and e.cp is not null
  ),
  por_provincia as (
    select z.id, z.orden, z.created_at
      from public.zonas_envio z, entrada e
     where z.activo and e.prov is not null
       and exists (select 1 from unnest(z.provincias) pr
                    where public.slugify(pr) = e.prov)
  )
  select coalesce(
    (select id from por_cp where largo is not null
      order by orden, largo desc, created_at, id limit 1),
    (select id from por_provincia
      order by orden, created_at, id limit 1)
  );
$$;

revoke execute on function public.buscar_zona_envio(text, text) from public, anon, authenticated;

-- Evalúa un cupón para una clienta y un subtotal. Devuelve el jsonb de
-- validar_cupon más 'cupon_id'. Con p_bloquear = true toma la fila del cupón
-- FOR UPDATE (crear_pedido), así dos compras simultáneas con el mismo cupón
-- se ordenan y la segunda ya ve el uso de la primera.
-- Con p_manual = true (pedido manual de una admin; lo decide quien llama, que
-- ya verificó es_admin()) no hay clienta: se saltean usos_por_cliente y
-- solo_primera_compra.
drop function if exists public.evaluar_cupon(text, numeric, uuid, boolean);

create or replace function public.evaluar_cupon(
  p_codigo   text,
  p_subtotal numeric,
  p_user     uuid,
  p_bloquear boolean default false,
  p_manual   boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_codigo   text := upper(btrim(coalesce(p_codigo, '')));
  v_subtotal numeric := greatest(coalesce(p_subtotal, 0), 0);
  v_cupon    public.cupones%rowtype;
  v_usos     int;
  v_desc     numeric := 0;
  v_invalido jsonb;
begin
  v_invalido := jsonb_build_object(
    'valido', false, 'codigo', nullif(v_codigo, ''), 'tipo', null,
    'descuento', 0, 'envio_gratis', false, 'cupon_id', null,
    'mensaje', 'El cupón no es válido o ya venció.'
  );

  if v_codigo = '' then
    return v_invalido || jsonb_build_object('mensaje', 'Ingresá un código de cupón.');
  end if;

  if p_user is null then
    return v_invalido || jsonb_build_object(
      'mensaje', 'Necesitás iniciar sesión para usar un cupón.');
  end if;

  if p_bloquear then
    select * into v_cupon from public.cupones
     where upper(codigo) = v_codigo for update;
  else
    select * into v_cupon from public.cupones
     where upper(codigo) = v_codigo;
  end if;

  -- Inexistente, inactivo o fuera de fecha: el mismo mensaje genérico, para no
  -- revelar qué códigos existen.
  if not found
     or not v_cupon.activo
     or (v_cupon.desde is not null and now() < v_cupon.desde)
     or (v_cupon.hasta is not null and now() > v_cupon.hasta) then
    return v_invalido;
  end if;

  if v_cupon.usos_max is not null then
    select count(*) into v_usos
      from public.cupon_usos u join public.pedidos p on p.id = u.pedido_id
     where u.cupon_id = v_cupon.id
       and p.estado <> 'cancelado' and p.eliminado_at is null;
    if v_usos >= v_cupon.usos_max then
      return v_invalido || jsonb_build_object(
        'mensaje', 'Este cupón ya no tiene usos disponibles.');
    end if;
  end if;

  -- Por clienta: los usos con user_id null (pedidos manuales) no cuentan.
  if not coalesce(p_manual, false) and v_cupon.usos_por_cliente is not null then
    select count(*) into v_usos
      from public.cupon_usos u join public.pedidos p on p.id = u.pedido_id
     where u.cupon_id = v_cupon.id and u.user_id = p_user
       and p.estado <> 'cancelado' and p.eliminado_at is null;
    if v_usos >= v_cupon.usos_por_cliente then
      return v_invalido || jsonb_build_object('mensaje', 'Ya usaste este cupón.');
    end if;
  end if;

  if not coalesce(p_manual, false) and v_cupon.solo_primera_compra and exists (
    select 1 from public.pedidos p
     where p.user_id = p_user and p.origen = 'checkout'
       and p.estado <> 'cancelado' and p.eliminado_at is null
  ) then
    return v_invalido || jsonb_build_object(
      'mensaje', 'Este cupón es solo para tu primera compra.');
  end if;

  if v_subtotal < v_cupon.minimo_compra then
    return v_invalido || jsonb_build_object(
      'mensaje', 'Este cupón requiere una compra mínima de $ '
                 || public.formato_pesos(v_cupon.minimo_compra) || '.');
  end if;

  v_desc := case v_cupon.tipo
    when 'porcentaje' then round(v_subtotal * v_cupon.valor / 100, 2)
    when 'monto'      then least(v_cupon.valor, v_subtotal)
    else 0
  end;

  return jsonb_build_object(
    'valido', true,
    'codigo', v_cupon.codigo,
    'tipo', v_cupon.tipo,
    'descuento', v_desc,
    'envio_gratis', v_cupon.tipo = 'envio_gratis',
    'cupon_id', v_cupon.id,
    'mensaje', 'Cupón aplicado.'
  );
end;
$$;

revoke execute on function public.evaluar_cupon(text, numeric, uuid, boolean, boolean)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) RPCs públicas.
-- ----------------------------------------------------------------------------

-- {valido, codigo, tipo, descuento, envio_gratis, mensaje}. Solo logueadas:
-- los chequeos de usos por clienta y de primera compra dependen de quién es.
-- p_pedido_manual = true es la vista previa del pedido manual (misma regla que
-- crear_pedido con origen 'admin'); solo se respeta si quien llama es admin,
-- para cualquier otra persona se ignora.
-- Se borra la firma de 2 parámetros: con dos sobrecargas PostgREST no sabría
-- cuál llamar.
drop function if exists public.validar_cupon(text, numeric);

create or replace function public.validar_cupon(
  p_codigo        text,
  p_subtotal      numeric,
  p_pedido_manual boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.evaluar_cupon(
    p_codigo, p_subtotal, auth.uid(), false,
    coalesce(p_pedido_manual, false) and coalesce(public.es_admin(), false)
  ) - 'cupon_id';
end;
$$;

revoke execute on function public.validar_cupon(text, numeric, boolean) from public, anon;
grant execute on function public.validar_cupon(text, numeric, boolean) to authenticated;

-- {zona_id, zona_nombre, costo, gratis, disponible, mensaje}.
create or replace function public.cotizar_envio(
  p_provincia text,
  p_cp        text,
  p_subtotal  numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_zona   public.zonas_envio%rowtype;
  v_gratis boolean;
begin
  select * into v_zona from public.zonas_envio
   where id = public.buscar_zona_envio(p_provincia, p_cp);

  if not found then
    return jsonb_build_object(
      'zona_id', null, 'zona_nombre', null, 'costo', 0, 'gratis', false,
      'disponible', false, 'mensaje', 'Consultanos el costo de envío a tu zona.'
    );
  end if;

  v_gratis := v_zona.gratis_desde is not null
              and coalesce(p_subtotal, 0) >= v_zona.gratis_desde;

  return jsonb_build_object(
    'zona_id', v_zona.id,
    'zona_nombre', v_zona.nombre,
    'costo', case when v_gratis then 0 else v_zona.precio end,
    'gratis', v_gratis,
    'disponible', true,
    'mensaje', case when v_gratis then '¡Tu envío es gratis!' else null end
  );
end;
$$;

revoke execute on function public.cotizar_envio(text, text, numeric) from public;
grant execute on function public.cotizar_envio(text, text, numeric) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) crear_pedido con la firma nueva (14 parámetros).
--
-- Se borra la de 13 en vez de dejar dos versiones: con dos sobrecargas,
-- PostgREST no sabría cuál llamar.
-- ----------------------------------------------------------------------------
drop function if exists public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid
);

create or replace function public.crear_pedido(
  p_nombre          text,
  p_telefono        text,
  p_email           text,
  p_entrega         text,
  p_direccion       text,
  p_localidad       text,
  p_cp              text,
  p_notas           text,
  p_items           jsonb,
  p_subtotal        numeric,
  p_origen          text default 'checkout',
  p_provincia       text default null,
  p_idempotency_key uuid default null,
  p_cupon           text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero      bigint;
  v_pedido_id   uuid;
  v_uid         uuid := auth.uid();
  v_duena       uuid;
  v_origen      text;
  v_entrega     text;
  v_item        jsonb;
  v_id          uuid;
  v_cantidad    int;
  v_nombre      text;
  v_precio      numeric;
  v_stock       int;
  v_items       jsonb := '[]'::jsonb;
  v_subtotal    numeric := 0;
  v_zona        public.zonas_envio%rowtype;
  v_costo_envio numeric := 0;
  v_descuento   numeric := 0;
  v_cupon       jsonb;
  v_cupon_id    uuid;
  v_cupon_cod   text;
  v_manual      boolean;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para hacer un pedido.';
  end if;

  -- Idempotencia. El lock serializa dos llamadas con la misma clave (doble
  -- click): la segunda espera a que termine la primera y, al seguir, ya ve el
  -- pedido creado. Un reintento no vuelve a contar el uso del cupón.
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(p_idempotency_key::text));

    select numero, user_id into v_numero, v_duena
      from public.pedidos
     where idempotency_key = p_idempotency_key;

    if found then
      if v_duena is distinct from v_uid then
        raise exception 'No se pudo registrar el pedido. Recargá la página y volvé a intentar.';
      end if;
      return v_numero;
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Tu carrito está vacío.';
  end if;

  v_origen := case
    when public.es_admin() then coalesce(nullif(p_origen, ''), 'checkout')
    else 'checkout'
  end;
  v_entrega := coalesce(nullif(p_entrega, ''), 'coordinar');
  -- Pedido manual: lo carga una admin para una clienta. v_origen solo puede ser
  -- 'admin' si es_admin(), pero se vuelve a chequear por claridad.
  v_manual := v_origen = 'admin' and coalesce(public.es_admin(), false);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_id := (v_item->>'id')::uuid;
    v_cantidad := coalesce((v_item->>'cantidad')::int, 0);

    if v_cantidad <= 0 then
      raise exception 'La cantidad de uno de los productos no es válida.';
    end if;

    update public.productos
       set stock = stock - v_cantidad
     where id = v_id
       and stock >= v_cantidad
    returning nombre, precio into v_nombre, v_precio;

    if not found then
      select nombre, stock into v_nombre, v_stock
        from public.productos where id = v_id;
      if v_nombre is null then
        raise exception 'Uno de los productos de tu carrito ya no está disponible.';
      end if;
      raise exception 'De "%" nos %. Ajustá la cantidad y volvé a intentar.',
        v_nombre,
        case when v_stock = 1 then 'queda 1 unidad'
             else 'quedan ' || v_stock || ' unidades' end;
    end if;

    v_subtotal := v_subtotal + v_precio * v_cantidad;
    v_items := v_items || jsonb_build_object(
      'id', v_id, 'nombre', v_nombre, 'precio', v_precio, 'cantidad', v_cantidad
    );
  end loop;

  -- Envío: misma lógica que cotizar_envio. Sin zona -> 0 (se coordina).
  if v_entrega = 'envio' then
    select * into v_zona from public.zonas_envio
     where id = public.buscar_zona_envio(p_provincia, p_cp);
    if found then
      v_costo_envio := case
        when v_zona.gratis_desde is not null and v_subtotal >= v_zona.gratis_desde then 0
        else v_zona.precio
      end;
    end if;
  end if;

  -- Cupón: misma lógica que validar_cupon, con la fila del cupón bloqueada.
  -- Si no vale, el error deshace todo (incluido el stock ya descontado). En un
  -- pedido manual no hay chequeos por clienta (quien llama es la admin).
  if nullif(btrim(coalesce(p_cupon, '')), '') is not null then
    v_cupon := public.evaluar_cupon(p_cupon, v_subtotal, v_uid, true, v_manual);
    if not (v_cupon->>'valido')::boolean then
      raise exception '%', v_cupon->>'mensaje';
    end if;
    v_cupon_id  := (v_cupon->>'cupon_id')::uuid;
    v_cupon_cod := v_cupon->>'codigo';
    v_descuento := (v_cupon->>'descuento')::numeric;
    if (v_cupon->>'envio_gratis')::boolean then
      v_costo_envio := 0;
    end if;
  end if;

  insert into public.pedidos
    (user_id, nombre, telefono, email, entrega, direccion, localidad, cp,
     provincia, notas, items, subtotal, origen, idempotency_key,
     descuento, costo_envio, cupon_id, cupon_codigo, zona_id, zona_nombre)
  values
    (v_uid, p_nombre, p_telefono, nullif(p_email, ''), v_entrega,
     p_direccion, p_localidad, p_cp, nullif(p_provincia, ''), p_notas,
     v_items, v_subtotal, v_origen, p_idempotency_key,
     v_descuento, v_costo_envio, v_cupon_id, v_cupon_cod, v_zona.id, v_zona.nombre)
  returning id, numero into v_pedido_id, v_numero;

  if v_cupon_id is not null then
    -- Pedido manual: user_id null, así no consume el cupo por clienta de la
    -- admin (sí cuenta para usos_max).
    insert into public.cupon_usos (cupon_id, pedido_id, user_id)
    values (v_cupon_id, v_pedido_id, case when v_manual then null else v_uid end);
  end if;

  return v_numero;
end;
$$;

revoke execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text
) from public, anon;
grant execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text
) to authenticated;

-- ============================================================================
-- Cómo revertirla (hacer un backup antes). Vuelve a la crear_pedido de 13
-- parámetros y borra cupones, usos y zonas CON sus datos:
--
--   begin;
--   drop function if exists public.crear_pedido(
--     text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text);
--   -- Pegar acá la definición de crear_pedido de 20260928010451_pedido_totales.sql
--   -- (create function + revoke/grant).
--   drop function if exists public.validar_cupon(text, numeric, boolean);
--   drop function if exists public.cotizar_envio(text, text, numeric);
--   drop function if exists public.evaluar_cupon(text, numeric, uuid, boolean, boolean);
--   drop function if exists public.buscar_zona_envio(text, text);
--   alter table public.pedidos
--     drop constraint if exists pedidos_total_no_negativo,
--     drop column if exists cupon_id,
--     drop column if exists cupon_codigo,
--     drop column if exists zona_id,
--     drop column if exists zona_nombre;
--   drop table if exists public.cupon_usos;
--   drop table if exists public.cupones;
--   drop table if exists public.zonas_envio;
--   drop function if exists public.cupones_normalizar();
--   drop function if exists public.zonas_envio_normalizar();
--   drop function if exists public.normalizar_cp(text);
--   drop function if exists public.formato_pesos(numeric);
--   commit;
--
-- Antes de revertir, desplegar el front que no manda p_cupon (si no, PostgREST
-- no encuentra la función). Los descuentos y costos de envío ya guardados en
-- pedidos se conservan (son columnas de la migración pedido_totales).
-- ============================================================================
