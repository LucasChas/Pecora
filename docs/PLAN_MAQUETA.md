# Plan: convertir Pecora en una maqueta vendible ("tienda en caja")

> Propuesta para estandarizar el sistema actual de modo que se pueda instalar
> para **cualquier organización** y que cada una lo personalice (marca, colores,
> textos, contacto, funcionalidades) **sin tocar el código del núcleo**.

---

## 0. Resumen en una línea

Separar el repo en **núcleo genérico** (lo que hoy funciona: catálogo, carrito,
checkout, cuentas, pedidos, admin) + **una carpeta de personalización por
cliente** (`tienda/`) + **una tabla de configuración en la base** que la dueña
edita desde el admin. Cada cliente = su propio proyecto Supabase + su propio
deploy, creados con un script de alta.

---

## 1. Diagnóstico: qué está atado a Pecora hoy

El sistema ya tiene buenas bases (tokens CSS, `lib/config.ts`, `VITE_APP_MODE`,
`BRAND_NAME` en la Edge Function), pero la marca está dispersa en ~80 lugares:

| Qué | Dónde | Problema |
|---|---|---|
| Nombre "Pecora" en textos | `lib/config.ts` (mensajes de WhatsApp), `LoginForm.tsx`, `AdminPage.tsx`, `AccountPage.tsx`, `OrderSuccess.tsx`, `OrderCard.tsx`, `Footer.tsx`, `index.html` | Hay que editar componentes para cambiar de marca |
| Rubro ("Accesorios de bebé", "Talle…", 🐑) | `Footer.tsx`, `ProductFormSheet.tsx`, `OrderCard.tsx`, `TermsPage.tsx`, `PrivacyPage.tsx` | Textos específicos del rubro dentro del núcleo |
| URLs y emails fijos | `TermsPage.tsx`, `PrivacyPage.tsx` (`pecora-muestrario.vercel.app`, `pecorabril@gmail.com`), las 3 plantillas de `supabase/auth-email-templates/` | Legales y mails apuntan al dominio de Pecora |
| Paleta | `styles/tokens.css` con nombres de marca (`--sage`, `--cream`, `--clay`) + 13 colores hex sueltos en otros `.css` | Cambiar colores obliga a buscar en varios archivos; los nombres no dicen el *rol* del color |
| Identidad visual | `assets/logo.png`, `Scallop.tsx` (festón), Fraunces + Inter | Elementos de marca mezclados con componentes genéricos |
| Moneda / idioma | `lib/format.ts` (`es-AR` / `ARS` fijos), voseo y femenino ("clienta") en toda la UI | No sirve para otro país, otra moneda ni otro público |
| Claves de storage | `supabaseClient.ts` (`pecora-auth-*`), `CartContext.tsx` (`pecora_cart_v1`) | Menor, pero conviene genérico |
| Placeholders de imagen | `lib/images.ts`, `admin/ProductCard.tsx` (`?text=Pecora` con colores fijos) | |
| Base de datos | 13 migraciones que se pegan a mano; nombres de secretos `pecora_email_function_*` | Instalar un cliente nuevo es lento y propenso a errores |
| Admin | "Marcar el admin" es un `update` manual por email | Paso manual crítico (ver trampa #3 de `CONTEXTO.md`) |

---

## 2. Modelo de distribución: ¿una instancia por cliente o SaaS multi-tenant?

| | **A. Una instancia por cliente** (recomendado para arrancar) | B. SaaS multi-tenant |
|---|---|---|
| Arquitectura | 1 proyecto Supabase + 1 deploy por cliente, mismo código | 1 base para todos, `tienda_id` en cada tabla + RLS por tienda |
| Cambios al código actual | Chicos: parametrizar | Grandes: reescribir RLS, `crear_pedido`, storage, auth, dominios |
| Aislamiento de datos | Total (cada cliente tiene su base) | Depende de que RLS esté perfecto |
| Personalización profunda | Fácil (hasta se puede forkear) | Solo lo que exponga la config |
| Costo por cliente | Supabase + hosting por cliente (ver §8) | Marginal casi cero |
| Escala cómoda | Hasta ~15–20 clientes mantenidos por una persona | Cientos |

**Recomendación:** arrancar con **A**. Reutiliza todo lo que ya funciona, se puede
vender en semanas y cada cliente es dueño de sus datos. Diseñar la config
(§3) de forma que, si algún día se pasa a **B**, la tabla `configuracion`
simplemente gane una columna `tienda_id`.

---

## 3. Las tres capas de personalización

La idea clave: **cada cosa personalizable vive en exactamente un lugar**, y el
núcleo nunca menciona una marca.

### Capa 1 — Configuración en la base (la edita la dueña desde el admin)

Lo que el cliente quiere cambiar seguido, **sin redeploy**. Nueva tabla singleton:

```sql
create table public.configuracion (
  id              boolean primary key default true check (id), -- una sola fila
  nombre_tienda   text not null,
  eslogan         text,                 -- ej. "Accesorios de bebé"
  logo_url        text,                 -- subido al bucket, no al repo
  favicon_url     text,
  color_primario  text default '#B08F55',
  color_fondo     text default '#F8F1E1',
  color_texto     text default '#3B2F22',
  whatsapp        text,
  instagram       text,
  email_contacto  text,
  url_sitio       text,
  moneda          text default 'ARS',
  locale          text default 'es-AR',
  stock_bajo_umbral int default 3,
  opciones_entrega jsonb default '["envio","coordinar"]',
  texto_terminos  text,                 -- markdown; si es null usa la plantilla
  texto_privacidad text,
  updated_at      timestamptz default now()
);
-- Lectura pública, escritura solo es_admin() (mismo patrón que productos).
```

En el front: un `ConfigProvider` (igual que `AuthContext`) que la lee al inicio
(con realtime, como `productos`) y la expone con `useConfig()`. Los colores se
inyectan como variables CSS en `:root`, así el resto del CSS no cambia.

En el admin: una tercera pestaña **"Mi tienda"** con estos campos (mobile-first,
igual que el resto del panel), con vista previa del color.

### Capa 2 — Carpeta `tienda/` (la configura quien instala, en build)

Lo estructural, que no cambia seguido y que conviene versionar:

```
tienda/
  tienda.config.ts     # features + valores por defecto de la Capa 1
  tema.css             # overrides finos de tokens / tipografías / elemento de marca
  textos.ts            # diccionario de textos (sobrescribe los del núcleo)
  assets/              # logo inicial, favicon, og-image
  emails/              # variables para las plantillas de mail
```

Ejemplo de `tienda.config.ts`:

```ts
export default defineTienda({
  nombre: 'Pecora',
  features: {
    carrito: true,           // false = modo "solo muestrario" (consulta por WhatsApp)
    cuentas: true,           // registro de clientes y "Mis pedidos"
    emailPedido: true,       // Edge Function de recibo
    instagram: true,
    mercadoPago: false,
    pedidosManuales: true,   // ManualOrderSheet en el admin
  },
  tema: {
    preset: 'calido',        // calido | minimal | oscuro | vibrante
    fuenteTitulos: 'Fraunces',
    fuenteTexto: 'Inter',
    ornamentoHeader: 'festón', // festón | ninguno | onda | línea
  },
  idioma: {
    trato: 'vos',            // vos | tu | usted
    cliente: 'neutro',       // neutro ("cliente") | femenino ("clienta") | masculino
  },
})
```

Los **flags de features** son lo que más valor comercial da: con el mismo código
se venden distintos planes (§8).

### Capa 3 — El núcleo (`src/`), igual para todos

Reglas para mantenerlo genérico:

1. **Prohibido** escribir el nombre de una marca, un rubro, una URL o un color
   hex dentro de `src/` (se puede chequear con un `grep` en CI).
2. Todo texto visible sale de `t('clave')` (diccionario en `src/i18n/es.ts`,
   sobrescribible desde `tienda/textos.ts`). No hace falta una librería de
   i18n: un objeto plano + una función alcanzan.
3. `money()` usa `config.moneda` y `config.locale`.
4. Los tokens CSS se renombran por **rol**, no por color:

   | Hoy | Propuesto |
   |---|---|
   | `--cream` | `--color-fondo` |
   | `--cream-deep` | `--color-superficie` |
   | `--ink` / `--ink-soft` | `--color-texto` / `--color-texto-suave` |
   | `--sage` / `--sage-deep` / `--sage-pale` | `--color-primario` / `--color-primario-hover` / `--color-primario-suave` |
   | `--clay` | `--color-acento` |
   | `--line` | `--color-borde` |

   Los tonos derivados (hover, pálido) se calculan con `color-mix()` a partir del
   primario, así el cliente elige **un solo color** y el resto se arma solo.
5. Los elementos de marca (`Scallop`, logo) pasan a ser "slots" configurables
   (`ornamentoHeader`), no componentes fijos.

---

## 4. Generalizar el modelo de datos para otros rubros

Hoy el producto es: nombre, categoría, descripción, precio, stock, fotos. Eso
sirve para muchísimos rubros tal cual. Lo que falta para vender "a cualquiera":

| Mejora | Para qué | Prioridad |
|---|---|---|
| `productos.atributos jsonb` + definición de atributos por tienda (ej. Talle, Color, Material) | Filtros y ficha según el rubro, sin columnas nuevas | Media |
| **Variantes** (`producto_variantes`: talle/color con su propio stock) | Ropa, calzado. Es lo primero que va a pedir una tienda de ropa | Media-alta, pero es el cambio más grande: `crear_pedido` y los triggers de stock pasan a trabajar por variante |
| `productos.activo boolean` | Ocultar sin borrar | Alta, es chico |
| `productos.orden int` | Ya está `@dnd-kit` instalado | Baja |
| Estados de pedido con **etiquetas** configurables (el enum se mantiene) | "Entregado" vs "Retirado" vs "Enviado" | Baja |
| Costo de envío fijo / por zona en `configuracion` | Mientras no haya API de correo | Media |

---

## 5. Base de datos: de "pegar 13 SQL" a instalación en un comando

1. **Consolidar** `0001`–`0013` en `supabase/migrations/0000_base.sql` (el estado
   final, idempotente) para instalaciones nuevas. Las migraciones viejas quedan
   en `supabase/migrations/legacy/` solo para Pecora.
2. Adoptar **Supabase CLI** (`supabase db push`), así el alta y las
   actualizaciones de cada cliente son un comando y no un copy-paste.
3. `supabase/seed.sql`: fila inicial de `configuracion` + categorías de ejemplo
   opcionales por rubro.
4. Función `promover_admin(email)` (solo ejecutable con service role) para
   reemplazar el `update` manual y evitar perder el acceso al panel.
5. Renombrar secretos/ajustes de Vault a nombres genéricos (`tienda_email_function_url`, etc.).
6. La Edge Function `enviar-recibo-pedido` ya lee `BRAND_NAME`, `BRAND_LOGO_URL`,
   `STORE_URL`: pasarla a leer esos datos **de la tabla `configuracion`** (así
   no hay que redeployar secretos si cambia el logo). Considerar además un
   proveedor transaccional (Resend/Brevo) como alternativa a Gmail OAuth, que
   por cliente es el paso de setup más engorroso.
7. Plantillas de mail de Auth (`supabase/auth-email-templates/`) con
   variables `{{NOMBRE_TIENDA}}`, `{{LOGO_URL}}`, `{{URL_SITIO}}`,
   `{{COLOR_PRIMARIO}}` y un script que las genere desde la config.

---

## 6. Alta de un cliente nuevo: `pnpm nueva-tienda`

Un script interactivo (Node, sin dependencias raras) que:

1. Pregunta: nombre, rubro, color primario, WhatsApp, Instagram, email,
   dominio, plan (features).
2. Genera `tienda/tienda.config.ts`, `tienda/textos.ts` y las plantillas de mail.
3. Con la Supabase CLI: linkea el proyecto, corre `0000_base.sql` + `seed.sql`,
   crea el bucket y el usuario admin (`promover_admin`).
4. Imprime el `.env` y el checklist de lo que queda manual (Vercel, dominio,
   plantillas de Auth, secretos del mail).

Objetivo medible: **de cero a tienda online en menos de 1 hora**.

Además, un documento `docs/INSTALACION.md` (evolución del README actual) y un
`docs/MANUAL_ADMIN.md` con capturas para entregarle a la dueña.

---

## 7. Cómo mantener N clientes sin que se desincronicen

- **Repo `tienda-base`** (el núcleo, lo que hoy es Pecora sin marca): acá van
  todos los arreglos y features.
- **Un repo por cliente** creado desde el template, con `tienda-base` como
  remote `upstream`. El cliente **solo** modifica `tienda/` → los
  `git merge upstream/main` no generan conflictos.
- **Pecora pasa a ser el cliente #1** (y la demo en vivo).
- Versionado semántico del núcleo (`v2.0.0`) y un `CHANGELOG.md` para saber
  qué migraciones nuevas correr en cada cliente al actualizar.
- CI mínimo en `tienda-base`: `pnpm build` + el `grep` de la regla 1 del §3.

(Alternativa cuando haya más clientes: un solo repo y un deploy por cliente con
variable `TIENDA=<slug>` que elige la carpeta `tiendas/<slug>/`. Más simple de
actualizar, pero todos los clientes quedan en el mismo repo.)

---

## 8. Aspectos comerciales y de infraestructura a tener en cuenta

**Planes posibles (salen de los feature flags):**

| Plan | Incluye |
|---|---|
| Muestrario | Catálogo + consulta por WhatsApp/Instagram + admin de productos |
| Tienda | + carrito, checkout, cuentas de clientes, pedidos, mails |
| Tienda + Pagos | + MercadoPago (cuando esté hecho) + envío |

Modelo típico: **costo de instalación** (setup + personalización) + **abono
mensual** (hosting, mantenimiento, actualizaciones).

**Ojo con los límites de los planes gratuitos:**

- **Supabase Free**: cantidad limitada de proyectos gratis por cuenta y los
  proyectos se pausan por inactividad. Para clientes reales conviene que
  **cada cliente tenga la cuenta de Supabase a su nombre** (vos como miembro)
  o presupuestar el plan Pro por proyecto.
- **Vercel Hobby** no permite uso comercial: para vender, plan Pro, o usar
  Netlify / Cloudflare Pages (ya hay `netlify.toml` y `_redirects`).
- Verificar los límites y precios vigentes antes de armar la tarifa.

**Legales:** las páginas de Términos y Privacidad pasan a ser **plantillas** con
variables (nombre, email, URL). Dejar claro en el contrato que el contenido
legal final es responsabilidad del cliente, y quién es dueño de los datos
(recomendado: el cliente).

---

## 9. Hoja de ruta sugerida

| Fase | Qué | Resultado |
|---|---|---|
| **1. Desacoplar** (lo más importante) | `ConfigProvider` + tabla `configuracion`; tokens por rol; diccionario de textos; `money()` configurable; sacar toda mención a Pecora de `src/` | El mismo código sirve para otra marca cambiando config |
| **2. Admin "Mi tienda"** | Pestaña para editar nombre, logo, colores, contacto, legales | La dueña personaliza sola |
| **3. Instalación** | Migración consolidada, Supabase CLI, `seed.sql`, `promover_admin`, script `nueva-tienda`, plantillas de mail generadas | Alta de un cliente en < 1 h |
| **4. Feature flags** | Muestrario vs Tienda; cuentas, mails, pedidos manuales opcionales | Planes vendibles |
| **5. Presets de tema** | 3–4 temas + ornamentos | Demos rápidas para mostrar a prospectos |
| **6. Rubros** | `activo`, atributos, variantes | Sirve para ropa, calzado, deco, etc. |
| **7. Pagos y envíos** | MercadoPago, costo de envío configurable | Plan premium |

Cada fase deja el sistema funcionando (Pecora sigue andando en producción todo
el tiempo) y se verifica con `pnpm run build` + prueba en el navegador, como
ya indica `CONTEXTO.md`.
