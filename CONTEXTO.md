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
`estado` (`'nuevo'|'confirmado'|'enviado'|'entregado'|'cancelado'`) · `pagado_at` (null = sin pagar) · `seguimiento` · `created_at`

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
| `20260928122631_avisos_stock.sql` | "Avisame cuando vuelva": tabla `avisos_stock` (con `reservado_at`; una reserva vence a los 15 min), RPCs `suscribir_aviso_stock`, `cancelar_aviso_stock`, `baja_aviso_stock`, y trigger `productos_aviso_reposicion` que llama a la Edge Function `avisar-reposicion` cuando un producto vuelve a tener stock. |
| `20260928122650_cupones_y_envios.sql` | Tablas `cupones`, `cupon_usos` y `zonas_envio`. `validar_cupon(p_codigo, p_subtotal, p_pedido_manual default false)` (el modo manual solo se respeta para admins), `cotizar_envio`, `crear_pedido` con 14 parámetros (agrega `p_cupon`) y `check (total >= 0)`. |
| `20260928144833_roles_empleados.sql` | Rol `empleado` y `es_staff()` (admin o empleado). Policies de staff sobre productos, categorías y pedidos; el trigger `pedidos_limitar_empleado` deja a un empleado cambiar solo `estado`, `eliminado_at` y `total`. `reenviar_emails_pedido` pasa a staff. `equipo_listar` y `usuario_id_por_email` solo para `service_role` (los usa la Edge Function `gestionar-equipo`). Tests: `supabase/tests/roles_empleados.test.sql`. |
| `20260928144835_estadisticas_mas_vendidos.sql` | `estadisticas(p_desde, p_hasta)`: jsonb con ventas por mes (zona `America/Argentina/Cordoba`), solo admin. `mas_vendidos(p_limite, p_dias)`: público, para "Lo más vendido". Tests: `supabase/tests/estadisticas.test.sql`. |
| `20260928144838_importar_productos.sql` | `productos.sku` y `importar_productos(p_filas jsonb, p_simular default true)`: solo staff, hasta 500 filas, todo o nada, errores con número de fila (desde 1); `p_simular = true` es la vista previa. Tests: `supabase/tests/importar_productos.test.sql`. |
| `20260928150000_revocar_ajustar_stock_pedido.sql` | Revoca EXECUTE de `ajustar_stock_pedido` a `public`/`anon`/`authenticated` (la podía llamar cualquiera por `/rest/v1/rpc`). Se aplicó a mano en producción y se sumó al repo después; `20261001020000_cerrar_ajustar_stock.sql` hace lo mismo (repetirlo no cambia nada). |
| `20260928155636_resenas.sql` | Reseñas con estrellas de compradoras verificadas: tabla `resenas` (una por producto y cuenta, `estrellas` 1–5, `comentario` ≤ 1000 recortado, `oculta`). Compra verificada = pedido propio del checkout, no cancelado ni en la papelera, que incluye el producto (`compra_verificada`, misma regla que `ventas_validas`; desde `20261001060000` también cuentan las cargas manuales con el email de la cuenta). Escritura solo por RPC: `guardar_resena` / `borrar_resena` (propia; 42501 sin login o sin compra), `ocultar_resena` y `resenas_moderacion` solo admin. Lectura pública: `resenas_de_producto` (solo el primer nombre, nunca email), `resumen_resenas`; `puede_resenar` y `mi_resena` para la clienta. RLS: visibles para todos, ocultas para el staff; `user_id` no se otorga a `anon`/`authenticated`. Tests: `supabase/tests/resenas.test.sql`. |
| `20260928191953_gastos_rentabilidad.sql` | Gastos y rentabilidad (solo admin). Tabla `gastos` (`fecha` por defecto hoy en hora de Argentina, `concepto` recortado de 1 a 200, `categoria` `materiales`/`packaging`/`envios`/`otros`, `monto` > 0, `producto_id` opcional con `on delete set null`, `cantidad` opcional > 0 = unidades que cubre la compra, `notas`, `created_by` fijado por trigger con `auth.uid()`); RLS de select/insert/update/delete con `es_admin()`, sin permisos para `anon`. `rentabilidad(p_desde, p_hasta)`: jsonb solo admin (42501) con `por_mes` (ingresos = `pedidos.total` de ventas válidas, igual que `estadisticas()`; gastos por `fecha`; beneficio y margen; zona `America/Argentina/Cordoba`), `totales`, `productos` (unidades y ventas brutas de `ventas_validas`, costo unitario estimado = sum(monto)/sum(cantidad) de las compras del producto con cantidad hasta `p_hasta`, costo, beneficio y margen estimados, `gastos_periodo`), `gastos_por_categoria` y `gastos_generales` (sin producto). Tests: `supabase/tests/gastos_rentabilidad.test.sql`. |
| `20260928193208_envios_transportistas.sql` | Cotización con Andreani y Correo Argentino: medidas y peso en `productos`, tabla `cotizaciones_envio` (solo `service_role`), datos del transportista en `pedidos` y `crear_pedido` de 15 parámetros (`p_cotizacion_envio`, se borra la firma de 14). Ya aplicada en producción; el frontend que la usa sigue en `develop`. Tests: `supabase/tests/envios_transportistas.test.sql`. |
| `20261001020000_cerrar_ajustar_stock.sql` | Revoca EXECUTE de `ajustar_stock_pedido` a `public`/`anon`/`authenticated`: era `SECURITY DEFINER` y cualquiera podía cambiar el stock por `/rest/v1/rpc`. La usan solo los triggers de pedidos. Tests: `supabase/tests/funciones_internas.test.sql` (lista de funciones `SECURITY DEFINER` que puede llamar cada rol). |
| `20261001020100_grants_explicitos.sql` | `GRANT`s explícitos de las tablas y funciones auxiliares de 0001→0014 (reemplaza el "auto expose" que se elimina el 2026-10-30). En producción no cambia nada. Tests: `privilegios_base.test.sql`. |
| `20261001030000_pedido_enviado_pagado.sql` | `pedidos.estado` acepta `enviado` (no toca el stock), columnas `pagado_at` y `seguimiento` (≤ 300). El trigger `pedidos_limitar_empleado` deja a un empleado cambiar también esas dos. Tests: `supabase/tests/pedido_enviado_pagado.test.sql`. |
| `20261001040000_ajustar_precios.sql` | `ajustar_precios(p_porcentaje, p_categoria_id, p_redondeo, p_simular default true)`: sube o baja un % los precios (todos o de una categoría), con redondeo opcional a un múltiplo (si el redondeo dejaría un precio en 0 o lo movería al revés de lo pedido, ese producto no cambia); `p_simular` devuelve la vista previa `{cambios:[{id,nombre,antes,despues}], cantidad}`. `SECURITY INVOKER` + chequeo `es_staff()` (42501); todo o nada. Tests: `supabase/tests/ajustar_precios.test.sql`. |
| `20261001050000_pedidos_limites.sql` | Trigger `pedidos_proteger_checkout` (BEFORE INSERT, solo origen `checkout`): máximo 5 pedidos cada 10 min y 20 por día por cuenta (con un advisory lock por cuenta, así las llamadas en paralelo no se saltean el límite), y el email del pedido es siempre el de la cuenta (el recibo no puede ir a otra dirección). Para todo pedido nuevo: largos máximos de los textos y hasta 50 ítems, con mensajes en castellano (solo al crear: los pedidos viejos se siguen pudiendo editar). Tests: `supabase/tests/pedidos_limites.test.sql`. |
| `20261001060000_resenas_compras_manuales.sql` | Reseñas: `compra_verificada` también cuenta los pedidos manuales (origen `admin`, no cancelados ni en la papelera) cuyo email coincide con el de la cuenta (sin importar mayúsculas ni espacios). Antes las ventas por WhatsApp nunca habilitaban a opinar porque su `user_id` es el del staff. El pedido manual tiene un campo Email opcional para esto (no manda mails). Tests: `supabase/tests/resenas_compras_manuales.test.sql`. |
| `20261001070000_mis_resenas.sql` | RPC `mis_resenas()` (solo `authenticated`): todas las reseñas de la cuenta (también las ocultas) en una llamada, para mostrar en "Mis pedidos" qué productos ya calificó. Tests: `supabase/tests/mis_resenas.test.sql`. |
| `20261001080000_mis_pedidos.sql` | RPC `mis_pedidos(p_numero default null)` (solo `authenticated`): los pedidos del checkout de la cuenta más los pedidos manuales (WhatsApp) cargados con el email de la cuenta, **solo si ese email está confirmado** (si no, alguien registrado con un email ajeno vería esos pedidos). Lo usan "Mis pedidos" y el comprobante. `compra_verificada` también exige email confirmado para contar los manuales. Helper interno `email_confirmado_de`. Tests: `supabase/tests/mis_pedidos.test.sql`. |
| `20261002010000_mi_cuenta.sql` | `profiles.acepta_novedades` (mails de novedades; UPDATE permitido solo sobre nombre, teléfono y esa columna) y largos máximos de nombre/teléfono. RPC `eliminar_mi_cuenta()` (solo `authenticated`, no staff): borra la cuenta; perfil, reseñas y avisos se van, los pedidos quedan con `user_id` null. Tests: `supabase/tests/mi_cuenta.test.sql`. |
| `20261002020000_cupones_visibles.sql` | `cupones.visible_en_cuenta` (default false; la admin lo marca en Ajustes → Cupones). RPC `cupones_disponibles()` (solo `authenticated`): los cupones visibles que la cuenta puede usar hoy, con las mismas reglas que `evaluar_cupon` (activo, vigencia, usos totales y por clienta, primera compra); la compra mínima se muestra pero no filtra. Tests: `supabase/tests/cupones_visibles.test.sql`. |
| `20261002030000_favoritos_direcciones.sql` | Tabla `favoritos` (user_id, producto_id) y tabla `direcciones` (alias, dirección, localidad, CP, provincia, `principal`; hasta 10 por cuenta, una sola principal), ambas con RLS: cada cuenta ve y cambia solo lo suyo; `user_id` sale de `auth.uid()`. Tests: `supabase/tests/favoritos_direcciones.test.sql`. |
| `20261003010000_avisos_tienda.sql` | Avisos automáticos por mail (Edge Function `avisos-tienda`): pedido enviado a la clienta (`pedidos.enviado_at`, `aviso_envio_enviado_at`; espera el seguimiento hasta 2 h), stock bajo a la dueña (`productos.stock_bajo_desde`, `aviso_stock_bajo_at`; umbral 3), carrito abandonado (tabla `carritos` con RLS propia, `profiles.recordar_carrito`) y resumen mensual (`reporte_mensual_datos`). Programa las tareas con pg_cron. Tests: `supabase/tests/avisos_tienda.test.sql`. |
| `20261004010000_talles.sql` | Talles por producto (opcional): tabla `producto_talles` (talle, stock ≥ 0, orden; único por producto sin importar mayúsculas), lectura pública y cambios solo del staff. `productos.stock` de un producto con talles = suma de sus talles (trigger `producto_talles_despues` → `sincronizar_stock_talles`; `productos_bloquear_stock_talles` ignora cambios directos). `crear_pedido` exige `talle_id` en esos productos, descuenta del talle y guarda el ítem como "Nombre (talle X)" con `talle_id`/`talle`; `ajustar_stock_pedido` devuelve al talle. Tests: `supabase/tests/talles.test.sql`. |

### Cómo se aplican

Las 0001→0013 se aplicaron **a mano** en producción (SQL Editor), así que la historia de migraciones del proyecto remoto está vacía. **Desde la 0014 se aplican con Supabase CLI y GitHub Actions**:

- **CI** (`.github/workflows/db-ci.yml`): en cada PR (y push a `develop`) que toque `supabase/**` o `.github/scripts/**`: corre los tests del guard (`.github/scripts/db-push-guard.test.sh`, con la CLI simulada), levanta una base local, aplica todas las migraciones desde cero, corre los tests pgTAP (`supabase/tests/`, incluido `privilegios_base.test.sql`) y el lint (falla solo con errores; los warnings son informativos).
- **Deploy** (`.github/workflows/db-deploy.yml`): en cada push a `main` que toque `supabase/migrations/**`, o a mano con *Run workflow* sobre `main`.
  - `plan` (entorno `production-plan`): corre el guard (`.github/scripts/db-push-guard.sh`, un `supabase db push --dry-run`), deja la lista en el resumen del job y **se detiene** si fuera a aplicar alguna de las 0001→0013 o si no entiende la salida.
  - `apply` (entorno `supabase-production`, **espera aprobación**): repite el guard, guarda el **esquema** `public` (sin datos, cifrado) como artifact `public-schema-before-run-<id>` por 7 días, ejecuta `supabase db push`, **verifica** que todas las migraciones quedaron aplicadas (`db-push-guard.sh --verify`) y hace un **smoke check**: `GET /rest/v1/productos` con la anon key debe dar HTTP 200. Resultados en el resumen del job.

> **Atención:** con el repo linkeado (`supabase link`, deja `supabase/.temp/`), **todo comando de la CLI sin `--local` apunta a producción** (`db push`, `migration list`, `migration repair`, `db dump`, ...). Para la base local, pasar siempre `--local`.

**Antes de aprobar `supabase-production`**

- [ ] La lista del resumen de `plan` es exactamente la de migraciones esperadas.
- [ ] *Dashboard → Database → Backups* muestra un backup reciente o un punto de PITR. El workflow **solo guarda el esquema**: los datos se recuperan únicamente desde ese backup. Si el plan de Supabase no tiene backups, hacer antes un dump de datos (`supabase db dump --linked --data-only -f <archivo>`) y guardarlo **fuera del repo** (tiene datos personales).

**Configuración de GitHub (una sola vez)**

*Settings → Environments*: crear los dos entornos, ambos con *Deployment branches → Selected branches* = `main`.

| Entorno | Reviewers | Environment secrets | Environment variables |
|---|---|---|---|
| `production-plan` | ninguno | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` | — |
| `supabase-production` | *Required reviewers* | los mismos tres + `SCHEMA_BACKUP_PASSPHRASE` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |

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

**Permisos de tablas**

Las 0001→0014 nunca hicieron `GRANT` de tablas a `anon`/`authenticated`: dependían de los permisos automáticos ("auto expose") con los que se creó el proyecto. Ese comportamiento se elimina el **2026-10-30**, así que `20261001020100_grants_explicitos.sql` otorga esos permisos de forma explícita y `supabase/config.toml` ya no tiene `auto_expose_new_tables` (la base local y la de CI usan el default nuevo: nada nuevo en `public` es accesible sin `GRANT`). En producción la migración no cambia nada: los permisos ya existían. `supabase/tests/privilegios_base.test.sql` fija los permisos que necesita la app y `funciones_internas.test.sql` las funciones `SECURITY DEFINER` que cada rol puede llamar; ambos fallan si cambian.

- [x] Migración con `GRANT`s explícitos y `auto_expose_new_tables` fuera de `config.toml`.
- [ ] Antes de aprobar el deploy, comparar producción con lo que espera el test (SQL Editor). Resultado esperado: **0 filas**. `falta` = producción no tiene un permiso que la app necesita; `sobra` = permiso que tiene que estar revocado. Los permisos por columna de `profiles` se revisan con la consulta (a) al final de `0014_proteger_rol.sql`.

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
- Toda tabla o función nueva en `public` necesita su `GRANT` explícito (no hay "auto expose"). Una función `SECURITY DEFINER` que no sea una RPC pública lleva `revoke execute ... from public, anon, authenticated` (lo controla `funciones_internas.test.sql`).
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

### Vista previa por producto (Open Graph)
WhatsApp, Instagram, Facebook y X leen las meta sin ejecutar JavaScript, así que la SPA sola siempre mostraba la vista previa genérica. `vercel.json` reescribe `/producto/:param` a la Vercel Function `api/producto-og.ts` **solo cuando el user-agent es un bot de vista previa** (facebookexternalhit, WhatsApp, Twitterbot, TelegramBot, etc.); las personas siguen recibiendo la SPA estática. La función toma el `index.html` del mismo deploy, busca el producto por slug o uuid en la API REST de Supabase con la clave anon (tope de 2,5 s) y reemplaza título, canónica, description, `og:*`, `twitter:*` y `product:*` con los datos del producto (nombre, descripción corta + precio en ARS, foto original https, URL canónica con slug). Ante cualquier falla (producto inexistente, Supabase lento o caído, falta de configuración) devuelve 200 con la vista previa genérica, nunca 500. Caché en el CDN: `s-maxage=600, stale-while-revalidate=86400` (genérica: 60 s). Solo actúa si `VITE_APP_MODE=catalog` en tiempo de ejecución (las variables `VITE_*` del proyecto de Vercel tienen que estar habilitadas para Production); en el deploy del panel devuelve el `index.html` sin cambios (con noindex). La lógica pura vive en `src/lib/ogProducto.ts`. Para refrescar una vista previa ya cacheada: Facebook Sharing Debugger → "Scrape Again". Probar con `curl -A "facebookexternalhit/1.1" <url-del-producto>`.

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
- **`/mi-cuenta`**: datos (nombre/teléfono), cupones visibles, favoritos, direcciones, avisos de stock, reseñas, cambiar contraseña o email, preferencia de mails y eliminar cuenta. `/cuenta` con sesión redirige acá.
- **`/mis-pedidos`**: historial con **estado en tiempo real** → cuando la admin cambia el estado, la clienta lo ve al instante. Cada pedido (no cancelado) tiene **"Descargar comprobante"** (`common/OrderPrintView` tipo `comprobante`: A4 "Comprobante de compra", no válido como factura; se guarda como PDF desde el diálogo de impresión) y cada producto comprado por la web tiene **"Calificar"** / sus estrellas con "Editar" (`account/CalificarProducto`, mismo formulario que la ficha).

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

### Respaldo de la base

El workflow **DB backup** (`.github/workflows/db-backup.yml`) hace una copia
completa de producción todos los días a las 3:17 (hora de Argentina): roles,
estructura y datos (productos, pedidos, cuentas, reseñas...). Queda cifrada
como artifact del workflow durante **30 días**. Si falla, GitHub manda un mail
a la dueña del repositorio. También se puede correr a mano: Actions → DB
backup → *Run workflow*.

**Configuración (una vez):** Settings → Environments → `production-plan` →
*Add environment secret* `BACKUP_PASSPHRASE` = una frase larga que solo sepa
la dueña (guardarla en un lugar seguro: sin ella el backup no se puede abrir).

**Lo que NO incluye:** las fotos de los productos (están en Supabase Storage,
no en la base). Conviene descargar una copia del bucket de vez en cuando.

**Restaurar** (por ejemplo en un proyecto nuevo de Supabase):

```bash
# 1) Descargar el artifact desde Actions → DB backup → la corrida → Artifacts.
# 2) Descifrar y descomprimir (pide la BACKUP_PASSPHRASE):
gpg --decrypt pecora-backup-AAAA-MM-DD-*.tar.gz.gpg > backup.tar.gz
tar -xzf backup.tar.gz          # deja roles.sql, schema.sql y data.sql
# 3) Cargar en la base nueva (connection string de Supabase → Database):
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "postgresql://postgres:[CLAVE]@[HOST]:5432/postgres"
```

Para recuperar solo algo puntual (un producto o un pedido borrado), no hace
falta restaurar todo: se abre `data.sql` y se copia la fila que falta.

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

### Desarrollo contra Supabase local (con datos de prueba)

1. **Apuntar el dev server al stack local.** Crear `.env.development.local` en la raíz (está en `.gitignore`) con:
   ```
   VITE_SUPABASE_URL=http://127.0.0.1:55321
   VITE_SUPABASE_ANON_KEY=<ANON_KEY de `supabase status -o env`>
   ```
   Vite lo aplica solo en `pnpm dev` y pisa esas dos variables de `.env`; el resto (WhatsApp, etc.) sigue saliendo de `.env`. Si el dev server ya estaba corriendo y no lo toma, reiniciarlo. Borrar el archivo vuelve a apuntar a producción.
2. **Cargar los datos de prueba.** Con las variables de puertos del stack local exportadas (`SUPABASE_API_PORT=55321 SUPABASE_DB_PORT=55322 SUPABASE_DB_SHADOW_PORT=55320 SUPABASE_STUDIO_PORT=55323 SUPABASE_INBUCKET_PORT=55324 SUPABASE_ANALYTICS_PORT=55327 SUPABASE_DB_POOLER_PORT=55329`):
   ```bash
   supabase db reset --local          # base vacía con todas las migraciones
   docker exec -i supabase_db_pecora psql -U postgres -v ON_ERROR_STOP=1 < supabase/seed-local.sql
   ```
   El seed crea categorías, productos, pedidos de los últimos ~4 meses, zonas de envío, cupones, reseñas y un aviso de stock. Se puede volver a correr sin resetear. No es `supabase/seed.sql` a propósito, para que el `db reset` de CI no lo cargue.
3. **Cuentas de prueba.** Las cuatro cuentas (admin, empleada y dos clientas) y su contraseña están en el comentario al principio de `supabase/seed-local.sql`. Solo existen en la base local.
