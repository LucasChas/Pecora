# Contexto del proyecto — Pecora

> Documento de contexto para retomar el proyecto (o para pegar como prompt inicial
> en una sesión nueva). Refleja el estado del sistema a la fecha del último commit.

---

## 1. Qué es

**Pecora** es una marca argentina de **ropa y accesorios de bebé**. El sistema nació
como un **muestrario online** (catálogo público + consulta por WhatsApp) y está en
proceso de convertirse en un **ecommerce completo**.

**Roles humanos:**
- **Desarrollador**: Lucas (estudiante de Ingeniería en Sistemas). Mantiene el código solo.
- **Administradora**: su novia. Es la **única usuaria del panel admin** y lo usa
  **desde el celular** (no tiene computadora) → el admin es **mobile-first, simple y sin fricción**.
- **Clientas**: navegan el catálogo, se crean cuenta, compran y siguen sus pedidos.

**Preferencias de código (importantes):**
- Comentarios **en español** en las partes no obvias.
- Código **fácil de leer y mantener**, **sin arquitectura sobredimensionada**.
- No reinventar el diseño: los prototipos HTML originales son la fuente de verdad estética.

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Frontend | Vite + React 18 + **TypeScript** |
| Routing | React Router v6 |
| Backend | **Supabase** (Postgres + Auth + Storage + Realtime). Sin servidor propio. |
| Estilos | **CSS plano** (sin Tailwind ni librerías de componentes) |
| Gestor de paquetes | **pnpm** |
| Deploy | **Vercel** (dos proyectos desde el mismo repo) |

**Repo:** https://github.com/LucasChas/Pecora
**Ramas:** `main` · `Feature/descripcion-de-producto` (PR pendiente) · `Feature/ecommerce` (trabajo actual)

**Proyecto Supabase:** ref `nmjwuxupovkqrxmttgrw` → `https://nmjwuxupovkqrxmttgrw.supabase.co`

---

## 3. Variables de entorno

```env
VITE_SUPABASE_URL=https://nmjwuxupovkqrxmttgrw.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key, está en .env local y en Vercel>
VITE_WHATSAPP_NUMBER=5493543582028      # formato internacional, sin + ni espacios
VITE_INSTAGRAM_USER=pecorababy          # sin @; vacío = oculta los botones de IG
VITE_APP_MODE=                          # catalog | admin | vacío (local = todas las rutas)
```

**`VITE_APP_MODE` define qué expone cada deploy** (así hay dos URLs distintas):
- `catalog` → solo muestrario público (la ruta `/admin` **no existe**).
- `admin` → solo el panel, servido en la raíz `/` (URL privada).
- vacío (desarrollo local) → todas las rutas.

`.env` está en `.gitignore`. Los rewrites de SPA ya están en `vercel.json` y `netlify.toml`/`public/_redirects`.

---

## 4. Identidad visual (tokens en `src/styles/tokens.css`)

```css
--cream:#F8F1E1;        /* fondo principal (lino cálido)   */
--cream-deep:#EEE1C4;   /* fondo secundario / cards        */
--ink:#3B2F22;          /* texto principal                 */
--ink-soft:#7C6E54;     /* texto secundario                */
--sage:#B08F55;         /* dorado camel: marca, botones    */
--sage-deep:#8E7040;    /* hover del dorado                */
--sage-pale:#F1E6CB;    /* fondos suaves                   */
--clay:#A97C55;         /* acento cálido                   */
--line:#E7DAB6;         /* bordes                          */
--danger:#C9645A;       /* destructivo / alertas           */
--unavailable:#A79A82;  /* "sin stock"                     */
--radius:14px;
```

- **Tipografías**: **Fraunces** (serif — títulos y nombres de producto) + **Inter** (sans — todo lo funcional). Google Fonts.
- **Elemento de marca**: el **borde festoneado** ("ribete de manta tejida") debajo del header del catálogo → componente `<Scallop />`. **No es decoración genérica, es marca.**
- **Logo**: `src/assets/logo.png` (wordmark PECORA + ovejita). Favicon: `src/assets/logo-index.jpeg`.

---

## 5. Modelo de datos (Postgres / Supabase)

### `categorias`
`id` uuid PK · `nombre` text **unique** · `created_at`

### `productos`
`id` uuid PK · `nombre` · `categoria_id` → categorias **ON DELETE RESTRICT** · `descripcion`
`precio` numeric(10,2) · `stock` int · `imagen_url` text (**portada**) · `imagenes` text[] (**galería**)
`created_at` · `updated_at` (trigger)

> **Disponibilidad = `stock > 0`** (no hay campo aparte).

### `pedidos`
`id` uuid PK · `numero` bigint **identity** (nº de orden legible) · `user_id` → auth.users
`nombre` · `telefono` · `email` · `entrega` (`'envio'|'coordinar'`) · `direccion` · `localidad` · `cp` · `notas`
`items` jsonb (foto de los ítems: `[{id,nombre,precio,cantidad}]`) · `subtotal` numeric
`estado` (`'nuevo'|'confirmado'|'entregado'|'cancelado'`) · `created_at`

### `profiles`
`id` uuid PK → auth.users · `nombre` · `telefono` · `rol` (`'cliente'|'admin'`) · `created_at`

### Storage
Bucket **`productos`**: lectura pública, escritura solo admin.

### Realtime
Publicadas en `supabase_realtime`: `productos`, `categorias`, `pedidos`.

---

## 6. Funciones y triggers

| Nombre | Qué hace |
|---|---|
| `set_updated_at()` | Trigger: mantiene `productos.updated_at`. |
| `impedir_borrar_categoria_con_productos()` | Trigger + FK `restrict`: **no se puede borrar una categoría con productos** (doble protección en backend). |
| `crear_pedido(...)` | **SECURITY DEFINER**. Exige `auth.uid()` (login), **descuenta el stock**, arma los ítems y el subtotal **con los precios de la base** (ignora los que manda el front) e inserta el pedido devolviendo el `numero`. |
| `es_admin()` | **SECURITY DEFINER stable**. `true` si el usuario actual tiene `rol='admin'`. Se usa en las políticas RLS. |
| `handle_new_user()` | Trigger en `auth.users`: crea el `profiles` al registrarse (toma `nombre`/`telefono` del metadata). |

---

## 7. Seguridad (RLS) — modelo actual

**Clave: clientas y admin son ambas `authenticated`.** La separación se hace con `es_admin()`.

| Tabla | Lectura | Escritura |
|---|---|---|
| `categorias`, `productos` | **pública** (anon + auth) | **solo admin** (`es_admin()`) |
| `pedidos` | propio (`user_id = auth.uid()`) **o** admin | alta **solo vía `crear_pedido`** (RPC); `update` (estado) **solo admin** |
| `profiles` | propio | propio |
| storage `productos` | pública | solo admin |

---

## 8. Migraciones (`supabase/migrations/`)

| Archivo | Contenido |
|---|---|
| `0001_init.sql` | Tablas base, RLS inicial, bucket de storage, realtime, triggers. |
| `0002_imagenes_multiples.sql` | Columna `imagenes text[]` + backfill desde `imagen_url`. |
| `0003_pedidos.sql` | Tabla `pedidos`, RLS, realtime. |
| `0004_crear_pedido.sql` | Función RPC `crear_pedido`. |
| `0005_cuentas.sql` | `profiles` + roles, `es_admin()`, `pedidos.user_id`, RLS endurecida, `crear_pedido` exige login. **Idempotente.** |
| `0006_stock_y_precios.sql` | `crear_pedido` descuenta stock de forma atómica y recalcula precios/subtotal contra la base; `check (stock >= 0)`. **Idempotente.** |
| `0007_borrar_pedidos.sql` | Policy de **delete** de pedidos (solo admin) + índices por `estado` y `numero`. **Idempotente.** |
| `0008_devolver_stock.sql` | Triggers: cancelar o borrar un pedido **devuelve el stock**; reactivar uno cancelado lo vuelve a descontar. **Idempotente.** |
| `0009_papelera_pedidos.sql` | Papelera de pedidos (borrar / restaurar) y regla única de stock: reserva si no está cancelado ni en la papelera. |
| `0010_pedido_eliminado_visible.sql` | La clienta sigue viendo (como cancelados) sus pedidos enviados a la papelera. |
| `0011_slug_productos.sql` | Slug único por producto, generado por trigger. |
| `0012_email_pedido.sql` | Trigger con `pg_net` que llama a la Edge Function del mail de pedido. Los secretos de Vault se cargan a mano (ver el archivo). |
| `0013_origen_pedido.sql` | Columna `pedidos.origen` (`checkout` / `admin`). |
| `0014_proteger_rol.sql` | Una clienta no puede cambiar `profiles.rol` (permisos por columna + trigger). Tests en `supabase/tests/`. |
| `20260928010451_pedido_totales.sql` | `pedidos`: `descuento`, `costo_envio` (≥ 0), `total` generada (`subtotal - descuento + costo_envio`), `provincia`, `idempotency_key` (única), `email_enviado_at`, `aviso_duena_enviado_at`. `productos`: `check (precio >= 0)`. `crear_pedido` con firma nueva de 13 parámetros (`p_provincia`, `p_idempotency_key`): idempotente por clave, `origen = 'admin'` solo si llama una admin, sin EXECUTE para `public`/`anon`. Tests: `supabase/tests/pedido_totales.test.sql`. |
| `20260928010452_ventas_validas.sql` | Vista `ventas_validas` (`security_invoker`): una fila por ítem de pedidos no cancelados y fuera de la papelera; respeta el RLS de `pedidos`. Tests: `supabase/tests/ventas_validas.test.sql`. |
| `20260928022104_reenviar_emails_pedido.sql` | Reenvío de mails de pedido. `invocar_email_pedido(uuid)`: llamada `pg_net` a la Edge Function con URL/token de Vault, compartida por el trigger y el RPC; sin EXECUTE para `anon`/`authenticated`. `pedido_creado_email()` la usa (mismo comportamiento: nunca bloquea el insert). `reenviar_emails_pedido(uuid)`: RPC solo admin (42501), devuelve el id de la request; la función solo manda lo que falta. Tests: `supabase/tests/reenviar_emails_pedido.test.sql`. |

### Cómo se aplican

Las 0001→0013 se aplicaron **a mano** en producción (SQL Editor), así que la historia de migraciones del proyecto remoto está vacía. **Desde la 0014 se aplican con Supabase CLI y GitHub Actions**:

- **CI** (`.github/workflows/db-ci.yml`): en cada PR (y push a `develop`) que toque `supabase/**` o `.github/scripts/**`: corre los tests del guard (`.github/scripts/db-push-guard.test.sh`, con la CLI simulada), levanta una base local, aplica todas las migraciones desde cero, corre los tests pgTAP (`supabase/tests/`, incluido `privilegios_base.test.sql`) y el lint (falla solo con errores; los warnings son informativos).
- **Deploy** (`.github/workflows/db-deploy.yml`): en cada push a `main` que toque `supabase/migrations/**`, o a mano con *Run workflow* sobre `main`.
  - `plan` (entorno `production-plan`): corre el guard (`.github/scripts/db-push-guard.sh`, un `supabase db push --dry-run`), deja la lista en el resumen del job y **se detiene** si fuera a aplicar alguna de las 0001→0013 o si no entiende la salida.
  - `apply` (entorno `production`, **espera aprobación**): repite el guard, guarda el **esquema** `public` (sin datos, cifrado) como artifact `public-schema-before-run-<id>` por 7 días, ejecuta `supabase db push`, **verifica** que todas las migraciones quedaron aplicadas (`db-push-guard.sh --verify`) y hace un **smoke check**: `GET /rest/v1/productos` con la anon key debe dar HTTP 200. Resultados en el resumen del job.

> **Atención:** con el repo linkeado (`supabase link`, deja `supabase/.temp/`), **todo comando de la CLI sin `--local` apunta a producción** (`db push`, `migration list`, `migration repair`, `db dump`, ...). Para la base local, pasar siempre `--local`.

**Antes de aprobar `production`**

- [ ] La lista del resumen de `plan` es exactamente la de migraciones esperadas.
- [ ] *Dashboard → Database → Backups* muestra un backup reciente o un punto de PITR. El workflow **solo guarda el esquema**: los datos se recuperan únicamente desde ese backup. Si el plan de Supabase no tiene backups, hacer antes un dump de datos (`supabase db dump --linked --data-only -f <archivo>`) y guardarlo **fuera del repo** (tiene datos personales).

**Configuración de GitHub (una sola vez)**

*Settings → Environments*: crear los dos entornos, ambos con *Deployment branches → Selected branches* = `main`.

| Entorno | Reviewers | Environment secrets | Environment variables |
|---|---|---|---|
| `production-plan` | ninguno | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` | — |
| `production` | *Required reviewers* | los mismos tres + `SCHEMA_BACKUP_PASSPHRASE` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |

- Los secretos van como **Environment secrets** en cada entorno, **no** como *Repository secrets*: esos los puede leer cualquier workflow de cualquier rama. Si ya existen como Repository secrets, borrarlos.
- `SUPABASE_ACCESS_TOKEN`: token personal (supabase.com → *Account → Access Tokens*). `SUPABASE_DB_PASSWORD`: contraseña de la base (*Project Settings → Database*). `SUPABASE_PROJECT_ID`: `nmjwuxupovkqrxmttgrw`.
- `SCHEMA_BACKUP_PASSPHRASE`: una frase larga al azar. Guardarla también en el gestor de contraseñas: sin ella el backup del esquema no se puede abrir.
- `SUPABASE_URL` (`https://nmjwuxupovkqrxmttgrw.supabase.co`) y `SUPABASE_ANON_KEY` (la misma que `VITE_SUPABASE_ANON_KEY`) son valores públicos: van como *variables*, no como secretos.

**Primera vez (bootstrap, desde la laptop; en Windows, con Git Bash)**

Hacerlo **antes** de mergear a `main` la primera migración. Si se mergea antes, `plan` se frena solo (baseline) y se vuelve a correr después del paso 2.

```bash
supabase login
supabase link --project-ref nmjwuxupovkqrxmttgrw      # desde acá, sin --local = PRODUCCIÓN
# 1. Marca 0001→0013 como aplicadas. Solo escribe la tabla de historia, no ejecuta SQL.
supabase migration repair --linked --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013
# 2. Guard (solo dry-run, no aplica nada). Debe terminar sin ERROR y listar solo
#    migraciones posteriores a la 0013 (0014 y las de timestamp).
bash .github/scripts/db-push-guard.sh --linked
```

3. Si el guard muestra `ERROR`, **no seguir**: el mensaje dice qué pasó.
4. Aplicar **con el workflow** (merge a `main` o *Run workflow*) y aprobar con el checklist de arriba: así quedan el backup del esquema, la verificación y el smoke check. Solo si el workflow no se puede usar, desde la laptop y después de confirmar el backup en el Dashboard:
   ```bash
   bash .github/scripts/db-push-guard.sh --linked && supabase db push --linked
   bash .github/scripts/db-push-guard.sh --verify --linked
   ```
5. `supabase unlink`, para que la laptop deje de apuntar a producción por defecto.

**Si algo sale mal**

- El paso *Verify* del job dice qué migraciones quedaron aplicadas; el *smoke check* en rojo significa que el catálogo público puede estar caído: revisar el sitio en el momento.
- **Esquema**: nunca editar una migración aplicada; crear una migración nueva que deshaga el cambio. El esquema previo está en el artifact del run: `gpg --decrypt --output esquema.sql public-schema-before-run-<id>.sql.gpg` (pide `SCHEMA_BACKUP_PASSPHRASE`; `gpg` viene con Git for Windows).
- **Datos**: solo se recuperan desde los backups / PITR de Supabase (*Dashboard → Database → Backups*).

**Permisos de tablas — tarea con fecha: antes del 2026-10-30**

Las 0001→0014 nunca hacen `GRANT` de tablas a `anon`/`authenticated`: dependen de los permisos automáticos ("auto expose") con los que se creó el proyecto, que en local reproduce `auto_expose_new_tables = true` de `supabase/config.toml`. Ese campo se elimina el **2026-10-30**. `supabase/tests/privilegios_base.test.sql` fija los permisos que necesita la app y falla si cambian.

- [ ] **Antes del 2026-10-30**: crear una migración con `GRANT`s explícitos y quitar `auto_expose_new_tables` de `supabase/config.toml`. `privilegios_base.test.sql` tiene que seguir pasando sin tocarlo.
- [ ] Antes de escribirla, comparar producción con lo que espera el test (SQL Editor). Resultado esperado: **0 filas**. `falta` = producción no tiene un permiso que la app necesita; `sobra` = permiso que tiene que estar revocado. Los permisos por columna de `profiles` se revisan con la consulta (a) al final de `0014_proteger_rol.sql`.

```sql
with requerido(rol, tabla, privilegio) as (values
  ('anon', 'categorias', 'SELECT'), ('anon', 'productos', 'SELECT'),
  ('authenticated', 'categorias', 'SELECT'), ('authenticated', 'categorias', 'INSERT'),
  ('authenticated', 'categorias', 'UPDATE'), ('authenticated', 'categorias', 'DELETE'),
  ('authenticated', 'productos', 'SELECT'), ('authenticated', 'productos', 'INSERT'),
  ('authenticated', 'productos', 'UPDATE'), ('authenticated', 'productos', 'DELETE'),
  ('authenticated', 'pedidos', 'SELECT'), ('authenticated', 'pedidos', 'UPDATE'), ('authenticated', 'pedidos', 'DELETE'),
  ('authenticated', 'profiles', 'SELECT'), ('authenticated', 'ventas_validas', 'SELECT'),
  ('service_role', 'pedidos', 'SELECT'), ('service_role', 'pedidos', 'UPDATE')
), prohibido(rol, tabla, privilegio) as (values
  ('anon', 'profiles', 'UPDATE'), ('authenticated', 'profiles', 'UPDATE'), ('anon', 'ventas_validas', 'SELECT'),
  ('authenticated', 'ventas_validas', 'INSERT'), ('authenticated', 'ventas_validas', 'UPDATE'), ('authenticated', 'ventas_validas', 'DELETE')
), otorgado as (
  select grantee::text as rol, table_name::text as tabla, privilege_type::text as privilegio
  from information_schema.role_table_grants where table_schema = 'public'
)
select 'falta' as problema, * from (select * from requerido except select * from otorgado) f
union all
select 'sobra', * from (select * from prohibido intersect select * from otorgado) s
order by 1, 2, 3, 4;
```

Si cambia el acceso de una tabla, actualizar juntas esta consulta y las listas del test.

**Crear una migración nueva**

```bash
supabase migration new nombre_descriptivo   # crea supabase/migrations/<timestamp>_nombre_descriptivo.sql
```

Usar siempre este comando. El timestamp ordena el archivo después de 0001→0014; numerar a mano (`0015_...`) falla en cuanto exista una migración con timestamp ya aplicada, porque el archivo quedaría antes y `db push` lo rechaza.

**Probar en local** (requiere Docker)

```bash
supabase db start                              # base local nueva con todas las migraciones aplicadas
supabase test db --local                       # tests pgTAP de supabase/tests/
supabase db lint --local
bash .github/scripts/db-push-guard.test.sh     # tests del guard (CLI simulada, sin base ni credenciales)
supabase stop --no-backup
```

Siempre con `--local` (ver la advertencia de arriba). Si otro proyecto de Supabase local ya ocupa los puertos 54322/54320, se pueden usar otros sin tocar `config.toml`: exportar `SUPABASE_DB_PORT=55322 SUPABASE_DB_SHADOW_PORT=55320` antes de esos comandos.

**Reglas**
- **Nunca editar ni renombrar una migración ya aplicada**: para corregir algo, crear una migración nueva.
- Migraciones idempotentes (ver §12.2). Si tocan permisos o RLS, agregar un test en `supabase/tests/` (y actualizar `privilegios_base.test.sql` si cambia el acceso a una tabla).
- `supabase/config.toml` tiene `auto_expose_new_tables = true` para que la base local tenga los mismos permisos que producción (ver el comentario en el archivo). Hay que reemplazarlo antes del 2026-10-30 (ver *Permisos de tablas*).
- Siguen siendo manuales: los secretos de Vault de la 0012 y el deploy de Edge Functions (`supabase functions deploy`).

---

## 9. Arquitectura del frontend

```
src/
  App.tsx                 # rutas según VITE_APP_MODE; CatalogLayout monta el CartDrawer
  main.tsx                # AuthProvider > CartProvider > App
  context/
    AuthContext.tsx       # session, perfil, esAdmin, registrar/ingresar/salir
    CartContext.tsx       # items, subtotal, cantidades, localStorage, estado del drawer
  hooks/
    useProducts.ts        # fetch + realtime + refetch
    useCategories.ts
    useOrders.ts          # pedidos del admin
  lib/
    supabaseClient.ts
    config.ts             # WhatsApp + Instagram y armadores de mensajes/pedidos
    format.ts             # money() en ARS
    images.ts             # imagenesDe / portadaDe / placeholder
    imageCompress.ts      # comprime a JPEG ~1400px antes de subir
    stock.ts              # avisoStockBajo() ("¡Últimas N unidades!")
  types.ts
  pages/
    CatalogPage · ProductPage · CartPage · CheckoutPage
    AccountPage · MyOrdersPage · AdminPage
  components/
    Logo · Scallop
    catalog/   SearchBar, CategoryFilters, ProductGrid, ProductCard, ProductDetailView
    cart/      CartIcon, CartDrawer, AddToCart, OrderSuccess
    account/   AccountButton, HeaderActions
    admin/     LoginForm, StatsStrip, ProductList, ProductCard, ProductFormSheet,
               ImagePicker, CategoryManagerSheet, OrdersList, OrderCard
  styles/      tokens.css, global.css, catalog.css, admin.css, cart.css, account.css
supabase/migrations/0001..0005
```

### Rutas
- **Catálogo**: `/` · `/producto/:id` · `/carrito` · `/checkout` · `/cuenta` · `/mis-pedidos`
- **Admin**: `/admin` (o `/` si `VITE_APP_MODE=admin`)

---

## 10. Funcionalidades implementadas

### Muestrario (público)
- Búsqueda por **nombre, descripción y categoría**.
- **Chips de categoría** generados desde la tabla; **categoría y búsqueda viven en la URL** (`?cat=&q=`) → filtros compartibles y botón atrás.
- Cards con portada, contador de fotos, **aviso "últimas N unidades"** (stock ≤ 3), estado **"Sin stock"** (card grisada + badge).
- **Página de producto** `/producto/:id` con **galería** (foto grande + miniaturas), breadcrumb, deep-link.
- Botones de consulta: **WhatsApp** (mensaje prellenado) e **Instagram** (`ig.me/m/...`).
- **Carrito lateral (drawer)**: se abre al agregar o al tocar el ícono; cantidades, subtotal, bloqueo de scroll, cierre por Escape/backdrop.

### Cuentas de clientas
- Registro/login en `/cuenta`. **Login obligatorio antes del checkout** (redirige con `?next=`).
- **`/mis-pedidos`**: historial con **estado en tiempo real** → cuando la admin cambia el estado, la clienta lo ve al instante.

### Checkout
- Diseño en **secciones numeradas** (1 Tus datos · 2 Entrega · 3 Pago) + **resumen lateral** (sticky en desktop, arriba en mobile).
- **Revalida stock y precios contra la base** antes de confirmar (corrige el carrito y avisa).
- Registra el pedido vía `crear_pedido` → **modal de éxito con check animado** + botón para enviar el detalle por WhatsApp.
- Sección de pago con **MercadoPago marcado "Muy pronto"** (gancho `TODO` ya en el código).

### Admin (mobile-first, protegido, solo rol admin)
- Pestañas **Productos / Pedidos**.
- **Productos**: lista en cards, **edición inline de precio y stock** (revierte si se vacía), alta/edición en **bottom sheet**, **multi-imagen** (galería, se comprimen antes de subir), selector de categoría con creación al vuelo.
- **Categorías**: listado con cantidad de productos, alta y borrado **bloqueado si tiene productos** (front + backend).
- **Pedidos**: datos de la clienta (con link directo a WhatsApp), entrega, ítems, subtotal, **cambio de estado** y **badge de pedidos nuevos**; realtime.

---

## 11. Convenciones de trabajo

- **Comandos**: `pnpm install`, `pnpm dev`, `pnpm run build` (corre `tsc && vite build`).
- **Verificación**: siempre `pnpm run build` + prueba en el navegador antes de commitear.
- **Commits**: mensaje en español + `Co-Authored-By`.
- `pnpm-workspace.yaml` incluye `onlyBuiltDependencies: [esbuild]` (pnpm bloquea build scripts por defecto).

---

## 12. Aprendizajes / trampas ya resueltas (¡importante!)

1. **`insert().select()` + RLS**: si quien inserta no tiene permiso de **SELECT**, el "devolver la fila" falla con **42501**. Por eso los pedidos se crean con la función **`crear_pedido` (SECURITY DEFINER)**, que inserta y devuelve el número sin exponer la lectura.
2. **Migraciones idempotentes**: hay que poner `drop policy if exists` antes de cada `create policy`, si no re-correr tira **42710** (`policy already exists`).
3. **Marcar el admin**: usar `where email in ('a','b')`. Con `and email=` no matchea nada y **se pierde el acceso al panel**.
4. **Clientas y admin son ambas `authenticated`** → sin `es_admin()` en las políticas, una clienta podría editar productos. Ya está blindado.
5. **Imágenes**: se comprimen en el navegador (JPEG ~1400px, calidad 0.82) antes de subir; las fotos del cel pesaban 1-5 MB.
6. **Emails**: los clientes de correo no soportan CSS moderno ni SVG → las plantillas usan **tablas + estilos inline**.
7. **Hooks que leen tablas con RLS deben depender de `session`**: `useOrders` hacía el fetch una sola vez al montar (antes del login, como anónimo) y no lo repetía al ingresar, así que la admin abría el panel y veía la lista de pedidos vacía o incompleta. Quien consulta define qué devuelve RLS.
8. **Descontar stock es del backend, no del front**: el checkout revalida contra la base para avisar antes, pero la única protección real contra dos clientas comprando la última unidad es el `update ... where stock >= cantidad` dentro de `crear_pedido`.
9. **El stock se descuenta y se devuelve**: descontar al crear el pedido es solo la mitad. Cancelarlo o borrarlo tiene que reponerlo (triggers de la 0008), si no la mercadería queda invisible aunque esté en el cajón.
10. **Un `delete` bloqueado por RLS no da error**: devuelve 0 filas y `error: null`. Si el botón no chequea las filas afectadas (`.select()`), queda mudo y parece que no hace nada.

---

## 13. Estado y pendientes

### Configuración de Supabase requerida
- **Authentication → Providers → Email → "Enable Sign up" ACTIVADO** (las clientas se registran).
- *"Confirm email"*: si está activo, se envía el mail de activación (plantilla lista, ver abajo); si está desactivado, la clienta entra apenas se registra.
- Plantilla de **activación de cuenta** hecha: `pecora-email-activacion.html` → pegar en **Authentication → Email Templates → "Confirm signup"** (usa `{{ .ConfirmationURL }}`).

### Pendientes
| # | Pendiente | Bloqueado por |
|---|---|---|
| 1 | **MercadoPago**: Edge Function que crea la preferencia + redirección + webhook + páginas de resultado | Falta el **Access Token de prueba** de MP (va como *secret* de Supabase, **nunca** en el front) |
| 2 | **Cálculo de envío por CP** (Andreani / Correo Argentino) | Requiere cuenta/API del correo. Alternativa: costo fijo o coordinar por WhatsApp |
| 3 | **PRs a `main`** de `Feature/descripcion-de-producto` y `Feature/ecommerce` | — |
| 4 | Cargar `VITE_INSTAGRAM_USER` en los proyectos de Vercel | — |
| 5 | Limpiar **pedidos de prueba** ("Diag", etc.) desde el admin | — |
| 6 | Plantillas de email de **recuperar contraseña** y **magic link** | — |

---

## 14. Cómo levantar el proyecto

```bash
pnpm install
pnpm dev          # http://localhost:5173
```
- Catálogo: `/` · Panel: `/admin`
- Requiere `.env` con las variables de la sección 3 y las migraciones 0001→0005 corridas en Supabase.
