-- ============================================================================
-- Pecora — Límites a los pedidos del checkout (abuso de crear_pedido).
--
-- Problema: cualquier cuenta (el registro es abierto) podía llamar a
-- crear_pedido sin límite. Cada pedido 'nuevo' reserva stock, así que con un
-- script se podía dejar la tienda "sin stock". Además el recibo se mandaba al
-- email que escribiera quien compra: se podía usar el Gmail de la tienda para
-- mandar mails (con texto propio en nombre/notas) a cualquier dirección, con
-- riesgo de que Google suspenda la cuenta.
--
-- Trigger BEFORE INSERT en pedidos (corre dentro de crear_pedido, así que un
-- rechazo deshace también el stock descontado). Solo para origen 'checkout':
-- los pedidos manuales del staff no cambian.
--   * Máximo 5 pedidos cada 10 minutos y 20 por día por cuenta.
--   * El email del pedido es siempre el de la cuenta (verificado por Supabase
--     Auth): el recibo no puede ir a otra dirección.
--   * Un lock por cuenta serializa sus pedidos: varias llamadas en paralelo no
--     pueden saltearse el límite contando todas a la vez.
-- Y para todos los pedidos nuevos (también los manuales), largos máximos de
-- los textos y hasta 50 ítems, con mensajes en castellano. Se controla solo
-- al crear (no con checks de tabla): un pedido viejo con notas largas se
-- sigue pudiendo confirmar, cancelar o mandar a la papelera.
--
-- Idempotente. Tests: supabase/tests/pedidos_limites.test.sql.
-- ============================================================================

begin;

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

  if new.origen is distinct from 'checkout' or new.user_id is null then
    return new;
  end if;

  -- Serializa los pedidos de la misma cuenta: el conteo de abajo ve los que
  -- otra llamada en paralelo acaba de confirmar.
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

drop trigger if exists pedidos_proteger_checkout on public.pedidos;
create trigger pedidos_proteger_checkout
  before insert on public.pedidos
  for each row execute function public.pedidos_proteger_checkout();

create index if not exists pedidos_user_created_idx on public.pedidos (user_id, created_at desc);

-- Por si una versión anterior de esta migración llegó a crear los checks.
alter table public.pedidos drop constraint if exists pedidos_textos_largo;
alter table public.pedidos drop constraint if exists pedidos_items_maximo;

commit;
