-- ============================================================================
-- Pecora — "Mi cuenta" de la clienta.
--
--   1) profiles.acepta_novedades (boolean, default false): si quiere recibir
--      mails de novedades y promociones. La clienta lo cambia desde Mi cuenta
--      (permiso de UPDATE solo sobre nombre, telefono y acepta_novedades: el
--      rol sigue protegido). Largos máximos para nombre (120) y teléfono (40),
--      los mismos que en los pedidos.
--   2) eliminar_mi_cuenta(): borra la cuenta logueada (auth.users). Por las
--      claves foráneas: perfil, reseñas y avisos de stock se borran; los
--      pedidos quedan como registro de venta sin cuenta asociada (user_id
--      null). Las cuentas del staff no se pueden borrar desde acá.
--
-- Idempotente. Tests: supabase/tests/mi_cuenta.test.sql.
-- ============================================================================

begin;

alter table public.profiles add column if not exists acepta_novedades boolean not null default false;

-- NOT VALID: no se revisan las filas viejas (un nombre largo de antes no
-- impide actualizar el resto); sí aplica a todo lo que se guarde desde ahora.
alter table public.profiles drop constraint if exists profiles_largos;
alter table public.profiles add constraint profiles_largos
  check (char_length(coalesce(nombre, '')) <= 120 and char_length(coalesce(telefono, '')) <= 40)
  not valid;

revoke update on public.profiles from anon, authenticated;
grant update (nombre, telefono, acepta_novedades) on public.profiles to authenticated;

create or replace function public.eliminar_mi_cuenta()
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
  if public.es_staff() then
    raise exception 'Las cuentas del equipo de la tienda no se pueden eliminar desde acá.'
      using errcode = '42501';
  end if;
  delete from auth.users where id = v_uid;
  return found;
end;
$$;

revoke execute on function public.eliminar_mi_cuenta() from public, anon;
grant execute on function public.eliminar_mi_cuenta() to authenticated;

commit;
