-- ============================================================================
-- Pecora — Migración reenviar_emails_pedido: reenvío de los mails de un pedido
-- desde el panel.
--
-- Por qué: el trigger de la 0012 llama a la Edge Function enviar-recibo-pedido
-- una sola vez por pedido (fire-and-forget). Si el envío falla (por ejemplo,
-- venció el token de Gmail), el recibo a la clienta y el aviso a la dueña se
-- pierden y no había forma de volver a pedirlos.
--
-- Qué cambia:
--   1) public.invocar_email_pedido(uuid): la llamada HTTP a la Edge Function
--      (URL y token desde Vault, igual que la 0012), ahora en un solo lugar.
--      Devuelve el id de la request de pg_net, o null si faltan los secretos.
--      Solo la usan el trigger y el RPC de abajo: nadie más tiene EXECUTE.
--   2) public.pedido_creado_email(): el trigger de la 0012 pasa a usar esa
--      función. Mismo comportamiento: una llamada por pedido nuevo, sin
--      secretos no hace nada, y ningún error puede tumbar el insert.
--   3) public.reenviar_emails_pedido(uuid): RPC solo para la admin. Vuelve a
--      invocar la Edge Function para un pedido. La función ya es idempotente
--      (pedidos.email_enviado_at / aviso_duena_enviado_at): solo manda lo que
--      falta.
--
-- Es idempotente: se puede correr más de una vez. Al final está cómo revertirla.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Llamada a la Edge Function (compartida por el trigger y el RPC).
--
-- SECURITY DEFINER porque lee vault.decrypted_secrets y usa pg_net, a los que
-- un usuario común no tiene acceso. No atrapa errores: el trigger los ignora
-- y el RPC se los muestra a la admin.
-- ----------------------------------------------------------------------------
create or replace function public.invocar_email_pedido(p_pedido_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url   text;
  v_token text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'pecora_email_function_url';

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'pecora_email_function_token';

  -- Sin los secretos cargados en Vault no hay nada para llamar.
  if v_url is null or v_token is null then
    return null;
  end if;

  -- net.http_post es asíncrono: encola la request y devuelve su id al toque.
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := jsonb_build_object('pedido_id', p_pedido_id)
  );
end;
$$;

-- Supabase le da EXECUTE a anon y authenticated en toda función nueva del
-- esquema public: se saca. Solo la llaman el trigger y el RPC (como su dueño).
revoke execute on function public.invocar_email_pedido(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) Trigger de la 0012, ahora con la función compartida. El trigger en sí
--    (AFTER INSERT ON pedidos) no cambia.
-- ----------------------------------------------------------------------------
create or replace function public.pedido_creado_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
begin
  begin
    perform public.invocar_email_pedido(new.id);
  exception when others then
    -- Cualquier falla acá (red, Vault, pg_net) NUNCA debe tumbar el pedido.
    null;
  end;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) RPC de reenvío, solo para la admin.
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
  if not public.es_admin() then
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

-- ============================================================================
-- Cómo revertirla (el front muestra un aviso si el RPC no existe):
--
--   begin;
--   drop function if exists public.reenviar_emails_pedido(uuid);
--   -- Pegar acá la definición de public.pedido_creado_email() de
--   -- 0012_email_pedido.sql (solo el create or replace function; el trigger
--   -- no hace falta tocarlo).
--   drop function if exists public.invocar_email_pedido(uuid);
--   commit;
--
-- El orden importa: invocar_email_pedido se borra después de volver a la
-- versión de la 0012 del trigger, que no la usa.
-- ============================================================================
