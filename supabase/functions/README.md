# Edge Functions — Pecora

Las migraciones SQL se aplican con el CLI de Supabase y GitHub Actions (ver
`CONTEXTO.md`, sección 8). Las Edge Functions y sus secretos, en cambio, se
siguen desplegando **a mano** con los comandos de abajo.

## `enviar-recibo-pedido`

La dispara el trigger de `supabase/migrations/0012_email_pedido.sql`
(`AFTER INSERT ON pedidos`), vía `pg_net`, de forma asíncrona y sin poder
abortar el pedido si falla. Por cada pedido nuevo manda dos mails
independientes (si uno falla, el otro se intenta igual):

1. **Recibo a la clienta**, a `pedidos.email` (o, si está vacío, al email de
   su cuenta). Muestra los productos, descuento y envío (solo si son mayores a
   0; "Envío: a coordinar" si es a domicilio y todavía no hay costo) y el total.
2. **Aviso a la dueña** ("Nuevo pedido #N · $ total"), a las direcciones del
   secreto `OWNER_EMAIL`: datos de la clienta, entrega, productos, totales,
   notas y un botón de WhatsApp a la clienta.

Reglas:
- Los pedidos cargados a mano desde el panel (`origen = 'admin'`) **no mandan
  nada**.
- Cada mail se marca en la base después de salir bien
  (`pedidos.email_enviado_at`, `pedidos.aviso_duena_enviado_at`). Si la
  función se vuelve a invocar para el mismo pedido, no reenvía lo ya enviado.
- La función solo acepta requests cuyo `Authorization: Bearer ...` sea
  **exactamente la service-role key** del proyecto. Cualquier otro valor
  (incluida la anon key, que es pública) recibe `401`. Ver la sección 4.
- **Reenvío desde el panel** (migración `*_reenviar_emails_pedido.sql`): en
  Pedidos, un pedido web de los últimos 7 días que a los 2 minutos sigue sin
  `email_enviado_at` / `aviso_duena_enviado_at` muestra "Mail a la clienta: no
  enviado" / "Aviso a la dueña: no enviado" y un botón **Reenviar**, que llama
  al RPC `reenviar_emails_pedido` (solo admin). El RPC hace la misma llamada
  que el trigger (misma URL y token de Vault) y la función solo manda lo que
  falta. Arriba de la lista aparece un aviso si hay alguno así.
- La lógica pura de la función está en `logica.ts` (y los templates en
  `template.ts`), con tests de Vitest al lado (`pnpm test`).

### 1) Login y link del proyecto (una sola vez por máquina)

```bash
pnpm dlx supabase@latest login
pnpm dlx supabase@latest link --project-ref <tu-project-ref>
```

El `project-ref` está en la URL del proyecto en el dashboard de Supabase
(`https://supabase.com/dashboard/project/<project-ref>`).

### 2) Crear el archivo de secretos (local, gitignoreado)

Creá `supabase/functions/.env.local` (NO se sube al repo — ya está en
`.gitignore`) con este contenido, reemplazando los valores:

```
GMAIL_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=xxxxxxxxxxxx
GMAIL_REFRESH_TOKEN=1//xxxxxxxxxxxx
GMAIL_SENDER=pecoraabril@gmail.com
OWNER_EMAIL=pecoraabril@gmail.com
BRAND_NAME=Pecora
BRAND_LOGO_URL=https://tu-dominio.com/logo.png
STORE_URL=https://tu-dominio.com
WHATSAPP_NUMBER=5493511234567
```

Notas:
- `OWNER_EMAIL` es a dónde llega el aviso de "Nuevo pedido". Acepta varias
  direcciones separadas por coma (`a@gmail.com,b@gmail.com`). Si no está
  cargado, el recibo a la clienta sale igual y la función deja un warning en
  los logs (`OWNER_EMAIL no está configurado`). Conviene que sea una casilla
  que la dueña mire seguido; puede ser la misma cuenta que `GMAIL_SENDER`.
- `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`/`GMAIL_REFRESH_TOKEN` salen de un
  proyecto de Google Cloud propio, autorizado UNA vez contra la cuenta
  `pecoraabril@gmail.com` (ver "Setup completo" abajo) — no requieren un
  dominio propio verificado, a diferencia de un proveedor transaccional como
  Resend.
- `GMAIL_SENDER` es la dirección `pecoraabril@gmail.com` — vive como secreto
  (y no hardcodeada en el código) para no fijarla en el código fuente.
- `WHATSAPP_NUMBER` es opcional: el mismo número que usás en
  `VITE_WHATSAPP_NUMBER` del frontend (código de país + área + número, sin
  "+" ni espacios). Como esta función corre en otro runtime, no lee el `.env`
  del front — hay que repetirlo acá. Si no lo cargás, el mail sale igual,
  solo sin el botón de "Escribinos por WhatsApp".
- Nunca uses el prefijo `VITE_*` para estos valores: esas variables se
  compilan al bundle público del front y quedarían expuestas en el navegador.
  Estos son secretos de función, viven solo del lado del servidor.

### 3) Orden de despliegue — IMPORTANTE

El orden importa. Si activás el trigger de la migración `0012` antes de que
la función exista, `pg_net` va a hacer POST contra un 404 — no rompe nada
(el trigger ignora cualquier error), pero ensucia los logs sin necesidad.

**Orden correcto:**

```bash
# 1) Desplegar la función PRIMERO
pnpm dlx supabase@latest functions deploy enviar-recibo-pedido

# 2) Setear los secretos de la función
pnpm dlx supabase@latest secrets set --env-file supabase/functions/.env.local

# 3) Recién ahora correr la migración 0012 en el SQL Editor
#    (pegar TODO el contenido de supabase/migrations/0012_email_pedido.sql)
```

También podés usar el script corto del `package.json`:

```bash
pnpm run deploy:fn
```

### 3b) Actualizar la función existente (aviso a la dueña + auth estricta)

Esto es para un proyecto que ya tiene la función andando. Lo corre la dueña
(o quien tenga acceso al proyecto), en este orden:

1. **Primero la base.** Aplicar las migraciones `*_pedido_totales.sql` y
   `*_ventas_validas.sql` (se aplican solas al mergear a `main`, con el
   workflow de deploy de la base; ver `CONTEXTO.md` §8). La función nueva lee
   columnas que crean esas migraciones: si se despliega antes, falla al leer el
   pedido y no sale ningún mail. La función vieja sí funciona con la base nueva.
2. **Revisar el token de Vault.** Tiene que ser la service-role key (ver la
   sección 4). Si es otra cosa (por ejemplo la anon key), la función nueva
   responde `401` y no sale ningún mail.
3. **Cargar el secreto nuevo y desplegar:**

   ```bash
   pnpm dlx supabase@latest secrets set OWNER_EMAIL=pecoraabril@gmail.com
   pnpm run deploy:fn
   ```

4. **Probar** con un pedido de prueba desde la web: tienen que llegar el
   recibo a la clienta y el aviso a la dueña. Un pedido cargado a mano desde el
   panel no tiene que mandar nada.

Para volver atrás: desplegar la versión anterior de la función
(`git checkout <commit-anterior> -- supabase/functions/enviar-recibo-pedido`
y `pnpm run deploy:fn`). `OWNER_EMAIL` se puede dejar cargado; la versión
anterior lo ignora.

### 4) Guardar la URL de la función + el token en Vault (SQL Editor, a mano)

La migración `0012` lee estos dos valores desde Supabase Vault en tiempo de
ejecución — nunca están hardcodeados en el SQL versionado. Corré esto UNA vez
en el SQL Editor, con tus valores reales:

```sql
select vault.create_secret(
  'https://<tu-project-ref>.supabase.co/functions/v1/enviar-recibo-pedido',
  'pecora_email_function_url'
);

select vault.create_secret(
  '<tu-service-role-key>',
  'pecora_email_function_token'
);
```

- La URL sale de reemplazar `<tu-project-ref>` por el ref real del proyecto.
- El token **tiene que ser la service-role key** del proyecto (Project
  Settings → API Keys → pestaña "Legacy API keys" → `service_role`, la que
  empieza con `eyJ...`). Es el mismo valor que Supabase le inyecta a la
  función como `SUPABASE_SERVICE_ROLE_KEY`, y la función lo compara byte a
  byte: cualquier otro valor recibe `401`.
- Por qué: la función se despliega con verificación JWT default (sin
  `--no-verify-jwt`), pero esa verificación también deja pasar la anon key,
  que es pública (está en el bundle del front). Sin el chequeo propio,
  cualquiera podía invocar la función.
- Para ver qué respondió la función a las últimas llamadas del trigger (útil
  si deja de llegar el mail), en el SQL Editor:

  ```sql
  select created, status_code, content
  from net._http_response
  order by created desc
  limit 10;
  ```

  `401` = el token de Vault no es la service-role key.
  `502` con `gmail_oauth_refresh_failed` = ver "El refresh token vence" más abajo.
- Para rotar cualquiera de los dos valores más adelante, usá
  `select vault.update_secret(...)` en vez de `create_secret` (que falla si
  el nombre ya existe).

### Setup completo desde cero (checklist para la dueña de la tienda)

Este mail se manda desde `pecoraabril@gmail.com` vía la API de Gmail, no
desde un proveedor transaccional — porque no hay un dominio propio
verificable (solo la cuenta de Gmail y un subdominio de Vercel, que no se
puede verificar como dominio de envío). El único costo es un setup de Google
Cloud que se hace UNA sola vez.

**Parte 1 — Google Cloud (una sola vez):**

1. Crear un proyecto en <https://console.cloud.google.com> (el nivel
   gratuito alcanza sin problema).
2. En el proyecto, ir a "APIs & Services" → "Library" y habilitar la
   **Gmail API**.
3. Ir a "APIs & Services" → "OAuth consent screen":
   - Tipo de usuario: **External**.
   - Estado de publicación: **In production** (botón "Publish app").
     **No dejarla en Testing**: en modo Testing, Google hace vencer los
     refresh tokens a los **7 días** y los mails dejan de salir (ver "El
     refresh token vence" más abajo). Publicarla no obliga a pasar la
     verificación de Google para una sola cuenta: al autorizar va a aparecer
     el aviso "Google no verificó esta app", y se continúa igual.
   - Si la dejás en Testing mientras probás, agregá `pecoraabril@gmail.com`
     en "Test users".
4. Ir a "APIs & Services" → "Credentials" → "Create Credentials" →
   "OAuth client ID":
   - Tipo de aplicación: **Desktop app** (es la más simple para sacar un
     token a mano una sola vez, no requiere hostear ninguna URL de
     redirección).
   - Guardar el **Client ID** y el **Client Secret** que te muestra — son
     `GMAIL_CLIENT_ID` y `GMAIL_CLIENT_SECRET`.
5. Conseguir el refresh token (una sola vez) usando el
   [OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
   1. Click en el ícono de engranaje (⚙️) arriba a la derecha → tildar
      "Use your own OAuth credentials" → pegar ahí el Client ID y el Client
      Secret del paso 4.
   2. En la lista de la izquierda (Step 1), buscar o escribir a mano el
      scope `https://www.googleapis.com/auth/gmail.send` → click
      "Authorize APIs".
   3. Iniciar sesión con `pecoraabril@gmail.com` y aceptar el permiso
      (puede avisar que la app no está verificada — es esperado, continuar
      igual).
   4. Ya en Step 2, click "Exchange authorization code for tokens".
   5. Copiar el valor de **Refresh token** — es `GMAIL_REFRESH_TOKEN`.
      Cuánto dura depende del estado de publicación del paso 3:
      - App en **Testing**: vence a los **7 días**, siempre.
      - App **In production**: no vence con el uso normal. Se invalida si se
        revoca el acceso desde la cuenta de Google, si se cambia la
        contraseña de la cuenta, o si pasa 6 meses sin usarse.

### El refresh token vence (los mails dejan de salir)

Síntoma: dejan de llegar el recibo y el aviso de pedido nuevo. En los logs de
la función (Edge Functions → enviar-recibo-pedido → Logs) aparece
`gmail_oauth_refresh_failed` con `invalid_grant`, seguido de un mensaje
`ACCIÓN REQUERIDA`. En `net._http_response` (ver la sección 4) se ve un `502`.

Causa más común: la app OAuth está en modo **Testing** y el refresh token
cumplió 7 días. Solución:

1. Google Cloud → "APIs & Services" → "OAuth consent screen" → **Publish
   app** (pasar a "In production").
2. Sacar un refresh token nuevo con el OAuth Playground (paso 5 de arriba).
   Los tokens emitidos mientras la app estaba en Testing siguen venciendo:
   hay que generar uno nuevo después de publicarla.
3. Cargarlo:

   ```bash
   pnpm dlx supabase@latest secrets set GMAIL_REFRESH_TOKEN=<nuevo>
   ```

   No hace falta volver a desplegar la función.

4. En el panel (Pedidos), tocar **Reenviar** en cada pedido que quedó con
   "no enviado": sale solo el mail que faltaba.

Si esto se repite, la alternativa es pasar a un proveedor transaccional
(Resend, Brevo, etc.), que usa una API key que no vence.

**Parte 2 — Supabase (igual que antes, solo cambian los secretos):**

6. Instalar el CLI de Supabase si no lo tenés: no hace falta instalar nada
   global, `pnpm dlx supabase@latest ...` lo descarga al vuelo cada vez.
7. `pnpm dlx supabase@latest login` (abre el navegador para autenticarte).
8. `pnpm dlx supabase@latest link --project-ref <tu-project-ref>`.
9. Crear `supabase/functions/.env.local` con los valores de la sección 2
   (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` del
   paso 5, `GMAIL_SENDER=pecoraabril@gmail.com`, `OWNER_EMAIL`, `BRAND_NAME`,
   `BRAND_LOGO_URL`, `STORE_URL` y, opcional, `WHATSAPP_NUMBER`).
10. `pnpm run deploy:fn` (o el comando manual de la sección 3, paso 1).
11. `pnpm dlx supabase@latest secrets set --env-file supabase/functions/.env.local`.
12. En el SQL Editor: correr los dos `vault.create_secret(...)` de la
    sección 4 con la URL real de tu función y tu service-role key.
13. En el SQL Editor: pegar y correr TODO `supabase/migrations/0012_email_pedido.sql`.
14. Probar: hacer un pedido de prueba de punta a punta y confirmar que llegan
    el recibo a la clienta y el aviso a `OWNER_EMAIL`. Revisar los logs de la función en el dashboard
    (Edge Functions → enviar-recibo-pedido → Logs) si algo no anduvo — todos
    los pasos (recibido, destinatario resuelto/omitido, enviado, error) están
    logueados con el prefijo `[enviar-recibo-pedido]`.
15. Probar también el caso sin email: un pedido cuyo `pedidos.email` esté
    vacío pero cuyo `user_id` tenga cuenta con email en `auth.users` (debe
    mandar igual, usando el fallback) y, si es posible, un caso sin ninguno de
    los dos (debe loguear `no_recipient` y no romper nada).

### Desarrollo local de la función (opcional, no requerido)

Este runbook no depende de correr la función localmente. Si igual querés
iterar sin desplegar cada vez, podés usar `pnpm dlx supabase@latest functions
serve enviar-recibo-pedido --env-file supabase/functions/.env.local`, pero eso
es un accesorio de desarrollo, no un paso del flujo de despliegue.

## `avisar-reposicion` ("Avisame cuando vuelva")

La dispara el trigger `productos_aviso_reposicion` de
`supabase/migrations/*_avisos_stock.sql` (`AFTER UPDATE OF stock ON
productos`), vía `pg_net`, cuando un producto pasa de **0 a más de 0** y tiene
suscripciones pendientes en `avisos_stock`. Manda un mail "¡Volvió
&lt;producto&gt;!" a cada clienta anotada, con el link al producto y un link de
baja (`<sitio>/aviso/baja?token=...`, también como header `List-Unsubscribe`).

Reglas:
- Para anotarse hace falta cuenta: el email sale de `auth.users` (RPC
  `suscribir_aviso_stock`), nunca del navegador. Solo productos sin stock.
- Cada suscripción avisa **una sola vez**: después de un envío OK la función
  marca `avisos_stock.notificado_at`.
- Antes de mandar, "reserva" la fila (RPC `reservar_aviso_stock`:
  `reservado_at = now()` solo si seguía pendiente), así dos invocaciones
  seguidas no duplican mails. Si el envío falla, borra la reserva y la fila
  queda pendiente.
- **Reservas vencidas**: si la función se cae o la cortan entre la reserva y el
  envío, la reserva vence a los **15 minutos** y la fila vuelve a ser
  pendiente. "Pendiente" = `notificado_at is null` y (`reservado_at is null` o
  `reservado_at < now() - 15 min`), la misma regla (`aviso_stock_pendiente`)
  en el trigger, en la lectura de pendientes (`avisos_stock_pendientes`) y en la
  reserva. La reintenta la próxima reposición del producto o, a mano:
  `select public.invocar_aviso_stock('<producto_id>');`. No hay reintento
  automático programado.
- Cada `fetch` (Google OAuth, Gmail y las llamadas a la base) tiene timeout de
  15 s (`AbortSignal.timeout`), así una respuesta colgada no deja la
  invocación esperando.
- Si el mail salió pero no se pudo guardar `notificado_at`, el log lo avisa con
  el `update` para marcarla: si no, al vencer la reserva podría salir un
  segundo aviso.
- Si el producto se volvió a agotar antes de que corra la función, no manda
  nada (siguen pendientes).
- Tandas de 200 filas, con tope de tiempo (~100 s) y corte tras 5 fallas
  seguidas de Gmail. Si quedan pendientes, el log dice cómo reintentar:
  `select public.invocar_aviso_stock('<producto_id>');` en el SQL Editor.
- Misma auth que `enviar-recibo-pedido`: el Bearer tiene que ser exactamente la
  service-role key (`401` si no).
- Lógica pura en `logica.ts` y template en `template.ts`, con tests de Vitest al
  lado (`pnpm test`). Reutiliza helpers de `enviar-recibo-pedido/logica.ts`
  (el bundler de `functions deploy` incluye ese import relativo).

### Secretos

Usa los mismos de `enviar-recibo-pedido` (`GMAIL_*`, `BRAND_NAME`,
`BRAND_LOGO_URL`) y uno nuevo, opcional:

```
PUBLIC_SITE_URL=https://pecora-muestrario.vercel.app
```

Es la URL pública del muestrario para armar los links. Si falta, usa
`STORE_URL`, y si tampoco está, `https://pecora-muestrario.vercel.app`.

### Vault

- Token: reutiliza `pecora_email_function_token` (la service-role key).
- URL: si ya está cargado `pecora_email_function_url` terminado en
  `/enviar-recibo-pedido`, la migración **deriva** la URL
  (`.../functions/v1/avisar-reposicion`) y no hace falta nada más. Para fijarla
  a mano (por ejemplo, si la URL del mail de pedidos es otra):

  ```sql
  select vault.create_secret(
    'https://<tu-project-ref>.supabase.co/functions/v1/avisar-reposicion',
    'pecora_avisos_function_url'
  );
  ```

### Despliegue (en este orden)

```bash
# 1) La función primero
pnpm dlx supabase@latest functions deploy avisar-reposicion

# 2) (Opcional) la URL pública del sitio
pnpm dlx supabase@latest secrets set PUBLIC_SITE_URL=https://pecora-muestrario.vercel.app
```

3. Después, la migración `*_avisos_stock.sql` (se aplica sola al mergear a
   `main`, con el workflow de deploy de la base; ver `CONTEXTO.md` §8). Si la
   migración llega antes que la función, el trigger hace POST contra un 404:
   no rompe nada, pero esas suscripciones quedan pendientes hasta la próxima
   reposición (o hasta reintentar con `invocar_aviso_stock`).
4. Probar: con una cuenta de prueba, anotarse en un producto sin stock; desde
   el panel, cargarle stock; tiene que llegar el mail y el link de baja tiene
   que funcionar. Diagnóstico: `net._http_response` (ver la sección 4 de
   arriba) y los logs con prefijo `[avisar-reposicion]`.

### Volver atrás

- Sacar el trigger sin perder las suscripciones:
  `drop trigger if exists productos_aviso_reposicion on public.productos;`
- Revertir todo: ver el bloque "Cómo revertirla" al final de la migración
  (borra la tabla y las suscripciones). El front oculta el bloque "Avisame
  cuando vuelva" si los RPCs o la tabla no existen.
- La función se puede borrar con
  `pnpm dlx supabase@latest functions delete avisar-reposicion`.

## `gestionar-equipo` (equipo del panel: empleados)

La llama el panel (pestaña Equipo) con el JWT de la sesión. Solo una cuenta con
rol `admin` puede usarla: el JWT se valida con `supabase.auth.getUser(token)` y
el rol se lee de `public.profiles` con la service-role key (nunca del body).
Cambiar `profiles.rol` solo es posible con service_role o desde el SQL Editor
(trigger `proteger_rol_perfil`, migración 0014): por eso esto vive en una Edge
Function y no en el front.

`POST` con `{ accion, ... }`:

| `accion` | Body | Respuesta OK |
|---|---|---|
| `listar` | — | `{ ok: true, miembros: [{ id, email, nombre, rol, ultimo_ingreso }] }` (admins primero) |
| `invitar` | `email`, `nombre` (hasta 80) | `{ ok: true, resultado: 'invitada' \| 'promovida' \| 'sin_cambios', miembro, origen_link }` |
| `revocar` | `user_id` | `{ ok: true }` |

- `invitar`: si no hay cuenta con ese email, manda la **invitación de Supabase
  Auth** (plantilla *Authentication → Email Templates → Invite user*) con el
  link a `PUBLIC_ADMIN_URL` y le da rol `empleado`. Si ya existe una cuenta de
  clienta, solo le cambia el rol (sin mail: entra con su contraseña de
  siempre). Si ya es admin, responde `409`. `origen_link` es el origen al que
  lleva el link del mail (solo si se mandó una invitación; si no, `null`); el
  panel lo muestra en el aviso de "Listo".
- Antes de invitar se valida `PUBLIC_ADMIN_URL`: tiene que ser una URL `https`
  (`http` solo para `localhost` / `127.0.0.1`) cuyo origen sea uno de los de
  `ADMIN_ORIGIN`. Si no, **no se manda ningún mail** y responde
  `500 config_invalida`; el log (`[gestionar-equipo] invitación no enviada:
  secreto X mal configurado (...)`) dice qué secreto revisar, mostrando solo
  orígenes.
- `revocar`: vuelve el rol a `cliente`. No se puede con una misma ni con otra
  admin. Tiene efecto inmediato (las policies leen el rol en cada consulta).
- Errores: `{ ok: false, error: <mensaje en español>, codigo }` con `400`
  (datos), `401` (sesión), `403` (no admin / origen no permitido), `409`,
  `500`/`502`.
- Usa dos funciones SQL solo para service_role (`equipo_listar()`,
  `usuario_id_por_email(text)`, migración `*_roles_empleados.sql`).
- Lógica pura en `logica.ts`, tests en `logica.test.ts` (`pnpm test`).

Qué puede hacer un empleado (RLS, migración `*_roles_empleados.sql`):
productos y categorías (alta, edición, borrado), fotos del bucket `productos`,
ver todos los pedidos, cambiarles el estado, mandarlos a la papelera /
restaurarlos, reenviar sus mails y cargar pedidos manuales (con cupón). **No**
puede: borrar pedidos definitivamente, tocar otras columnas del pedido
(descuento, envío, datos de la clienta), cupones, zonas de envío,
estadísticas, `ventas_validas` ni el equipo.

### Secretos

```
ADMIN_ORIGIN=https://<url-del-panel>                 # uno o varios, separados por coma (CORS)
PUBLIC_ADMIN_URL=https://<url-del-panel>             # a dónde lleva el link de la invitación
```

- `ADMIN_ORIGIN`: origen exacto del panel (esquema + dominio, sin barra ni
  ruta). Para probar en local se puede agregar `http://localhost:5173`. Si
  falta, la función rechaza a todo navegador (`403`).
- `PUBLIC_ADMIN_URL`: dirección del panel, `https` y del mismo origen que
  `ADMIN_ORIGIN` (si no, la función no invita y responde `config_invalida`).
  Tiene que estar también en *Authentication → URL Configuration → Redirect
  URLs*: eso la función no lo puede comprobar, y si falta Supabase manda el
  link al *Site URL* (el muestrario). Después de configurarla, invitar un
  email de prueba y confirmar que el aviso del panel ("El link del mail abre
  ...") y el link del mail apuntan al panel.

### Despliegue (en este orden)

```bash
# 1) La migración *_roles_empleados.sql (con el workflow de la base, al mergear a main).
# 2) Los secretos
pnpm dlx supabase@latest secrets set ADMIN_ORIGIN=https://<url-del-panel> PUBLIC_ADMIN_URL=https://<url-del-panel>
# 3) La función (verificación JWT default: NO usar --no-verify-jwt)
pnpm dlx supabase@latest functions deploy gestionar-equipo
```

4. Probar: desde el panel de la admin, invitar un email de prueba; tiene que
   llegar el mail, la cuenta aparece en `listar` con rol `empleado` y, al
   ingresar, ve Productos y Pedidos pero no Cupones / Estadísticas / Equipo.
   Revocarla y confirmar que pierde el acceso. Logs con prefijo
   `[gestionar-equipo]`.

### Volver atrás

- La función se puede borrar con
  `pnpm dlx supabase@latest functions delete gestionar-equipo` (el panel
  muestra "Falta desplegar la función gestionar-equipo").
- Quitar el acceso a todos los empleados sin tocar el esquema (SQL Editor):
  `update public.profiles set rol = 'cliente' where rol = 'empleado';`
- Revertir el esquema: ver el bloque "Cómo revertirla" al final de
  `*_roles_empleados.sql`.

## `cotizar-envio` (Andreani y Correo Argentino)

La llama el checkout (con la sesión de la clienta: el checkout exige cuenta)
para cotizar el envío del carrito con los transportistas configurados. Cada
opción se guarda en `public.cotizaciones_envio` (migración
`*_envios_transportistas.sql`), que vence a los **30 minutos** y se usa **una
sola vez**. El checkout manda el `cotizacion_id` elegido a `crear_pedido`
(`p_cotizacion_envio`): la base vuelve a validar CP, provincia, productos y
cantidades y toma el precio de esa fila. El navegador nunca decide el costo.
Si la cotización no vale (no existe, venció, ya se usó o no coincide),
`crear_pedido` responde con código `22023` y un mensaje para la clienta.

`POST` (JWT de usuario; la anon key recibe `401`):

```json
{ "cp": "5000", "provincia": "Córdoba",
  "items": [{ "producto_id": "<uuid>", "cantidad": 2 }] }
```

- `cp`: 4 dígitos o CPA (`X5000ABC`); a los transportistas va el código de 4
  dígitos. `items`: 1 a 50, `cantidad` entera de 1 a 99 (se agrupan por
  producto).
- Respuesta `200`:
  `{ opciones: [{ cotizacion_id, transportista, servicio, precio, plazo, expira_at, sucursal? }], zona, transportistas_activos }`
  - `transportista`: `andreani` | `correo_argentino`; `servicio`:
    `domicilio` | `sucursal`; `plazo`: texto (`"3 a 5 días hábiles"`) o
    `null`; `expira_at`: ISO, el vencimiento guardado en la base.
  - Envío a sucursal: **una opción por sucursal** (hasta 5), cada una con su
    `cotizacion_id` y `sucursal: { id, nombre, direccion }` (mismo precio).
    Si el transportista no devuelve sucursales, no hay opción de sucursal.
  - `zona`: `{ precio, nombre }` de la tarifa por zona de siempre
    (`cotizar_envio`) o `null`; sirve de respaldo si no hay opciones.
  - Un transportista que falla o tarda más de **5 s** se omite (queda en los
    logs como `[cotizar-envio] <id> omitido: <motivo>`, sin secretos).
- `GET ?estado=1` (alcanza la anon key; lo usa el panel):
  `{ transportistas_activos: [...] }`.
- Errores: `{ error: <mensaje en español>, codigo }` con `400` (datos),
  `401` (sesión), `403` (origen), `405`, `429` (límite), `500`.
- Un cupón de envío gratis deja el envío en 0 también con transportista.

Paquete: se arma **un solo bulto**. Peso = suma de `productos.peso_g` ×
cantidad; si un producto no tiene peso se usa `DEFAULT_PESO_G` (300 g).
Medidas = el máximo de cada lado entre los productos
(`alto_cm` / `ancho_cm` / `largo_cm`); si falta, `DEFAULT_ALTO_CM` (10),
`DEFAULT_ANCHO_CM` (15), `DEFAULT_LARGO_CM` (20). Valor declarado = subtotal
con los precios de la base. Cargar peso y medidas reales mejora la
cotización (`importar_productos` todavía no los carga).

Límite de abuso: 20 pedidos por minuto por IP, **en memoria de cada
instancia** (best effort: se reinicia cuando Supabase recicla la instancia y no
se comparte entre instancias). Las cotizaciones vencidas sin usar de más de un
día se borran de a poco (en ~2 % de los pedidos).

### APIs de los transportistas: qué está verificado y qué no

**Correo Argentino — API MiCorreo** (verificado con el manual oficial
`https://www.correoargentino.com.ar/MiCorreo/public/img/pag/apiMiCorreo.pdf`,
versión 8/8/2022):
- Base: `https://api.correoargentino.com.ar/micorreo/v1` (QA:
  `https://apitest.correoargentino.com.ar/micorreo/v1`). Credenciales por
  ambiente, las da Correo Argentino.
- `POST /token` con Basic Auth (usuario:contraseña) → `{ token, expires }`
  (`expires` como `"2022-04-26 21:16:20"`; se asume hora de Argentina). El
  resto va con `Authorization: Bearer <token>`. El token se guarda en memoria
  hasta un minuto antes de vencer (máximo una hora).
- `POST /rates` con `{ customerId, postalCodeOrigin, postalCodeDestination,
  dimensions: { weight (g, 1–25000), height, width, length (cm enteros,
  ≤ 150) } }`; sin `deliveredType` devuelve domicilio (`"D"`) y sucursal
  (`"S"`) juntas: `{ customerId, validTo, rates: [{ deliveredType,
  productType, productName, price }] }`. Si hay varias por tipo se toma la
  más barata. Un paquete fuera de esos límites omite a Correo.
- `GET /agencies?customerId&provinceCode&services=pickup_availability` →
  sucursales de **la provincia** (`code`, `name`, `location.address`,
  `services.pickupAvailability`, `status`). Códigos de provincia de una letra
  (tabla del manual; Córdoba = `X`, CABA = `C`, etc.).
- **Supuesto / no verificado**: `deliveryTimeMin` / `deliveryTimeMax` en
  `rates` (no están en el manual de 2022; si vienen se usan para `plazo`, si
  no `plazo` es `null`). La API no ordena sucursales por distancia: se eligen
  las 5 activas con retiro cuyo CP numérico es más cercano al de destino
  (aproximación). `customerId` se obtiene una vez con `POST /users/validate`
  (email y contraseña de MiCorreo) o lo informa Correo.

**Andreani** (el portal `developers.andreani.com` requiere registro y no se
pudo leer; lo de abajo sale del plugin oficial de Magento
`github.com/andreani-publico/magento-2.3` y de integraciones públicas — **no
verificado contra la documentación oficial**):
- Base: `https://apis.andreani.com` (QA: `https://apisqa.andreani.com`).
- `GET /login` con Basic Auth → token en el header `x-authorization-token`
  (duración no documentada: se guarda 1 hora). En varias integraciones
  `/v1/tarifas` responde sin token; por eso usuario y contraseña son
  opcionales: si están, las llamadas llevan el header.
- `GET /v1/tarifas?cpDestino&contrato&cliente&sucursalOrigen&bultos[0][valorDeclarado]&bultos[0][volumen]&bultos[0][kilos]&bultos[0][altoCm]&bultos[0][anchoCm]&bultos[0][largoCm]`
  (`volumen` en cm³, `kilos` en kg). Se usa `tarifaConIva.total` (el plugin
  oficial lee ese campo; otras fuentes muestran `tarifaConIva` como número:
  se aceptan las dos formas). `plazoEntrega` no está confirmado: si viene, se
  usa. Un contrato para domicilio y otro para sucursal (los da Andreani).
- `GET /v2/sucursales?codigoPostal=<cp>&canal=B2C` → lista con `id`,
  `descripcion`, `direccion { calle, numero, localidad, provincia,
  codigoPostal }`. Se toman las primeras 5.
- Antes de producción: probar con las credenciales reales en QA
  (`ANDREANI_API_URL=https://apisqa.andreani.com`) y revisar la respuesta
  en los logs.

### Secretos

```
CATALOG_ORIGIN=https://<url-del-muestrario>        # uno o varios, separados por coma (CORS)
ADMIN_ORIGIN=https://<url-del-panel>               # ya existe (gestionar-equipo); también se permite
ORIGEN_CP=5000                                     # CP desde donde se despacha (Correo lo exige)

# Andreani (se activa con ANDREANI_CLIENTE y al menos un contrato)
ANDREANI_CLIENTE=CL000xxxx
ANDREANI_CONTRATO_DOMICILIO=300000xxxx
ANDREANI_CONTRATO_SUCURSAL=300000xxxx
ANDREANI_SUCURSAL_ORIGEN=XXX                       # opcional
ANDREANI_USUARIO=...                               # opcional (login)
ANDREANI_PASSWORD=...                              # opcional (login)
ANDREANI_API_URL=https://apis.andreani.com         # opcional (QA: https://apisqa.andreani.com)

# Correo Argentino / MiCorreo (se activa con los 3 + ORIGEN_CP)
CORREO_USER=...
CORREO_PASSWORD=...
CORREO_CUSTOMER_ID=0000xxxxxx
CORREO_API_URL=https://api.correoargentino.com.ar/micorreo/v1   # opcional

# Paquete por defecto (opcionales)
DEFAULT_PESO_G=300
DEFAULT_ALTO_CM=10
DEFAULT_ANCHO_CM=15
DEFAULT_LARGO_CM=20
```

Un transportista sin sus secretos queda **desactivado** (no aparece en
`transportistas_activos`); sin ninguno, el checkout sigue con la tarifa por
zona. Los secretos nunca salen en respuestas ni logs.

### Despliegue (en este orden)

```bash
# 1) La migración *_envios_transportistas.sql (workflow de la base, al mergear a main).
# 2) Los secretos (los de un transportista se pueden cargar después)
pnpm dlx supabase@latest secrets set CATALOG_ORIGIN=https://<url-del-muestrario> ORIGEN_CP=<cp>
pnpm dlx supabase@latest secrets set CORREO_USER=... CORREO_PASSWORD=... CORREO_CUSTOMER_ID=...
pnpm dlx supabase@latest secrets set ANDREANI_CLIENTE=... ANDREANI_CONTRATO_DOMICILIO=... ANDREANI_CONTRATO_SUCURSAL=...
# 3) La función (verificación JWT default: NO usar --no-verify-jwt)
pnpm dlx supabase@latest functions deploy cotizar-envio
```

### Prueba manual

```bash
URL=https://<project-ref>.supabase.co/functions/v1/cotizar-envio
# Estado (anon key)
curl -s "$URL?estado=1" -H "Authorization: Bearer <anon-key>"
# Cotización (access_token de una sesión de prueba)
curl -s -X POST "$URL" -H "Authorization: Bearer <access-token>" \
  -H 'Content-Type: application/json' \
  -d '{"cp":"5000","provincia":"Córdoba","items":[{"producto_id":"<uuid>","cantidad":1}]}'
```

En local: `supabase functions serve cotizar-envio --env-file <archivo>` y
`http://127.0.0.1:55321/functions/v1/cotizar-envio` (el gateway local responde
el preflight CORS por su cuenta). Logs con prefijo `[cotizar-envio]`.

### Volver atrás

- Borrar la función (`pnpm dlx supabase@latest functions delete cotizar-envio`)
  o quitar los secretos de un transportista: el checkout vuelve a la tarifa
  por zona. `crear_pedido` sin `p_cotizacion_envio` se comporta como antes.
- Revertir el esquema: ver el bloque "Volver atrás" al final de
  `*_envios_transportistas.sql`.
