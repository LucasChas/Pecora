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

## 5. Deploy (Netlify o Vercel)

El repo ya trae la configuración para ambos; elegí uno.

**Común a los dos:** en el panel del hosting, cargá las 3 variables de entorno
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WHATSAPP_NUMBER`).

### Netlify
- Build command: `npm run build` · Publish directory: `dist`
- Ya incluido: [`netlify.toml`](netlify.toml) y [`public/_redirects`](public/_redirects)
  (para que `/admin` no dé 404 al recargar).

### Vercel
- Framework preset: **Vite** (build `npm run build`, output `dist`).
- Ya incluido: [`vercel.json`](vercel.json) con el rewrite de SPA.

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

El isologo vive en [`src/assets/logo.svg`](src/assets/logo.svg) (hoy es un
placeholder). Reemplazá ese archivo por el logo real —sirve `.svg`, `.png` o
`.webp`—. Si cambiás la extensión, ajustá el import en
[`src/components/Logo.tsx`](src/components/Logo.tsx).

## Notas de diseño

- Paleta y tipografías (Fraunces + Inter) salen de los prototipos y están
  centralizadas en `src/styles/tokens.css`.
- El **borde festoneado** debajo del header del catálogo es un elemento de marca
  (componente `Scallop`), no decoración genérica.
- La **disponibilidad** de un producto se calcula desde `stock` (`stock > 0`), no
  es un campo aparte.
