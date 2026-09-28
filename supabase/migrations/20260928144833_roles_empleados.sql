-- ============================================================================
-- Pecora — Migración roles_empleados: rol "empleado" (equipo de la tienda).
--
-- Qué cambia:
--   1) profiles.rol admite 'cliente' | 'empleado' | 'admin'.
--   2) es_staff(): true si quien llama es admin o empleado (SECURITY DEFINER
--      stable, igual que es_admin()).
--   3) Permisos del empleado (policies reemplazadas por nombre):
--        productos y categorías   alta / edición / borrado        (staff)
--        storage bucket productos subir / reemplazar / borrar     (staff)
--        pedidos                  ver todos y actualizar          (staff)
--                                 reenviar mails (RPC)            (staff)
--                                 borrado definitivo              (solo admin)
--      El empleado solo puede cambiar `estado` y `eliminado_at` de un pedido
--      (cambiar de estado, mandar a la papelera y restaurar); el resto de las
--      columnas (descuento, envío, ítems, datos de la clienta) quedan para la
--      admin. Lo controla el trigger pedidos_limitar_empleado.
--      Siguen siendo SOLO admin: cupones, cupon_usos, zonas_envio (escritura),
--      estadisticas (otra migración), la gestión del
--      equipo (Edge Function gestionar-equipo) y la vista ventas_validas.
--   4) ventas_validas: desde la API, una cuenta que no es admin ve solo sus
--      propias compras (antes lo garantizaba el RLS de pedidos, pero ahora un
--      empleado puede leer todos los pedidos). Dentro de funciones SECURITY
--      DEFINER (current_user = dueño) la vista no filtra: la usan
--      estadisticas() y mas_vendidos(), que hacen su propio control.
--   5) crear_pedido y validar_cupon: la carga manual (origen 'admin') y la
--      vista previa del cupón manual valen para admin y empleado (es_staff()).
--      Mismas reglas de cupón que para la admin: sin chequeos por clienta.
--   6) equipo_listar() y usuario_id_por_email(text): solo service_role, para
--      la Edge Function gestionar-equipo (leen auth.users).
--
-- El rol NO se puede cambiar desde la app (0014, sin cambios): solo con la
-- service-role key (Edge Function gestionar-equipo) o desde el SQL Editor.
--
-- Es idempotente. Al final está cómo revertirla.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) profiles.rol: 'cliente' | 'empleado' | 'admin'.
--
-- La check de la 0005 es inline (nombre generado por Postgres, normalmente
-- profiles_rol_check): se busca y se borra cualquier check sobre `rol` que no
-- sea la nueva.
-- ----------------------------------------------------------------------------
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.profiles'::regclass
       and c.contype = 'c'
       and c.conname <> 'profiles_rol_valido'
       and pg_get_constraintdef(c.oid) ilike '%rol%'
  loop
    execute format('alter table public.profiles drop constraint %I', v_nombre);
  end loop;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass
                    and conname = 'profiles_rol_valido') then
    alter table public.profiles
      add constraint profiles_rol_valido check (rol in ('cliente', 'empleado', 'admin'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) es_staff()
-- ----------------------------------------------------------------------------
create or replace function public.es_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and rol in ('admin', 'empleado')
  );
$$;

comment on function public.es_staff() is
  'true si el usuario actual es admin o empleado. Se usa en las policies RLS.';

-- ----------------------------------------------------------------------------
-- 3) Policies.
-- ----------------------------------------------------------------------------

-- Productos y categorías: escritura para el staff.
drop policy if exists "productos escritura admin" on public.productos;
drop policy if exists "productos escritura staff" on public.productos;
create policy "productos escritura staff"
  on public.productos for all to authenticated
  using (public.es_staff()) with check (public.es_staff());

drop policy if exists "categorias escritura admin" on public.categorias;
drop policy if exists "categorias escritura staff" on public.categorias;
create policy "categorias escritura staff"
  on public.categorias for all to authenticated
  using (public.es_staff()) with check (public.es_staff());

-- Storage (bucket productos): fotos de productos, para el staff.
drop policy if exists "productos storage insert admin" on storage.objects;
drop policy if exists "productos storage insert staff" on storage.objects;
create policy "productos storage insert staff"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'productos' and public.es_staff());

drop policy if exists "productos storage update admin" on storage.objects;
drop policy if exists "productos storage update staff" on storage.objects;
create policy "productos storage update staff"
  on storage.objects for update to authenticated
  using (bucket_id = 'productos' and public.es_staff())
  with check (bucket_id = 'productos' and public.es_staff());

drop policy if exists "productos storage delete admin" on storage.objects;
drop policy if exists "productos storage delete staff" on storage.objects;
create policy "productos storage delete staff"
  on storage.objects for delete to authenticated
  using (bucket_id = 'productos' and public.es_staff());

-- Pedidos: la clienta ve los suyos (también los de la papelera, como
-- cancelados: 0010); el staff ve todos.
drop policy if exists "pedidos select propio o admin" on public.pedidos;
drop policy if exists "pedidos select propio o staff" on public.pedidos;
create policy "pedidos select propio o staff"
  on public.pedidos for select to authenticated
  using (user_id = auth.uid() or public.es_staff());

-- Actualizar (estado, papelera): staff. Qué columnas puede tocar el empleado
-- lo limita el trigger de abajo.
drop policy if exists "pedidos update admin" on public.pedidos;
drop policy if exists "pedidos update staff" on public.pedidos;
create policy "pedidos update staff"
  on public.pedidos for update to authenticated
  using (public.es_staff()) with check (public.es_staff());

-- "pedidos delete admin" (0007) queda igual: el borrado definitivo es solo de
-- la admin.

-- ----------------------------------------------------------------------------
-- 3b) El empleado solo cambia estado y papelera.
--
-- SECURITY INVOKER a propósito (como proteger_rol_perfil de la 0014): así
-- current_user es el rol de quien escribe. Solo se aplica a las escrituras
-- que vienen de la API (authenticated/anon) y no son de una admin; el backend
-- (service_role: marcas de mail enviado) y el SQL Editor no se ven afectados.
-- `total` es generada: se excluye de la comparación.
-- ----------------------------------------------------------------------------
create or replace function public.pedidos_limitar_empleado()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not coalesce(public.es_admin(), false) then
    if (to_jsonb(new) - array['estado', 'eliminado_at', 'total'])
       is distinct from (to_jsonb(old) - array['estado', 'eliminado_at', 'total']) then
      raise exception 'No autorizado: solo la admin puede modificar los datos del pedido'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_limitar_empleado on public.pedidos;
create trigger pedidos_limitar_empleado
  before update on public.pedidos
  for each row execute function public.pedidos_limitar_empleado();

-- ----------------------------------------------------------------------------
-- 4) ventas_validas: solo la admin ve todas las ventas.
--
-- Misma definición que 20260928010452_ventas_validas.sql (mismas columnas, así
-- el create or replace no falla) más la condición final. current_user no es
-- authenticated/anon solo dentro de una función SECURITY DEFINER (o desde el
-- SQL Editor / service_role): ahí quien filtra es la función.
-- ----------------------------------------------------------------------------
create or replace view public.ventas_validas
with (security_invoker = true)
as
select
  p.id          as pedido_id,
  p.numero,
  p.created_at,
  p.user_id,
  p.origen,
  i.producto_id,
  i.nombre,
  i.precio,
  i.cantidad,
  i.precio * i.cantidad as importe
from public.pedidos p
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(p.items) = 'array' then p.items else '[]'::jsonb end
) as e(item)
cross join lateral (
  select
    case
      when e.item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (e.item->>'id')::uuid
    end as producto_id,
    e.item->>'nombre' as nombre,
    case
      when jsonb_typeof(e.item->'precio') = 'number'
      then (e.item->>'precio')::numeric
    end as precio,
    case
      when jsonb_typeof(e.item->'cantidad') = 'number'
      then round((e.item->>'cantidad')::numeric)::int
    end as cantidad
) as i
where p.estado <> 'cancelado'
  and p.eliminado_at is null
  and (current_user not in ('authenticated', 'anon')
       or p.user_id = auth.uid()
       or public.es_admin());

comment on view public.ventas_validas is
  'Una fila por ítem vendido (pedidos no cancelados y fuera de la papelera). '
  'security_invoker: respeta el RLS de pedidos; desde la API solo la admin ve '
  'todas las ventas (el resto, solo las propias).';

revoke all on public.ventas_validas from public, anon, authenticated;
grant select on public.ventas_validas to authenticated;

-- ----------------------------------------------------------------------------
-- 5a) validar_cupon: la vista previa del pedido manual vale para el staff.
-- ----------------------------------------------------------------------------
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
    coalesce(p_pedido_manual, false) and coalesce(public.es_staff(), false)
  ) - 'cupon_id';
end;
$$;

revoke execute on function public.validar_cupon(text, numeric, boolean) from public, anon;
grant execute on function public.validar_cupon(text, numeric, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 5b) reenviar_emails_pedido: también para el empleado (gestiona pedidos).
-- Mismo cuerpo que 20260928022104_reenviar_emails_pedido.sql con es_staff().
-- El mensaje de error queda igual (el front y los tests lo conocen).
-- ----------------------------------------------------------------------------
create or replace function public.reenviar_emails_pedido(p_pedido_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen     text;
  v_request_id bigint;
begin
  if not coalesce(public.es_staff(), false) then
    raise exception 'Solo la administradora puede reenviar los mails de un pedido.'
      using errcode = '42501';
  end if;

  select origen into v_origen from public.pedidos where id = p_pedido_id;
  if not found then
    raise exception 'El pedido no existe.' using errcode = 'P0002';
  end if;

  -- La Edge Function no manda nada para las cargas manuales: no tiene sentido
  -- llamarla.
  if v_origen = 'admin' then
    raise exception 'Los pedidos cargados a mano no mandan mails.';
  end if;

  v_request_id := public.invocar_email_pedido(p_pedido_id);
  if v_request_id is null then
    raise exception 'El envío de mails no está configurado: faltan la URL o el token de la función en Vault.';
  end if;

  return v_request_id;
end;
$$;

revoke execute on function public.reenviar_emails_pedido(uuid) from public, anon;
grant execute on function public.reenviar_emails_pedido(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5c) crear_pedido: misma firma y cuerpo que 20260928122650_cupones_y_envios,
-- con es_staff() en lugar de es_admin() para la carga manual.
-- ----------------------------------------------------------------------------
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

  -- Carga manual: la puede hacer el staff (admin o empleado).
  v_origen := case
    when public.es_staff() then coalesce(nullif(p_origen, ''), 'checkout')
    else 'checkout'
  end;
  v_entrega := coalesce(nullif(p_entrega, ''), 'coordinar');
  -- Pedido manual: lo carga el staff para una clienta. v_origen solo puede ser
  -- 'admin' si es_staff(), pero se vuelve a chequear por claridad.
  v_manual := v_origen = 'admin' and coalesce(public.es_staff(), false);

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
  -- pedido manual no hay chequeos por clienta (quien llama es el staff).
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
    -- Pedido manual: user_id null, así no consume el cupo por clienta de quien
    -- lo cargó (sí cuenta para usos_max).
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

-- ----------------------------------------------------------------------------
-- 6) Helpers para la Edge Function gestionar-equipo (SOLO service_role: leen
--    auth.users, que no se expone por la API).
-- ----------------------------------------------------------------------------

-- Equipo actual (admin + empleado) con email y último ingreso.
create or replace function public.equipo_listar()
returns table (id uuid, email text, nombre text, rol text, ultimo_ingreso timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, u.email::text, p.nombre, p.rol, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.rol in ('admin', 'empleado')
   order by case p.rol when 'admin' then 0 else 1 end,
            lower(coalesce(nullif(btrim(p.nombre), ''), u.email)), p.id;
$$;

revoke execute on function public.equipo_listar() from public, anon, authenticated;
grant execute on function public.equipo_listar() to service_role;

-- id de la cuenta con ese email (sin distinguir mayúsculas), o null.
create or replace function public.usuario_id_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   order by u.created_at
   limit 1;
$$;

revoke execute on function public.usuario_id_por_email(text) from public, anon, authenticated;
grant execute on function public.usuario_id_por_email(text) to service_role;

-- ============================================================================
-- Cómo revertirla (hacer un backup antes). Primero bajar a 'cliente' a los
-- empleados, si no la check vieja no se puede volver a agregar:
--
--   begin;
--   update public.profiles set rol = 'cliente' where rol = 'empleado';
--   alter table public.profiles drop constraint if exists profiles_rol_valido;
--   alter table public.profiles add constraint profiles_rol_check
--     check (rol in ('cliente', 'admin'));
--   drop function if exists public.equipo_listar();
--   drop function if exists public.usuario_id_por_email(text);
--   drop trigger if exists pedidos_limitar_empleado on public.pedidos;
--   drop function if exists public.pedidos_limitar_empleado();
--   -- Policies: volver a crear las de 0005 / 0010 con es_admin() y borrar las
--   -- "... staff" de este archivo (mismos nombres que acá con "admin").
--   -- ventas_validas: volver a correr 20260928010452_ventas_validas.sql.
--   -- crear_pedido / validar_cupon: volver a correr sus definiciones de
--   -- 20260928122650_cupones_y_envios.sql (create or replace + revoke/grant).
--   -- reenviar_emails_pedido: volver a correr su definición de
--   -- 20260928022104_reenviar_emails_pedido.sql.
--   -- es_staff() la usan otras migraciones posteriores (estadisticas,
--   -- importar_productos): revertir esas antes de borrarla.
--   commit;
-- ============================================================================
