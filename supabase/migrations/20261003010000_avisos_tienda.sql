-- ============================================================================
-- Pecora — Avisos automáticos de la tienda (Edge Function avisos-tienda).
--
--   1) Pedido enviado: cuando un pedido pasa a "enviado", la clienta recibe un
--      mail con el número de seguimiento. Si es con envío y todavía no tiene
--      seguimiento, el mail espera a que se cargue (o sale igual a las 2 h).
--      Una sola vez por pedido (pedidos.aviso_envio_enviado_at).
--   2) Stock bajo: cuando un producto baja de STOCK_BAJO+1 a STOCK_BAJO o
--      menos (3, igual que el panel), queda marcado (productos.stock_bajo_desde).
--      Una vez por hora sale un solo mail a la dueña con todos los marcados
--      que todavía no se avisaron. Si se repone por encima del umbral, la
--      marca se borra y vuelve a avisar la próxima vez que baje.
--   3) Carrito abandonado: el carrito de una clienta logueada se guarda en
--      `carritos`. Si pasan ~20 h sin cambios y no compró, le llega un mail
--      recordatorio (uno por carrito). Se apaga desde Mi cuenta →
--      Preferencias (profiles.recordar_carrito).
--   4) Reporte mensual: el día 1 a las 9 (hora de Argentina) le llega a la
--      dueña un resumen del mes anterior (reporte_mensual_datos).
--
-- Los mails los manda la Edge Function avisos-tienda (mismos secretos de Gmail
-- que los demás). La base la llama con invocar_avisos_tienda(body); la URL se
-- deriva de la de enviar-recibo-pedido (Vault) igual que avisar-reposicion, o
-- se puede fijar con el secreto de Vault pecora_avisos_tienda_url.
--
-- Las tareas periódicas (1 sin seguimiento, 2, 3 y 4) usan pg_cron. Si la extensión no está
-- disponible, la migración sigue igual y solo avisa con un NOTICE.
--
-- Idempotente. Tests: supabase/tests/avisos_tienda.test.sql.
-- ============================================================================

begin;

-- ---- Columnas ------------------------------------------------------------------
alter table public.pedidos add column if not exists aviso_envio_enviado_at timestamptz;

alter table public.productos add column if not exists stock_bajo_desde timestamptz;
alter table public.productos add column if not exists aviso_stock_bajo_at timestamptz;

alter table public.profiles add column if not exists recordar_carrito boolean not null default true;
grant update (nombre, telefono, acepta_novedades, recordar_carrito) on public.profiles to authenticated;

-- ---- Carritos guardados ---------------------------------------------------------
create table if not exists public.carritos (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  -- [{ "id": uuid, "cantidad": int }]: el resto (precio, foto) se lee del
  -- producto al momento de usarlo.
  items         jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),
  recordado_at  timestamptz,
  constraint carritos_items_validos check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 50
  )
);

create index if not exists carritos_updated_idx on public.carritos (updated_at);

alter table public.carritos enable row level security;

drop policy if exists "carrito propio" on public.carritos;
create policy "carrito propio"
  on public.carritos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.carritos from public, anon, authenticated;
grant select, insert, update, delete on table public.carritos to authenticated;
grant all on table public.carritos to service_role;

-- updated_at lo pone la base (no la clienta) y un cambio de ítems vuelve a
-- habilitar el recordatorio.
create or replace function public.carritos_antes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    if current_user in ('authenticated', 'anon') then
      new.recordado_at := null;
    end if;
  elsif new.items is distinct from old.items then
    new.updated_at := now();
    new.recordado_at := null;
  else
    -- Sin cambios en los ítems (o la función marcando el recordatorio): la
    -- fecha no se mueve y la clienta no puede tocar recordado_at.
    new.updated_at := old.updated_at;
    if current_user in ('authenticated', 'anon') then
      new.recordado_at := old.recordado_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists carritos_antes on public.carritos;
create trigger carritos_antes
  before insert or update on public.carritos
  for each row execute function public.carritos_antes();

-- ---- Llamada a la Edge Function ------------------------------------------------
create or replace function public.invocar_avisos_tienda(p_body jsonb)
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
   where name = 'pecora_avisos_tienda_url';

  if v_url is null then
    select decrypted_secret into v_email_url
      from vault.decrypted_secrets
     where name = 'pecora_email_function_url';
    if v_email_url ~ '/enviar-recibo-pedido/?$' then
      v_url := regexp_replace(v_email_url, '/enviar-recibo-pedido/?$', '/avisos-tienda');
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
    body := p_body
  );
end;
$$;

revoke execute on function public.invocar_avisos_tienda(jsonb) from public, anon, authenticated;
grant execute on function public.invocar_avisos_tienda(jsonb) to service_role;

-- ---- 1) Pedido enviado ------------------------------------------------------------
-- enviado_at: cuándo pasó a "enviado" (lo pone la base).
alter table public.pedidos add column if not exists enviado_at timestamptz;

create or replace function public.pedidos_marcar_enviado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado = 'enviado' and old.estado is distinct from 'enviado' then
    new.enviado_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_marcar_enviado on public.pedidos;
create trigger pedidos_marcar_enviado
  before update of estado on public.pedidos
  for each row execute function public.pedidos_marcar_enviado();

-- El mail sale cuando el pedido está "enviado" y:
--   * es para retirar/coordinar, o ya tiene seguimiento → enseguida;
--   * es con envío y todavía no tiene seguimiento → espera: sale al cargar el
--     seguimiento o, si no se carga, a las 2 h (tarea por hora, abajo).
create or replace function public.pedido_enviado_aviso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'enviado'
     and new.aviso_envio_enviado_at is null
     and new.eliminado_at is null
     and (old.estado is distinct from 'enviado'
          or new.seguimiento is distinct from old.seguimiento)
     and (new.entrega <> 'envio' or nullif(btrim(coalesce(new.seguimiento, '')), '') is not null) then
    begin
      perform public.invocar_avisos_tienda(
        jsonb_build_object('tipo', 'pedido_enviado', 'pedido_id', new.id));
    exception when others then
      -- Un problema con el mail nunca frena el cambio de estado.
      null;
    end;
  end if;
  return new;
end;
$$;

revoke execute on function public.pedido_enviado_aviso() from public, anon, authenticated;

drop trigger if exists pedido_enviado_aviso on public.pedidos;
create trigger pedido_enviado_aviso
  after update of estado, seguimiento on public.pedidos
  for each row execute function public.pedido_enviado_aviso();

-- Pedidos enviados hace más de 2 h sin seguimiento ni aviso (para la tarea
-- por hora). Solo los de los últimos 7 días: nada de avisos viejos.
create or replace function public.pedidos_envio_sin_aviso()
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.pedidos p
   where p.estado = 'enviado'
     and p.aviso_envio_enviado_at is null
     and p.eliminado_at is null
     and p.enviado_at < now() - interval '2 hours'
     and p.enviado_at > now() - interval '7 days'
   order by p.enviado_at
   limit 50;
$$;

revoke execute on function public.pedidos_envio_sin_aviso() from public, anon, authenticated;
grant execute on function public.pedidos_envio_sin_aviso() to service_role;

-- ---- 2) Stock bajo ------------------------------------------------------------------
create or replace function public.productos_marcar_stock_bajo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c_umbral constant int := 3;
begin
  if new.stock > c_umbral then
    new.stock_bajo_desde := null;
  elsif old.stock > c_umbral then
    new.stock_bajo_desde := now();
  end if;
  return new;
end;
$$;

drop trigger if exists productos_marcar_stock_bajo on public.productos;
create trigger productos_marcar_stock_bajo
  before update of stock on public.productos
  for each row execute function public.productos_marcar_stock_bajo();

-- Productos con stock bajo todavía sin avisar (los lee y marca la función).
create or replace function public.productos_stock_bajo_pendientes()
returns table (id uuid, nombre text, stock int, slug text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.nombre, p.stock, p.slug
    from public.productos p
   where p.stock_bajo_desde is not null
     and (p.aviso_stock_bajo_at is null or p.aviso_stock_bajo_at < p.stock_bajo_desde)
   order by p.stock, p.nombre
   limit 100;
$$;

revoke execute on function public.productos_stock_bajo_pendientes() from public, anon, authenticated;
grant execute on function public.productos_stock_bajo_pendientes() to service_role;

-- ---- 3) Carritos para recordar ------------------------------------------------------
-- Carritos sin cambios hace entre p_horas y 7 días, sin recordatorio, de
-- cuentas con email confirmado, que no lo apagaron y que no compraron desde
-- el último cambio del carrito.
create or replace function public.carritos_para_recordar(p_horas int default 20, p_limite int default 50)
returns table (user_id uuid, email text, nombre text, items jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select c.user_id, u.email::text, pf.nombre, c.items, c.updated_at
    from public.carritos c
    join auth.users u on u.id = c.user_id
    left join public.profiles pf on pf.id = c.user_id
   where jsonb_array_length(c.items) > 0
     and c.recordado_at is null
     and c.updated_at < now() - make_interval(hours => greatest(p_horas, 1))
     and c.updated_at > now() - interval '7 days'
     and u.email_confirmed_at is not null
     and coalesce(pf.recordar_carrito, true)
     and coalesce(pf.rol, 'cliente') = 'cliente'
     and not exists (
       select 1 from public.pedidos p
        where p.user_id = c.user_id
          and p.created_at >= c.updated_at - interval '1 hour'
     )
   order by c.updated_at
   limit greatest(least(p_limite, 200), 1);
$$;

revoke execute on function public.carritos_para_recordar(int, int) from public, anon, authenticated;
grant execute on function public.carritos_para_recordar(int, int) to service_role;

-- ---- 4) Reporte mensual -------------------------------------------------------------
-- Resumen de un mes (p_mes: cualquier día de ese mes) comparado con el
-- anterior. Solo para la Edge Function (service_role).
create or replace function public.reporte_mensual_datos(p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_tz       constant text := 'America/Argentina/Cordoba';
  v_desde    date := date_trunc('month', p_mes)::date;
  v_hasta    date := (date_trunc('month', p_mes) + interval '1 month')::date;
  v_ant      date := (date_trunc('month', p_mes) - interval '1 month')::date;
  v_inicio   timestamptz := v_desde::timestamp at time zone c_tz;
  v_fin      timestamptz := v_hasta::timestamp at time zone c_tz;
  v_ini_ant  timestamptz := v_ant::timestamp at time zone c_tz;
begin
  return jsonb_build_object(
    'mes', to_char(v_desde, 'YYYY-MM'),
    'pedidos', (select count(*)::int from public.pedidos p
                 where p.estado <> 'cancelado' and p.eliminado_at is null
                   and p.created_at >= v_inicio and p.created_at < v_fin),
    'total', (select coalesce(sum(p.total), 0)::numeric from public.pedidos p
               where p.estado <> 'cancelado' and p.eliminado_at is null
                 and p.created_at >= v_inicio and p.created_at < v_fin),
    'pedidos_mes_anterior', (select count(*)::int from public.pedidos p
                 where p.estado <> 'cancelado' and p.eliminado_at is null
                   and p.created_at >= v_ini_ant and p.created_at < v_inicio),
    'total_mes_anterior', (select coalesce(sum(p.total), 0)::numeric from public.pedidos p
               where p.estado <> 'cancelado' and p.eliminado_at is null
                 and p.created_at >= v_ini_ant and p.created_at < v_inicio),
    'cancelados', (select count(*)::int from public.pedidos p
                    where p.estado = 'cancelado' and p.eliminado_at is null
                      and p.created_at >= v_inicio and p.created_at < v_fin),
    'gastos', (select coalesce(sum(g.monto), 0)::numeric from public.gastos g
                where g.fecha >= v_desde and g.fecha < v_hasta),
    'clientas_nuevas', (select count(*)::int from public.profiles pf
                         where pf.rol = 'cliente'
                           and pf.created_at >= v_inicio and pf.created_at < v_fin),
    'mas_vendidos', coalesce((
      select jsonb_agg(t order by t.unidades desc, t.importe desc)
        from (
          select coalesce(max(pr.nombre), max(v.nombre)) as nombre,
                 sum(v.cantidad)::int as unidades,
                 coalesce(sum(v.importe), 0)::numeric as importe
            from public.ventas_validas v
            left join public.productos pr on pr.id = v.producto_id
           where v.cantidad is not null
             and v.created_at >= v_inicio and v.created_at < v_fin
           group by coalesce(v.producto_id::text, v.nombre)
           order by unidades desc, importe desc
           limit 5
        ) t), '[]'::jsonb),
    'sin_stock', (select count(*)::int from public.productos where stock <= 0),
    'pendientes', (select count(*)::int from public.pedidos p
                    where p.estado in ('nuevo', 'confirmado') and p.eliminado_at is null)
  );
end;
$$;

revoke execute on function public.reporte_mensual_datos(date) from public, anon, authenticated;
grant execute on function public.reporte_mensual_datos(date) to service_role;

commit;

-- ---- Tareas periódicas (pg_cron) ------------------------------------------------
-- Fuera de la transacción: si pg_cron no está, no se aborta lo de arriba.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron no disponible (%): los avisos periódicos no se programan.', sqlerrm;
    return;
  end;

  -- cron.schedule con nombre reemplaza la tarea si ya existe (idempotente).
  perform cron.schedule('pecora-stock-bajo', '7 * * * *',
    $c$ select public.invocar_avisos_tienda('{"tipo":"stock_bajo"}'::jsonb) $c$);
  perform cron.schedule('pecora-envios', '22 * * * *',
    $c$ select public.invocar_avisos_tienda('{"tipo":"envios_pendientes"}'::jsonb) $c$);
  perform cron.schedule('pecora-carritos', '37 * * * *',
    $c$ select public.invocar_avisos_tienda('{"tipo":"carritos"}'::jsonb) $c$);
  -- 12:05 UTC = 9:05 en Argentina, el día 1 de cada mes.
  perform cron.schedule('pecora-reporte-mensual', '5 12 1 * *',
    $c$ select public.invocar_avisos_tienda('{"tipo":"reporte_mensual"}'::jsonb) $c$);
exception when others then
  raise notice 'No se pudieron programar los avisos periódicos: %', sqlerrm;
end $$;
