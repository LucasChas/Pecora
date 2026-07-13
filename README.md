# Pecora — Muestrario online

Muestrario de ropa de bebé (no es un ecommerce). Los clientes navegan el
catálogo público y, para comprar o consultar, escriben por **WhatsApp**. La
administradora (una sola usuaria, desde el celular) carga y edita productos,
precios, stock, categorías y fotos desde un panel mobile-first.

- **Frontend:** React + Vite + TypeScript, React Router.
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime). Sin servidor propio.
- **Dos vistas conectadas:** todo lo que se carga en `/admin` se refleja solo en
  el catálogo `/` gracias a Supabase Realtime.

## Rutas

| Ruta     | Vista                        | Acceso                    |
| -------- | ---------------------------- | ------------------------- |
| `/`      | Catálogo público (cliente)   | Sin login                 |
| `/admin` | Panel de administración      | Requiere login (Supabase) |

---

## 1. Crear el proyecto en Supabase

1. Entrá a [supabase.com](https://supabase.com) y creá un proyecto nuevo.
2. Anotá, en **Project Settings → API**:
   - **Project URL** → será `VITE_SUPABASE_URL`.
   - **anon public key** → será `VITE_SUPABASE_ANON_KEY`.
   (La clave `anon` es segura para el frontend: la seguridad la da RLS.)

### Crear el usuario administrador (la única cuenta)

En **Authentication → Users → Add user**, creá el usuario con **email + contraseña**
(marcá "Auto Confirm" para que quede confirmado). Ese email y contraseña son los
que se usan para entrar a `/admin`. No hace falta sistema de roles: es un solo usuario.

> Recomendado: en **Authentication → Providers → Email**, desactivá
> "Enable Sign Up" para que nadie más pueda registrarse.

---

## 2. Correr las migraciones

El esquema completo (tablas, RLS, bucket de Storage, triggers y Realtime) está en
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

**Opción rápida (recomendada):**
1. En el dashboard de Supabase, abrí **SQL Editor → New query**.
2. Pegá todo el contenido de `0001_init.sql` y ejecutá (**Run**).

Esto crea:
- Tablas `categorias` y `productos`.
- Políticas **RLS**: lectura pública; escritura solo para usuarios autenticados.
- Bucket de Storage **`productos`** (público para lectura, escritura autenticada).
- Trigger que **impide borrar una categoría con productos** (reforzado en el backend).
- Realtime habilitado en ambas tablas.

> Si querés arrancar con algunas categorías de ejemplo, descomentá el bloque final del SQL.

---

## 3. Configurar las variables de entorno

Copiá el ejemplo y completá con tus valores:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU-ANON-KEY
VITE_WHATSAPP_NUMBER=5490000000000
```

- `VITE_WHATSAPP_NUMBER`: número al que escriben los clientes, en formato
  internacional **sin `+` ni espacios**. Argentina: `549` + código de área + número.

---

## 4. Correr el proyecto local

```bash
npm install
npm run dev
```

- Catálogo: <http://localhost:5173/>
- Admin: <http://localhost:5173/admin>

Para probar el build de producción:

```bash
npm run build
npm run preview
```

---

## 5. Deploy en Vercel — dos URLs (muestrario público + admin privado)

La app usa la variable `VITE_APP_MODE` para exponer una sola vista por deploy.
Con eso creás **dos proyectos de Vercel desde el MISMO repo**: uno público
(muestrario) y otro privado (admin), cada uno con su dominio. El admin **no es
accesible** desde la web pública porque en ese deploy la ruta ni se registra.

**Variables comunes a los dos** (Project Settings → Environment Variables):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WHATSAPP_NUMBER`.
En ambos, framework preset **Vite** (build `npm run build`, output `dist`).

### Proyecto 1 — Muestrario (público)
1. Vercel → **Add New → Project** → importá el repo `LucasChas/Pecora`.
2. Agregá las 3 variables comunes **+** `VITE_APP_MODE = catalog`.
3. Deploy. Ese dominio (ej. `pecora.vercel.app`) es el que compartís con clientes.

### Proyecto 2 — Admin (privado)
1. Vercel → **Add New → Project** → importá **el mismo repo** otra vez.
2. Poné un nombre distinto (ej. `pecora-admin`) → dominio propio, ej.
   `pecora-admin.vercel.app` (o uno menos adivinable).
3. Agregá las 3 variables comunes **+** `VITE_APP_MODE = admin`.
4. Deploy. Ese link es el que usan solo vos y tu novia; el panel abre en la raíz `/`.

> La privacidad real la sigue dando el **login + RLS**: aunque alguien encuentre
> la URL del admin, sin usuario y contraseña no puede hacer nada.

Ambos proyectos apuntan a la misma base de Supabase, así que lo que se carga en
el admin aparece automáticamente en el muestrario.

Ya incluido: [`vercel.json`](vercel.json) con el rewrite de SPA (para que las
rutas no den 404 al recargar).

### Alternativa: Netlify
- Build command: `npm run build` · Publish directory: `dist`
- Mismo esquema de dos sitios con `VITE_APP_MODE`.
- Ya incluido: [`netlify.toml`](netlify.toml) y [`public/_redirects`](public/_redirects).

---

## Estructura del proyecto

```
src/
  lib/            supabaseClient, config de WhatsApp, formato de precios
  hooks/          useProducts, useCategories, useAuth (fetch + Realtime)
  components/
    catalog/      SearchBar, CategoryFilters, ProductGrid, ProductCard
    admin/        LoginForm, StatsStrip, ProductList, ProductCard,
                  ProductFormSheet, ImagePicker, CategoryManagerSheet
    Logo, Scallop (elementos de marca compartidos)
  pages/          CatalogPage, AdminPage
  styles/         tokens.css (paleta), global.css, catalog.css, admin.css
supabase/
  migrations/     0001_init.sql
```

## Reemplazar el logo

El isologo del header vive en [`src/assets/logo.png`](src/assets/logo.png) y el
favicon en `src/assets/logo-index.jpeg`. Para cambiarlos, reemplazá esos archivos
(sirve `.png`, `.webp`, `.jpeg` o `.svg`). Si cambiás la extensión del isologo,
ajustá el import en [`src/components/Logo.tsx`](src/components/Logo.tsx).

## Notas de diseño

- Paleta y tipografías (Fraunces + Inter) salen de los prototipos y están
  centralizadas en `src/styles/tokens.css`.
- El **borde festoneado** debajo del header del catálogo es un elemento de marca
  (componente `Scallop`), no decoración genérica.
- La **disponibilidad** de un producto se calcula desde `stock` (`stock > 0`), no
  es un campo aparte.
