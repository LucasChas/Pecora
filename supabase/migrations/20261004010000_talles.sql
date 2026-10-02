-- ============================================================================
-- Pecora — Talles por producto (stock por talle).
--
-- Un producto puede tener talles (ej. "0-3 m", "3-6 m", "6-9 m"), cada uno con
-- su stock. Es opcional: los productos sin talles siguen igual que siempre.
--
--   1) Tabla producto_talles (producto_id, talle, stock, orden). Lectura
--      pública; la cambia solo el staff (admin o empleado).
--   2) productos.stock de un producto con talles = suma de sus talles. Lo
--      mantiene el trigger de producto_talles; así el catálogo, el "Agotado",
--      el aviso de reposición, el stock bajo y las estadísticas siguen
--      funcionando sin cambios. Mientras tenga talles, cambiar productos.stock
--      a mano no tiene efecto (se conserva la suma).
--   3) crear_pedido: en un producto con talles el ítem tiene que traer
--      talle_id; se descuenta de ese talle. En el pedido, el ítem guarda el
--      talle en el nombre ("Body (talle 3-6 m)") y aparte (talle_id, talle).
--   4) ajustar_stock_pedido (cancelar, reactivar o borrar un pedido) devuelve
--      o descuenta el stock del talle cuando el ítem lo tiene.
--
-- Idempotente. Tests: supabase/tests/talles.test.sql.
-- ============================================================================

begin;

-- ---- 1) Tabla ----------------------------------------------------------------------
create table if not exists public.producto_talles (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  talle       text not null,
  stock       integer not null default 0,
  orden       integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint producto_talles_talle_valido check (char_length(btrim(talle)) between 1 and 30),
  constraint producto_talles_stock_valido check (stock >= 0)
);

create unique index if not exists producto_talles_unico
  on public.producto_talles (producto_id, lower(btrim(talle)));
create index if not exists producto_talles_producto_idx
  on public.producto_talles (producto_id, orden);

alter table public.producto_talles enable row level security;

drop policy if exists "talles lectura publica" on public.producto_talles;
create policy "talles lectura publica"
  on public.producto_talles for select to anon, authenticated
  using (true);

drop policy if exists "talles gestion staff" on public.producto_talles;
create policy "talles gestion staff"
  on public.producto_talles for all to authenticated
  using (coalesce(public.es_staff(), false))
  with check (coalesce(public.es_staff(), false));

revoke all on table public.producto_talles from public, anon, authenticated;
grant select on table public.producto_talles to anon, authenticated;
grant insert, update, delete on table public.producto_talles to authenticated;
grant all on table public.producto_talles to service_role;

-- ---- 2) Stock del producto = suma de los talles ---------------------------------------
create or replace function public.sincronizar_stock_talles(p_producto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_producto_id is null then
    return;
  end if;
  -- Marca para que el bloqueo de abajo deje pasar esta actualización.
  perform set_config('pecora.sync_talles', 'on', true);
  update public.productos p
     set stock = coalesce((select sum(t.stock) from public.producto_talles t
                            where t.producto_id = p_producto_id), 0),
         updated_at = now()
   where p.id = p_producto_id;
  perform set_config('pecora.sync_talles', '', true);
end;
$$;

revoke execute on function public.sincronizar_stock_talles(uuid) from public, anon, authenticated;

create or replace function public.producto_talles_despues()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sincronizar_stock_talles(new.producto_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.producto_id is distinct from new.producto_id) then
    perform public.sincronizar_stock_talles(old.producto_id);
  end if;
  return null;
end;
$$;

revoke execute on function public.producto_talles_despues() from public, anon, authenticated;

drop trigger if exists producto_talles_despues on public.producto_talles;
create trigger producto_talles_despues
  after insert or update or delete on public.producto_talles
  for each row execute function public.producto_talles_despues();

-- Con talles, productos.stock solo lo cambia la sincronización (el nombre hace
-- que corra antes que productos_marcar_stock_bajo).
create or replace function public.productos_bloquear_stock_talles()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stock is distinct from old.stock
     and coalesce(current_setting('pecora.sync_talles', true), '') <> 'on'
     and exists (select 1 from public.producto_talles t where t.producto_id = new.id) then
    new.stock := old.stock;
  end if;
  return new;
end;
$$;

drop trigger if exists productos_bloquear_stock_talles on public.productos;
create trigger productos_bloquear_stock_talles
  before update of stock on public.productos
  for each row execute function public.productos_bloquear_stock_talles();

-- ---- 3) Devolver / descontar stock de un pedido ----------------------------------------
create or replace function public.ajustar_stock_pedido(p_items jsonb, p_signo int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;

  -- Ítems con talle: al talle (el trigger actualiza el producto).
  update public.producto_talles t
     set stock = t.stock + p_signo * i.cantidad
    from (
      select (value->>'talle_id')::uuid as id,
             sum((value->>'cantidad')::int) as cantidad
        from jsonb_array_elements(p_items)
       where coalesce(value->>'talle_id', '') <> ''
       group by 1
    ) i
   where t.id = i.id;

  -- Ítems sin talle: al producto, como siempre.
  update public.productos p
     set stock = p.stock + p_signo * i.cantidad
    from (
      select (value->>'id')::uuid as id,
             sum((value->>'cantidad')::int) as cantidad
        from jsonb_array_elements(p_items)
       where coalesce(value->>'talle_id', '') = ''
       group by 1
    ) i
   where p.id = i.id;
end;
$$;

revoke execute on function public.ajustar_stock_pedido(jsonb, int)
  from public, anon, authenticated;

-- ---- 4) crear_pedido con talles -----------------------------------------------------
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
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para hacer un pedido.';
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
) from public, anon;
grant execute on function public.crear_pedido(
  text, text, text, text, text, text, text, text, jsonb, numeric, text, text, uuid, text, uuid
) to authenticated;

commit;
