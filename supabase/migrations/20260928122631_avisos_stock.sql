-- ============================================================================
-- Pecora — Migración avisos_stock: "Avisame cuando vuelva".
--
-- Por qué: cuando un producto está sin stock, la clienta solo podía consultar
-- por WhatsApp. Ahora puede pedir que le avisemos por mail cuando vuelva.
--
-- Qué agrega:
--   1) Tabla public.avisos_stock: una suscripción por (producto, cuenta)
--      pendiente. Exige cuenta (login): el mail sale al email de la cuenta, que
--      se toma del lado del servidor (auth.users), así nadie puede anotar
--      direcciones ajenas. `token` sirve para darse de baja desde el mail sin
--      loguearse. `notificado_at` se completa cuando el mail salió.
--   2) RPCs:
--        suscribir_aviso_stock(p_producto_id uuid) returns text (el email)
--        cancelar_aviso_stock(p_producto_id uuid)  returns boolean
--        baja_aviso_stock(p_token uuid)            returns boolean (anon ok)
--   3) Trigger AFTER UPDATE OF stock ON productos: cuando un producto pasa de
--      0 a > 0 y tiene suscripciones pendientes, encola (pg_net, asíncrono) UNA
--      llamada a la Edge Function avisar-reposicion con { producto_id }. Nunca
--      bloquea el update (exception when others then null).
--
-- Anti-rebote: la Edge Function solo avisa a las filas con notificado_at null
-- y las marca. Si el producto vuelve a 0 y a > 0 enseguida, las suscripciones
-- ya avisadas no reciben otro mail.
--
-- Reserva con vencimiento (reservado_at): antes de mandar, la Edge Function
-- "reserva" la fila (reservar_aviso_stock) y recién después del envío OK marca
-- notificado_at. Si el envío falla, borra la reserva. Si la función se cae o
-- se corta entre la reserva y el envío, la reserva vence a los 15 minutos y la
-- fila vuelve a estar pendiente (próxima reposición, o a mano con
-- select public.invocar_aviso_stock('<producto_id>');). "Pendiente" =
-- aviso_stock_pendiente(notificado_at, reservado_at): la misma regla en el
-- trigger, en la lectura de pendientes y en la reserva.
--
-- Secretos de Vault (pasos manuales, ver supabase/functions/README.md):
--   * Token: reutiliza 'pecora_email_function_token' (la service-role key),
--     el mismo de la 0012.
--   * URL: 'pecora_avisos_function_url'. Si no está cargado, se deriva de
--     'pecora_email_function_url' reemplazando el final
--     '/enviar-recibo-pedido' por '/avisar-reposicion'. Sin ninguno de los
--     dos, el trigger no hace nada.
--
-- Es idempotente. Al final está cómo revertirla.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabla.
-- ----------------------------------------------------------------------------
create table if not exists public.avisos_stock (
  id            uuid primary key default gen_random_uuid(),
  producto_id   uuid not null references public.productos(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  email         text not null,
  token         uuid not null default gen_random_uuid() unique,
  notificado_at timestamptz,
  reservado_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- Por si la tabla ya existía sin la columna (la migración es idempotente).
alter table public.avisos_stock add column if not exists reservado_at timestamptz;

-- Una sola suscripción PENDIENTE por producto y cuenta (las ya avisadas no
-- cuentan: la clienta puede volver a anotarse la próxima vez que se agote).
-- Una fila reservada (reservado_at, notificado_at null) sigue contando: el
-- mail todavía no salió, así que volver a anotarse no duplica.
create unique index if not exists avisos_stock_pendiente_key
  on public.avisos_stock (producto_id, user_id)
  where notificado_at is null;

create index if not exists avisos_stock_user_id_idx on public.avisos_stock (user_id);

alter table public.avisos_stock enable row level security;

-- La clienta ve y borra solo lo suyo. El alta es solo por el RPC (el email se
-- toma de auth.users); nadie puede modificar filas (notificado_at lo marca la
-- Edge Function con la service-role key, que saltea RLS).
drop policy if exists "avisos_stock lectura propia" on public.avisos_stock;
create policy "avisos_stock lectura propia"
  on public.avisos_stock for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "avisos_stock borrado propio" on public.avisos_stock;
create policy "avisos_stock borrado propio"
  on public.avisos_stock for delete
  to authenticated
  using (user_id = auth.uid());

-- Permisos explícitos (no depender del "auto expose" del proyecto).
revoke all on table public.avisos_stock from public, anon, authenticated;
grant select, delete on table public.avisos_stock to authenticated;
grant all on table public.avisos_stock to service_role;

-- ----------------------------------------------------------------------------
-- 1b) Pendiente / reserva (para la Edge Function, con la service-role key).
-- ----------------------------------------------------------------------------

-- Pendiente = todavía no se avisó y no hay una reserva vigente (sin reserva,
-- o reservada hace más de 15 minutos: la invocación que la tomó se cayó).
create or replace function public.aviso_stock_pendiente(
  p_notificado_at timestamptz,
  p_reservado_at  timestamptz
)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_notificado_at is null
         and (p_reservado_at is null
              or p_reservado_at < now() - interval '15 minutes');
$$;

revoke execute on function public.aviso_stock_pendiente(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.aviso_stock_pendiente(timestamptz, timestamptz)
  to service_role;

-- Suscripciones pendientes de un producto, en tandas ordenadas por id
-- (p_desde_id = el último id de la tanda anterior).
create or replace function public.avisos_stock_pendientes(
  p_producto_id uuid,
  p_desde_id    uuid default null,
  p_limite      int default 200
)
returns table (id uuid, email text, token uuid)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.email, a.token
    from public.avisos_stock a
   where a.producto_id = p_producto_id
     and public.aviso_stock_pendiente(a.notificado_at, a.reservado_at)
     and (p_desde_id is null or a.id > p_desde_id)
   order by a.id
   limit greatest(coalesce(p_limite, 200), 1);
$$;

revoke execute on function public.avisos_stock_pendientes(uuid, uuid, int)
  from public, anon, authenticated;
grant execute on function public.avisos_stock_pendientes(uuid, uuid, int) to service_role;

-- Reserva una suscripción pendiente (reservado_at = now()). true si la tomó;
-- false si ya estaba avisada o reservada por otra invocación (hace < 15 min).
-- El update condicional es atómico: dos invocaciones no toman la misma fila.
create or replace function public.reservar_aviso_stock(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.avisos_stock
     set reservado_at = now()
   where id = p_id
     and public.aviso_stock_pendiente(notificado_at, reservado_at);
  return found;
end;
$$;

revoke execute on function public.reservar_aviso_stock(uuid) from public, anon, authenticated;
grant execute on function public.reservar_aviso_stock(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 2) RPCs para la clienta.
-- ----------------------------------------------------------------------------

-- Anota a la clienta logueada para que le avisemos cuando vuelva el producto.
-- Solo si el producto está sin stock. Idempotente: si ya estaba anotada,
-- no duplica. Devuelve el email al que va a llegar el aviso.
create or replace function public.suscribir_aviso_stock(p_producto_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_stock integer;
  v_email text;
begin
  if v_uid is null then
    raise exception 'Tenés que ingresar a tu cuenta para pedir el aviso.'
      using errcode = '42501';
  end if;

  select stock into v_stock from public.productos where id = p_producto_id;
  if not found then
    raise exception 'El producto no existe.' using errcode = 'P0002';
  end if;

  if v_stock > 0 then
    raise exception 'Este producto ya tiene stock: lo podés comprar ahora.';
  end if;

  select nullif(trim(u.email), '') into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    raise exception 'Tu cuenta no tiene un email para avisarte.';
  end if;

  insert into public.avisos_stock (producto_id, user_id, email)
  values (p_producto_id, v_uid, v_email)
  on conflict (producto_id, user_id) where notificado_at is null do nothing;

  -- Si ya estaba anotada, devuelve el email de esa suscripción.
  select a.email into v_email
    from public.avisos_stock a
   where a.producto_id = p_producto_id
     and a.user_id = v_uid
     and a.notificado_at is null;

  return v_email;
end;
$$;

revoke execute on function public.suscribir_aviso_stock(uuid) from public, anon;
grant execute on function public.suscribir_aviso_stock(uuid) to authenticated;

-- Cancela el aviso pendiente de la clienta logueada para un producto.
-- true si había uno.
create or replace function public.cancelar_aviso_stock(p_producto_id uuid)
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

  delete from public.avisos_stock
   where producto_id = p_producto_id
     and user_id = v_uid
     and notificado_at is null;

  return found;
end;
$$;

revoke execute on function public.cancelar_aviso_stock(uuid) from public, anon;
grant execute on function public.cancelar_aviso_stock(uuid) to authenticated;

-- Baja desde el link del mail (sin login). El token identifica una
-- suscripción; se borran esa fila y todos los avisos PENDIENTES de la misma
-- cuenta ("no me manden más avisos"). true si el token existía.
create or replace function public.baja_aviso_stock(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_token is null then
    return false;
  end if;

  delete from public.avisos_stock where token = p_token returning user_id into v_user_id;
  if v_user_id is null then
    return false;
  end if;

  delete from public.avisos_stock
   where user_id = v_user_id
     and notificado_at is null;

  return true;
end;
$$;

revoke execute on function public.baja_aviso_stock(uuid) from public;
grant execute on function public.baja_aviso_stock(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) Llamada a la Edge Function + trigger de reposición.
-- ----------------------------------------------------------------------------

-- Encola la llamada a avisar-reposicion. Devuelve el id de la request de
-- pg_net, o null si faltan los secretos. SECURITY DEFINER porque lee Vault y
-- usa pg_net. Solo la usa el trigger: nadie más tiene EXECUTE.
create or replace function public.invocar_aviso_stock(p_producto_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url       text;
  v_email_url text;
  v_token     text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'pecora_avisos_function_url';

  if v_url is null then
    select decrypted_secret into v_email_url
      from vault.decrypted_secrets
     where name = 'pecora_email_function_url';
    -- Solo si la URL del mail de pedidos termina en /enviar-recibo-pedido:
    -- si no, no se puede adivinar y es mejor no llamar a nada.
    if v_email_url ~ '/enviar-recibo-pedido/?$' then
      v_url := regexp_replace(v_email_url, '/enviar-recibo-pedido/?$', '/avisar-reposicion');
    end if;
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'pecora_email_function_token';

  if v_url is null or v_token is null then
    return null;
  end if;

  return net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := jsonb_build_object('producto_id', p_producto_id)
  );
end;
$$;

revoke execute on function public.invocar_aviso_stock(uuid) from public, anon, authenticated;

create or replace function public.producto_repuesto_aviso()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
begin
  begin
    -- Sin nadie esperando, no hace falta llamar a la función. Las reservas
    -- vencidas (invocación anterior caída) cuentan como pendientes.
    if exists (
      select 1 from public.avisos_stock
       where producto_id = new.id
         and public.aviso_stock_pendiente(notificado_at, reservado_at)
    ) then
      perform public.invocar_aviso_stock(new.id);
    end if;
  exception when others then
    -- Cualquier falla acá (red, Vault, pg_net) NUNCA debe tumbar el update.
    null;
  end;

  return new;
end;
$$;

revoke execute on function public.producto_repuesto_aviso() from public, anon, authenticated;

drop trigger if exists productos_aviso_reposicion on public.productos;
create trigger productos_aviso_reposicion
  after update of stock on public.productos
  for each row
  when (old.stock <= 0 and new.stock > 0)
  execute function public.producto_repuesto_aviso();

-- ============================================================================
-- Cómo revertirla (el front muestra "los avisos no están disponibles" si los
-- RPCs no existen):
--
--   begin;
--   drop trigger if exists productos_aviso_reposicion on public.productos;
--   drop function if exists public.producto_repuesto_aviso();
--   drop function if exists public.invocar_aviso_stock(uuid);
--   drop function if exists public.baja_aviso_stock(uuid);
--   drop function if exists public.cancelar_aviso_stock(uuid);
--   drop function if exists public.suscribir_aviso_stock(uuid);
--   drop function if exists public.reservar_aviso_stock(uuid);
--   drop function if exists public.avisos_stock_pendientes(uuid, uuid, int);
--   drop function if exists public.aviso_stock_pendiente(timestamptz, timestamptz);
--   drop table if exists public.avisos_stock;
--   commit;
--
-- Borrar la tabla borra las suscripciones pendientes (datos de clientas).
-- ============================================================================
