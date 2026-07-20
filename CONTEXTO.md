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
| `crear_pedido(...)` | **SECURITY DEFINER**. Inserta el pedido y **devuelve el `numero`**. Exige `auth.uid()` (login). |
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

**Todas se corren a mano** pegándolas en el **SQL Editor** de Supabase (no se usa Supabase CLI todavía).

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
