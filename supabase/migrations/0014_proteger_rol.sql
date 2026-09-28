-- ============================================================================
-- Pecora — Migración 0014: el rol de un perfil no se puede cambiar desde la app.
--
-- Problema que corrige (0005): la policy "perfil propio update" permite que
-- cada usuaria actualice SU fila de public.profiles, pero no limita columnas.
-- Como Supabase le da UPDATE sobre toda la tabla al rol `authenticated`, una
-- clienta logueada podía ejecutar desde la consola del navegador:
--   supabase.from('profiles').update({ rol: 'admin' }).eq('id', <su id>)
-- y pasar a ser admin (es_admin() = true en todas las policies).
--
-- Solución, en dos capas:
--   1) Permisos por columna: `authenticated` solo puede actualizar nombre y
--      telefono. `anon` no puede actualizar nada.
--   2) Trigger: cualquier cambio de `rol` que venga de la API (roles
--      `authenticated` o `anon`) se rechaza, aunque en el futuro se agreguen
--      policies o grants nuevos. Los roles se gestionan solo desde el SQL
--      Editor (rol postgres) o desde el backend con la service-role key.
--
-- Límite conocido: el trigger mira `current_user`. Dentro de una función
-- SECURITY DEFINER, `current_user` es el dueño de la función (no quien la
-- llamó), así que ninguna de las dos capas frena a un RPC SECURITY DEFINER que
-- escriba `rol`. Hoy no existe ninguno (handle_new_user no toca `rol`); si se
-- agrega uno, tiene que validar el rol del llamador por su cuenta.
--
-- El frontend hoy no actualiza profiles (nombre/telefono se guardan al
-- registrarse, vía handle_new_user), así que esto no rompe ningún flujo.
--
-- Antes de aplicarla en producción: hacer un backup (Database → Backups, o
-- un pg_dump). Al final del archivo está cómo revertirla.
--
-- Cómo aplicarla: pegar TODO este archivo en el SQL Editor de Supabase y
-- ejecutar. Va dentro de una transacción: si algo falla, no queda aplicado a
-- medias. Es idempotente: se puede correr más de una vez.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Permisos por columna.
-- ----------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (nombre, telefono) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Trigger de protección del rol.
--
-- SECURITY INVOKER a propósito: así `current_user` es el rol de quien hace la
-- escritura (authenticated/anon desde la API, postgres desde el SQL Editor,
-- service_role desde el backend). Con SECURITY DEFINER sería siempre el dueño
-- de la función y el chequeo no serviría.
-- ----------------------------------------------------------------------------
create or replace function public.proteger_rol_perfil()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.rol is distinct from 'cliente' then
      raise exception 'No autorizado: un perfil nuevo solo puede tener rol cliente'
        using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and new.rol is distinct from old.rol then
      raise exception 'No autorizado: el rol no se puede cambiar desde la app'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists proteger_rol_perfil on public.profiles;
create trigger proteger_rol_perfil
  before insert or update on public.profiles
  for each row execute function public.proteger_rol_perfil();

commit;

-- ============================================================================
-- Verificación (correr DESPUÉS de aplicar la migración, en el SQL Editor)
--
-- a) Capa 1 por separado (permisos). Resultado esperado: false, true, false.
--
--      select
--        has_column_privilege('authenticated', 'public.profiles', 'rol', 'UPDATE')    as clienta_puede_cambiar_rol,
--        has_column_privilege('authenticated', 'public.profiles', 'nombre', 'UPDATE') as clienta_puede_cambiar_nombre,
--        has_table_privilege('anon', 'public.profiles', 'UPDATE')                     as anon_puede_actualizar;
--
-- b) Capa 2 por separado (trigger activo). Resultado esperado: una fila con
--    tgenabled = 'O'.
--
--      select tgname, tgenabled
--      from pg_trigger
--      where tgrelid = 'public.profiles'::regclass
--        and tgname = 'proteger_rol_perfil';
--
-- c) Prueba completa, simulando a una clienta sin salir del SQL Editor.
--    Reemplazar <id> por el id de una cuenta de clienta (de public.profiles).
--    Resultado esperado: "ERROR: permission denied for table profiles".
--    El rollback final deja todo como estaba.
--
--      begin;
--      set local role authenticated;
--      select set_config('request.jwt.claims', '{"sub":"<id>"}', true),
--             set_config('request.jwt.claim.sub', '<id>', true);
--      update public.profiles set rol = 'admin' where id = '<id>';
--      rollback;
--
-- d) ¿Alguien se dio rol admin antes de este parche? Deberían aparecer solo
--    las cuentas de administración legítimas:
--
--      select p.id, u.email, p.rol, p.created_at
--      from public.profiles p
--      join auth.users u on u.id = p.id
--      where p.rol = 'admin'
--      order by p.created_at;
--
--    Si aparece una cuenta que no corresponde, bajarle el rol (el trigger lo
--    permite porque el SQL Editor corre como postgres):
--
--      update public.profiles set rol = 'cliente' where id = '<id>';
--
-- ============================================================================
-- Si hubo una cuenta escalada: qué se puede investigar
--
-- La base no guarda quién modificó pedidos o productos (no hay tabla de
-- auditoría ni columnas de autor), así que no se puede reconstruir desde SQL
-- qué hizo esa cuenta. Lo disponible:
--   - Dashboard → Logs → API: pedidos PATCH/DELETE a /rest/v1/profiles,
--     /rest/v1/productos, /rest/v1/categorias y /rest/v1/pedidos. La
--     retención de logs depende del plan de Supabase.
--   - Dashboard → Authentication → Users: fecha de alta y último ingreso de
--     la cuenta sospechosa.
--   - Revisar a mano productos, precios y pedidos contra lo esperado.
-- Pendiente aparte: agregar auditoría (tabla de eventos o columnas de autor).
--
-- ============================================================================
-- Cómo revertirla (solo si rompe algo crítico: VUELVE A ABRIR el agujero)
--
--      begin;
--      drop trigger if exists proteger_rol_perfil on public.profiles;
--      drop function if exists public.proteger_rol_perfil();
--      grant update on public.profiles to anon, authenticated;
--      commit;
-- ============================================================================
