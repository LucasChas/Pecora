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
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=Pecora <pedidos@tu-dominio-verificado.com>
EMAIL_REPLY_TO=hola@tu-dominio-verificado.com
BRAND_NAME=Pecora
BRAND_LOGO_URL=https://tu-dominio.com/logo.png
STORE_URL=https://tu-dominio.com
```

Notas:
- `RESEND_API_KEY` sale de <https://resend.com> (ver "Setup completo" abajo).
- `EMAIL_FROM` requiere un dominio verificado en Resend — no podés mandar
  desde un email genérico (gmail.com, etc.).
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

1. Crear cuenta en <https://resend.com>.
2. Verificar un dominio propio en Resend (Domains → Add Domain) siguiendo las
   instrucciones de DNS que da Resend (registros TXT/CNAME/MX en el proveedor
   del dominio). Sin dominio verificado, Resend no deja mandar con un
   `from:` de marca — solo permite mandarte mails a vos misma de prueba.
3. Generar una API Key en Resend (API Keys → Create API Key).
4. Instalar el CLI de Supabase si no lo tenés: no hace falta instalar nada
   global, `pnpm dlx supabase@latest ...` lo descarga al vuelo cada vez.
5. `pnpm dlx supabase@latest login` (abre el navegador para autenticarte).
6. `pnpm dlx supabase@latest link --project-ref <tu-project-ref>`.
7. Crear `supabase/functions/.env.local` con los 6 valores de la sección 2.
8. `pnpm run deploy:fn` (o el comando manual de la sección 3, paso 1).
9. `pnpm dlx supabase@latest secrets set --env-file supabase/functions/.env.local`.
10. En el SQL Editor: correr los dos `vault.create_secret(...)` de la
    sección 4 con la URL real de tu función y tu service-role key.
11. En el SQL Editor: pegar y correr TODO `supabase/migrations/0012_email_pedido.sql`.
12. Probar: hacer un pedido de prueba de punta a punta y confirmar que llega
    el mail. Revisar los logs de la función en el dashboard
    (Edge Functions → enviar-recibo-pedido → Logs) si algo no anduvo — todos
    los pasos (recibido, destinatario resuelto/omitido, enviado, error) están
    logueados con el prefijo `[enviar-recibo-pedido]`.
13. Probar también el caso sin email: un pedido cuyo `pedidos.email` esté
    vacío pero cuyo `user_id` tenga cuenta con email en `auth.users` (debe
    mandar igual, usando el fallback) y, si es posible, un caso sin ninguno de
    los dos (debe loguear `no_recipient` y no romper nada).

### Desarrollo local de la función (opcional, no requerido)

Este runbook no depende de correr la función localmente. Si igual querés
iterar sin desplegar cada vez, podés usar `pnpm dlx supabase@latest functions
serve enviar-recibo-pedido --env-file supabase/functions/.env.local`, pero eso
es un accesorio de desarrollo, no un paso del flujo de despliegue.
