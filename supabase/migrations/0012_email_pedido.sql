-- ============================================================================
-- Pecora — Migración 0012: email de confirmación de pedido
--
-- Por qué: cuando se crea un pedido (crear_pedido()), nadie le manda a la
-- clienta un comprobante por mail con el detalle de lo que compró. Este
-- trigger dispara una llamada HTTP asíncrona (pg_net) a una Edge Function
-- que arma y envía ese mail (actualmente vía la API de Gmail).
--
-- "Fire-and-forget" real: la llamada usa net.http_post (asíncrono, no espera
-- respuesta) y TODO el cuerpo del trigger está envuelto en
-- "exception when others then null", así que ni una falla de pg_net ni un
-- error de red pueden abortar el insert en pedidos. El pedido siempre se
-- crea; en el peor caso, el mail simplemente no sale (y queda logueado del
-- lado de la Edge Function).
--
-- IMPORTANTE — pasos manuales en el SQL Editor (esta migración NO los hace,
-- a propósito: los valores son secretos y no van al repo):
--
--   1) Guardá la URL de la Edge Function y un token de autorización en Vault.
--      Reemplazá los placeholders por los valores reales y corré esto UNA
--      sola vez (ejecutar de nuevo con el mismo nombre da error de secreto
--      duplicado; para rotar un valor usá vault.update_secret en su lugar):
--
--        select vault.create_secret(
--          'https://<tu-proyecto>.supabase.co/functions/v1/enviar-recibo-pedido',
--          'pecora_email_function_url'
--        );
--        select vault.create_secret(
--          '<tu-service-role-key>',
--          'pecora_email_function_token'
--        );
--
--      El token recomendado es la service-role key del proyecto: la Edge
--      Function se despliega con verificación JWT default (ver
--      supabase/functions/README.md) y espera ese valor como Bearer.
--
--   2) Desplegá la función ANTES de correr esta migración (ver el runbook en
--      supabase/functions/README.md). Si el trigger llega a activarse antes
--      de que la función exista, pg_net simplemente recibe un 404: no rompe
--      nada, pero ensucia los logs.
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y
-- ejecutá. Es idempotente: se puede volver a correr sin romper nada (salvo
-- por el paso manual de Vault de arriba, que es aparte y una sola vez).
-- ============================================================================

-- pg_net: permite hacer HTTP requests asíncronos desde Postgres.
create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- Función del trigger: arma el body y dispara la llamada a la Edge Function.
-- SECURITY DEFINER porque necesita leer extensions.pg_net y vault.decrypted_secrets,
-- a los que un usuario común no tiene acceso.
-- ----------------------------------------------------------------------------
create or replace function public.pedido_creado_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url   text;
  v_token text;
begin
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'pecora_email_function_url';

    select decrypted_secret into v_token
      from vault.decrypted_secrets
     where name = 'pecora_email_function_token';

    -- Si todavía no se cargaron los secretos en Vault (deploy en progreso,
    -- entorno recién levantado, etc.), no hay nada para llamar: salimos
    -- silenciosamente en vez de fallar.
    if v_url is null or v_token is null then
      return new;
    end if;

    -- net.http_post es asíncrono: encola la request y devuelve al toque,
    -- sin bloquear el insert en pedidos.
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_token
      ),
      body := jsonb_build_object('pedido_id', new.id)
    );
  exception when others then
    -- Cualquier falla acá (red, Vault, pg_net) NUNCA debe tumbar el pedido.
    null;
  end;

  return new;
end;
$$;

drop trigger if exists pedido_creado_email on public.pedidos;
create trigger pedido_creado_email
  after insert on public.pedidos
  for each row execute function public.pedido_creado_email();
