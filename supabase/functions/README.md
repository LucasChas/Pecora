# Edge Functions — Pecora

Este proyecto NO adopta el stack local de Supabase (`supabase init`, `db push`,
etc.). Las migraciones SQL se siguen corriendo a mano en el SQL Editor del
dashboard, exactamente como hasta ahora (`0001` a `0012`). El único uso del
CLI de Supabase en este repo es para desplegar Edge Functions y setear sus
secretos — nada más.

## `enviar-recibo-pedido`

Manda el mail de confirmación de pedido. La dispara el trigger de
`supabase/migrations/0012_email_pedido.sql` (`AFTER INSERT ON pedidos`), vía
`pg_net`, de forma asíncrona y sin poder abortar el pedido si falla.

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
BRAND_NAME=Pecora
BRAND_LOGO_URL=https://tu-dominio.com/logo.png
STORE_URL=https://tu-dominio.com
WHATSAPP_NUMBER=5493511234567
```

Notas:
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
- El token recomendado es la **service-role key** del proyecto (Project
  Settings → API → `service_role` secret). La función se despliega con
  verificación JWT default (sin `--no-verify-jwt`), así que Supabase valida
  este Bearer automáticamente antes de que corra el código de la función —
  es más simple y menos propenso a errores que armar una firma HMAC a mano.
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
   - Estado de publicación: dejarlo en **Testing** (no hace falta pasar la
     revisión de Google para uso personal/de prueba con pocos usuarios).
   - En "Test users", agregar `pecoraabril@gmail.com`.
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
      (puede avisar que la app no está verificada — es esperado en modo
      Testing, continuar igual).
   4. Ya en Step 2, click "Exchange authorization code for tokens".
   5. Copiar el valor de **Refresh token** — es `GMAIL_REFRESH_TOKEN`. No
      expira con el uso normal (solo si se revoca manualmente o si la app
      queda sin usarse 6+ meses).

**Parte 2 — Supabase (igual que antes, solo cambian los secretos):**

6. Instalar el CLI de Supabase si no lo tenés: no hace falta instalar nada
   global, `pnpm dlx supabase@latest ...` lo descarga al vuelo cada vez.
7. `pnpm dlx supabase@latest login` (abre el navegador para autenticarte).
8. `pnpm dlx supabase@latest link --project-ref <tu-project-ref>`.
9. Crear `supabase/functions/.env.local` con los 7 valores de la sección 2
   (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` del
   paso 5, `GMAIL_SENDER=pecoraabril@gmail.com`, `BRAND_NAME`,
   `BRAND_LOGO_URL`, `STORE_URL`).
10. `pnpm run deploy:fn` (o el comando manual de la sección 3, paso 1).
11. `pnpm dlx supabase@latest secrets set --env-file supabase/functions/.env.local`.
12. En el SQL Editor: correr los dos `vault.create_secret(...)` de la
    sección 4 con la URL real de tu función y tu service-role key.
13. En el SQL Editor: pegar y correr TODO `supabase/migrations/0012_email_pedido.sql`.
14. Probar: hacer un pedido de prueba de punta a punta y confirmar que llega
    el mail. Revisar los logs de la función en el dashboard
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
