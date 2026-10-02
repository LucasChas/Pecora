-- ============================================================================
-- Pecora — Compra sin cuenta (como invitada).
--
-- Antes, crear_pedido exigía una sesión: para comprar había que registrarse y
-- confirmar el email. Ahora también se puede comprar como invitada:
--
--   1) crear_pedido sin sesión: el email es obligatorio (le llega el
--      comprobante) y no se pueden usar cupones (los límites por clienta y de
--      primera compra necesitan una cuenta). El pedido queda con user_id null
--      y origen 'checkout'.
--   2) Topes contra abuso (pedidos_proteger_checkout), porque cada pedido
--      reserva stock y el comprobante sale a la dirección que se escriba:
--        * por email y por teléfono: 3 pedidos cada 10 minutos, 6 por día;
--        * en total, entre todas las invitadas: 40 pedidos por hora.
--      Las cuentas siguen con sus límites de antes.
--   3) "Mis pedidos" y las reseñas: si después se crea la cuenta con ese mismo
--      email (confirmado), ve esos pedidos y puede calificar esos productos,
--      igual que con los pedidos cargados a mano.
--
-- Idempotente. Tests: supabase/tests/compra_invitada.test.sql.
-- ============================================================================

begin;

-- ---- 1) crear_pedido ---------------------------------------------------------------
create or replace function public.crear_pedido(
  p_nombre           text,
  p_telefono         text,
  p_email            text,
  p_entrega          text,
  p_direccion        text,
  p_localidad        text,
  p_cp               text,
  p_notas            text,
  p_items            jsonb,
  p_subtotal         numeric,
  p_origen           text default 'checkout',
  p_provincia        text default null,
  p_idempotency_key  uuid default null,
  p_cupon            text default null,
  p_cotizacion_envio uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero        bigint;
  v_pedido_id     uuid;
  v_uid           uuid := auth.uid();
  v_duena         uuid;
  v_origen        text;
  v_entrega       text;
  v_item          jsonb;
  v_id            uuid;
  v_cantidad      int;
  v_nombre        text;
  v_precio        numeric;
  v_stock         int;
  v_items         jsonb := '[]'::jsonb;
  v_subtotal      numeric := 0;
  v_zona          public.zonas_envio%rowtype;
  v_costo_envio   numeric := 0;
  v_descuento     numeric := 0;
  v_cupon         jsonb;
  v_cupon_id      uuid;
  v_cupon_cod     text;
  v_manual        boolean;
  v_cot           public.cotizaciones_envio%rowtype;
  v_cot_usada     boolean := false;
  v_transportista text;
  v_servicio      text;
  v_sucursal      text;
  v_talle_id      uuid;
  v_talle         text;
begin
  -- Sin sesión = compra como invitada: email obligatorio (ahí le llega el
  -- comprobante) y sin cupones (los límites por clienta necesitan una cuenta).
  -- Los topes contra abuso los pone pedidos_proteger_checkout.
  if v_uid is null then
    if nullif(btrim(coalesce(p_email, '')), '') is null
       or btrim(p_email) !~ '^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$' then
      raise exception 'Ingresá un email válido: ahí te mandamos el comprobante del pedido.'
        using errcode = 'P0001';
    end if;
    if nullif(btrim(coalesce(p_cupon, '')), '') is not null then
      raise exception 'Para usar un cupón, iniciá sesión o creá tu cuenta.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Idempotencia. El lock serializa dos llamadas con la misma clave (doble
  -- click): la segunda espera a que termine la primera y, al seguir, ya ve el
  -- pedido creado. Un reintento no vuelve a contar el uso del cupón ni vuelve
  -- a validar la cotización (que ya quedó usada por el primer intento).
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

    -- Producto con talles (tabla producto_talles): el ítem tiene que traer
    -- su talle y se descuenta de ese talle (el stock del producto es la
    -- suma, lo actualiza el trigger de producto_talles).
    v_talle_id := nullif(v_item->>'talle_id', '')::uuid;
    v_talle := null;
    if v_talle_id is not null then
      update public.producto_talles t
         set stock = t.stock - v_cantidad
       where t.id = v_talle_id
         and t.producto_id = v_id
         and t.stock >= v_cantidad
      returning t.talle into v_talle;

      if not found then
        select p.nombre, t.talle, t.stock into v_nombre, v_talle, v_stock
          from public.producto_talles t
          join public.productos p on p.id = t.producto_id
         where t.id = v_talle_id and t.producto_id = v_id;
        if v_nombre is null then
          raise exception 'Uno de los talles de tu carrito ya no está disponible.';
        end if;
        raise exception 'De "%" talle % nos %. Ajustá la cantidad y volvé a intentar.',
          v_nombre, v_talle,
          case when v_stock = 0 then 'no quedan unidades'
               when v_stock = 1 then 'queda 1 unidad'
               else 'quedan ' || v_stock || ' unidades' end;
      end if;

      select nombre, precio into v_nombre, v_precio from public.productos where id = v_id;
    elsif exists (select 1 from public.producto_talles where producto_id = v_id) then
      select nombre into v_nombre from public.productos where id = v_id;
      raise exception 'Elegí el talle de "%" antes de hacer el pedido.', v_nombre;
    else
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
    end if;

    v_subtotal := v_subtotal + v_precio * v_cantidad;
    -- El talle va en el nombre (así lo ven el panel, los mails, el
    -- comprobante y Mis pedidos sin cambios) y aparte, para devolver el stock.
    v_items := v_items || case
      when v_talle_id is null then jsonb_build_object(
        'id', v_id, 'nombre', v_nombre, 'precio', v_precio, 'cantidad', v_cantidad)
      else jsonb_build_object(
        'id', v_id, 'nombre', v_nombre || ' (talle ' || v_talle || ')',
        'precio', v_precio, 'cantidad', v_cantidad,
        'talle_id', v_talle_id, 'talle', v_talle)
    end;
  end loop;

  if v_entrega = 'envio' and p_cotizacion_envio is not null then
    -- Envío con transportista: el precio sale de la cotización guardada por
    -- la Edge Function cotizar-envio. La fila se bloquea para que dos pedidos
    -- no usen la misma cotización.
    select * into v_cot from public.cotizaciones_envio
     where id = p_cotizacion_envio
       for update;

    if not found then
      raise exception 'La cotización del envío no es válida. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;
    if v_cot.usada_at is not null then
      raise exception 'La cotización del envío ya se usó en otro pedido. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;
    if v_cot.expira_at <= now() then
      raise exception 'La cotización del envío venció. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;
    if public.normalizar_cp(p_cp) is distinct from v_cot.cp_destino
       or public.slugify(p_provincia) is distinct from public.slugify(v_cot.provincia) then
      raise exception 'El código postal o la provincia no coinciden con los del envío cotizado. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;
    -- Mismos productos y cantidades (agrupados por producto, sin importar el
    -- orden ni si un producto vino repetido en el carrito).
    if (select coalesce(jsonb_agg(jsonb_build_array(pid, cant) order by pid), '[]'::jsonb)
          from (select (e->>'id')::uuid as pid, sum((e->>'cantidad')::int) as cant
                  from jsonb_array_elements(p_items) e group by 1) pedido)
       is distinct from
       (select coalesce(jsonb_agg(jsonb_build_array(pid, cant) order by pid), '[]'::jsonb)
          from (select c.producto_id as pid, sum(c.cantidad) as cant
                  from jsonb_to_recordset(v_cot.items) as c(producto_id uuid, cantidad int)
                 group by 1) cotizado) then
      raise exception 'Tu carrito cambió desde que cotizaste el envío. Volvé a cotizar el envío.'
        using errcode = '22023';
    end if;

    v_costo_envio   := v_cot.precio;
    v_transportista := v_cot.transportista;
    v_servicio      := v_cot.servicio;
    v_sucursal      := case when v_cot.sucursal_id is null then null
                            else concat_ws(' — ', v_cot.sucursal_id, v_cot.sucursal_detalle) end;
    v_cot_usada     := true;
  elsif v_entrega = 'envio' then
    -- Envío por zona: misma lógica que cotizar_envio. Sin zona -> 0 (se coordina).
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
     descuento, costo_envio, cupon_id, cupon_codigo, zona_id, zona_nombre,
     transportista, servicio_envio, sucursal_envio, cotizacion_envio_id)
  values
    (v_uid, p_nombre, p_telefono, nullif(p_email, ''), v_entrega,
     p_direccion, p_localidad, p_cp, nullif(p_provincia, ''), p_notas,
     v_items, v_subtotal, v_origen, p_idempotency_key,
     v_descuento, v_costo_envio, v_cupon_id, v_cupon_cod, v_zona.id, v_zona.nombre,
     v_transportista, v_servicio, v_sucursal,
     case when v_cot_usada then v_cot.id end)
  returning id, numero into v_pedido_id, v_numero;

  if v_cot_usada then
    update public.cotizaciones_envio set usada_at = now() where id = v_cot.id;
  end if;

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
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text, uuid
) from public;
grant execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text, uuid
) to anon, authenticated;

-- ---- 2) Topes ------------------------------------------------------------------------
create or replace function public.pedidos_proteger_checkout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recientes int;
  v_hoy       int;
  v_email     text;
  v_tel       text;
begin
  if char_length(new.nombre) > 120 then
    raise exception 'El nombre es demasiado largo (máximo 120 letras).' using errcode = 'P0001';
  end if;
  if char_length(new.telefono) > 40 then
    raise exception 'El teléfono es demasiado largo.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(new.email, '')) > 254 then
    raise exception 'El email es demasiado largo.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(new.direccion, '')) > 200
     or char_length(coalesce(new.localidad, '')) > 100
     or char_length(coalesce(new.cp, '')) > 20 then
    raise exception 'La dirección es demasiado larga. Acortala y volvé a intentar.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(new.notas, '')) > 1000 then
    raise exception 'Las notas son demasiado largas (máximo 1000 letras).' using errcode = 'P0001';
  end if;
  if jsonb_typeof(new.items) = 'array' and jsonb_array_length(new.items) > 50 then
    raise exception 'El pedido tiene demasiados productos distintos (máximo 50).' using errcode = 'P0001';
  end if;

  if new.origen is distinct from 'checkout' then
    return new;
  end if;

  -- Compra como invitada.
  if new.user_id is null then
    v_email := lower(btrim(coalesce(new.email, '')));
    v_tel := regexp_replace(coalesce(new.telefono, ''), '\D', '', 'g');
    new.email := nullif(btrim(new.email), '');

    -- Un lock por email serializa los intentos con el mismo email; el tope
    -- global se cuenta con otro lock.
    perform pg_advisory_xact_lock(hashtext('pedidos_invitada:' || v_email));

    select count(*) filter (where created_at > now() - interval '10 minutes'),
           count(*)
      into v_recientes, v_hoy
      from public.pedidos
     where user_id is null
       and origen = 'checkout'
       and created_at > now() - interval '1 day'
       and (lower(btrim(coalesce(email, ''))) = v_email
            or (v_tel <> '' and regexp_replace(coalesce(telefono, ''), '\D', '', 'g') = v_tel));

    if v_recientes >= 3 or v_hoy >= 6 then
      raise exception 'Hiciste muchos pedidos seguidos. Esperá un rato o escribinos por WhatsApp.'
        using errcode = 'P0001';
    end if;

    perform pg_advisory_xact_lock(hashtext('pedidos_invitada:global'));
    if (select count(*) from public.pedidos
         where user_id is null and origen = 'checkout'
           and created_at > now() - interval '1 hour') >= 40 then
      raise exception 'Estamos recibiendo muchos pedidos en este momento. Probá de nuevo en un rato o escribinos por WhatsApp.'
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  -- Con cuenta: como antes.
  perform pg_advisory_xact_lock(hashtext('pedidos_checkout:' || new.user_id::text));

  select count(*) filter (where created_at > now() - interval '10 minutes'),
         count(*)
    into v_recientes, v_hoy
    from public.pedidos
   where user_id = new.user_id
     and origen = 'checkout'
     and created_at > now() - interval '1 day';

  if v_recientes >= 5 or v_hoy >= 20 then
    raise exception 'Hiciste muchos pedidos seguidos. Esperá un rato o escribinos por WhatsApp.'
      using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = new.user_id;
  if v_email is not null then
    new.email := v_email;
  end if;

  return new;
end;
$$;

revoke execute on function public.pedidos_proteger_checkout() from public, anon, authenticated;

create index if not exists pedidos_invitada_idx
  on public.pedidos (created_at desc)
  where user_id is null and origen = 'checkout';

-- ---- 3) Mis pedidos y reseñas ------------------------------------------------------------
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
         -- Cargados a mano o hechos como invitada con el email de la cuenta.
         (p.origen = 'admin' or (p.origen = 'checkout' and p.user_id is null))
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
              (v.origen = 'admin' or (v.origen = 'checkout' and v.user_id is null))
              and nullif(btrim(p.email), '') is not null
              and lower(btrim(p.email)) = public.email_confirmado_de(p_user_id)
            )
          )
     );
$$;

revoke execute on function public.compra_verificada(uuid, uuid) from public, anon, authenticated;

commit;
