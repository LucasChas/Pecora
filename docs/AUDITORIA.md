# Auditoría del sistema Pecora vs. el benchmark del mercado

> Fecha: 2026-10-08. Referencias: **Tiendanube** (líder en Argentina), **Shopify**,
> guías de UX de **Baymard Institute** y **Core Web Vitals** de Google.
> Auditoría de solo lectura: este documento no cambia código.

## Resumen

La base técnica está **por encima** de lo que tiene una tienda típica de Tiendanube
en seguridad de datos, tests y proceso de deploy:
- precios y stock recalculados en el servidor;
- pedidos idempotentes;
- grants y RLS cubiertos por tests pgTAP;
- 923 tests unitarios pasando;
- backup diario cifrado.

Las brechas grandes están en tres lugares:
1. **Cobrar.** No hay pago online. El único medio real es coordinar por WhatsApp, y en
   Argentina 8 de cada 10 compradores miran las cuotas antes de comprar (CACE 2025).
2. **Abuso de la compra como invitada.** Sin sesión se puede reservar todo el stock
   o bloquear el checkout (ver C1–C3).
3. **Requisitos legales y de marketing.** Faltan el botón de arrepentimiento, la
   factura electrónica, los datos fiscales, la medición de ecommerce (GA4/Meta) y
   los datos estructurados para Google.

## Comparación rápida

| Área | Tiendanube / Shopify | Pecora | Estado |
|---|---|---|---|
| Pago online (Mercado Pago, cuotas, débito) | Nativo | No (WhatsApp) | ❌ |
| Descuento por transferencia | Nativo | No | ❌ |
| Envío: cotización por CP | Nativo | Sí (Andreani / Correo, en checkout) | 🟡 falta en ficha y carrito |
| Envío: etiquetas y seguimiento automático | Nativo (Envío Nube) | Seguimiento manual | ❌ |
| Envío gratis desde $X | Nativo | No visible | 🟡 |
| Factura electrónica ARCA | Por app | No | ❌ (legal) |
| Variantes talle + color | Nativo | Solo talle | 🟡 |
| Guía de talles | Página o app | Sí | ✅ |
| Cupones | Nativo | Sí | ✅ |
| Promos 2x1 / 3x2 / progresivas | Nativo | No | ❌ |
| Carrito abandonado | Nativo | Sí, solo con cuenta | 🟡 |
| Reseñas verificadas | App | Sí | ✅ |
| Favoritos, direcciones, aviso de reposición | App | Sí | ✅ |
| Compra como invitada | Sí | Sí | ✅ (falta protección) |
| Sitemap y vista previa al compartir | Sí | Sí | ✅ |
| Datos estructurados (JSON-LD) | En el tema | No | ❌ |
| GA4 / Meta Pixel + CAPI | Nativo | Solo pageviews (Vercel) | ❌ |
| Google Shopping / catálogo de Meta | Nativo | Feed CSV de Meta | 🟡 |
| Sincronización con Mercado Libre | App | No | ❌ |
| Email marketing | Nativo | Solo transaccional (Gmail SMTP) | 🟡 |
| Multiusuario con roles | Sí | Admin + empleada | ✅ |
| Admin desde el celular | App | Panel mobile-first + PWA | ✅ |
| Estadísticas y rentabilidad | Básico | Sí (con gastos) | ✅ mejor que el benchmark |
| Botón de arrepentimiento | Sí | No | ❌ (legal) |
| MFA para la cuenta admin | Sí | No | ❌ |

## Críticos (hacer ya)

> **Estado:** C1–C3 resueltos en `20261008120000_proteger_compra_invitada.sql`
> + Edge Function `crear-pedido-invitada` + CAPTCHA en el checkout. Falta
> desplegar (ver `supabase/functions/README.md`). Quedan pendientes el
> vencimiento automático de reservas (decisión de negocio, ver C1) y el cambio
> de Gmail a un proveedor transaccional.

**C1. Sin sesión se puede vaciar el stock de toda la tienda.**
- `crear_pedido` se puede llamar como `anon` (`supabase/migrations/20261005010000_compra_invitada.sql:304-306`).
- La RPC solo rechaza cantidades ≤ 0 (`:129-131`): no hay tope por ítem. Un pedido acepta hasta 50 ítems.
- El pedido `nuevo` reserva el stock sin vencimiento.
- Los topes por email y teléfono se esquivan cambiando esos datos en cada llamada.
- **Arreglo:**
  - ✅ Tope de 10 unidades por producto y 30 por pedido (`crear_pedido`, antes de tocar el stock).
  - ✅ CAPTCHA (Cloudflare Turnstile) verificado en el servidor para las invitadas; la anon key ya no puede llamar a `crear_pedido`.
  - ⏳ Vencimiento de reservas: hoy los pedidos se coordinan por WhatsApp y la admin los confirma a mano, así que liberar stock a los 30–60 min cancelaría pedidos reales. Tiene sentido con Mercado Pago (estado `pendiente_pago`); sin eso, habría que definir un plazo (por ejemplo, 48 h sin confirmar).

**C2. El tope global de 40 pedidos por hora permite bloquear el checkout a propósito.**
- El contador es global para todas las invitadas (`compra_invitada.sql:371-377`): un atacante lo consume y las clientas reales no pueden comprar.
- **Arreglo:** ✅ se quitó el tope global; ahora hay CAPTCHA y un tope por conexión (5 cada 10 min, 20 por día) en `crear-pedido-invitada`.

**C3. El recibo de invitada se puede usar para mandar spam o phishing.**
- A una invitada no se le verifica el email.
- El recibo sale desde el Gmail de la tienda e incluye `nombre` y `notas` (hasta 1000 caracteres) escritos por quien compra.
- Revisando el template, el recibo no incluye las notas: el texto libre que llega es el **nombre** (hasta 120 caracteres) en el saludo.
- **Arreglo:**
  - ✅ El saludo usa solo el primer nombre si es una palabra de letras (hasta 20); si no, saluda sin nombre. Se suma "Si no hiciste este pedido, podés ignorar este mail".
  - ✅ El CAPTCHA y el tope por conexión limitan cuántos recibos se pueden disparar.
  - ⏳ Pasar a un proveedor transaccional (Resend, Postmark o SES) con dominio propio y SPF, DKIM y DMARC. Gmail además corta en unos 500 mails por día.

## Alta prioridad

### Negocio y legal
1. **Mercado Pago (Checkout Pro o Bricks) con cuotas.**
   - Es la mayor palanca de conversión.
   - Antes de conectarlo hacen falta:
     - una tabla `pagos` (con `mp_payment_id` único);
     - el estado `pendiente_pago`;
     - un webhook que verifique la firma `x-signature`, consulte el pago en la API de MP, sea idempotente y compare el monto con `pedidos.total`.
2. **Botón de arrepentimiento.**
   - Disposición 954/2025, que reemplazó a la Res. 424/2020.
   - Tiene que verse en la primera pantalla, funcionar sin registro y entregar un código de gestión en 24 h.
   - Hoy el footer no lo tiene (`src/components/catalog/Footer.tsx`).
3. **Datos del vendedor.**
   - Razón social y CUIT, y Data Fiscal de ARCA (confirmar su vigencia con un contador).
   - Si se muestran cuotas: precio de contado, cantidad y valor de cada cuota, y CFTEA.
   - Si corresponde a la categoría fiscal: "precio sin impuestos nacionales" (Ley 27.743).
4. **Factura electrónica ARCA.**
   - Integrar Facturante, Contabilium o Xubio por API, o WSFE directo.
5. **Descuento por transferencia** (lo típico en el mercado es 10–15 %) y **envío gratis desde $X** visible en la ficha y en el carrito.

### Seguridad
6. **Auth de producción** (`supabase/config.toml`: `minimum_password_length = 6`, `enable_confirmations = false`, TOTP apagado).
   - Revisar el dashboard de producción, que puede diferir de `config.toml`.
   - Configurar: mínimo de 10 caracteres, protección contra contraseñas filtradas y confirmación de email.
   - Activar **TOTP para la admin** y exigir `aal2` en `es_admin()` y `es_staff()`.
7. **Invitar empleadas solo a cuentas con email confirmado.**
   - Hoy `usuario_id_por_email` (`20260928144833_roles_empleados.sql:496-507`) ignora si el email está confirmado.
   - Riesgo: alguien se registra con el email de la futura empleada antes que ella y recibe el rol cuando la admin la invita.

### Rendimiento y SEO
8. **Code splitting.**
   - El JS principal pesa **604 kB (179 kB gzip)**.
   - Solo el panel admin se carga aparte (`src/App.tsx:4-23`).
   - Pasar a `lazy()` Checkout, Mi cuenta, Mis pedidos, Comprobante, legales y la ficha (embla).
   - Separar vendors (react, supabase).
   - Meta: menos de 120 kB gzip para la home.
9. **Imágenes.**
   - Usar el transformador de Supabase (`/render/image/...?width=&format=webp`) con `srcset`/`sizes`.
   - Agregar `preconnect` al dominio de Supabase.
   - Hoy la foto principal de la ficha y las primeras cards bajan el JPEG original de unos 1400 px.
10. **JSON-LD.**
    - En la ficha: `Product` + `Offer` + `AggregateRating` + `BreadcrumbList`. En la home: `Organization`.
    - Inyectarlo también en `api/producto-og.ts`, para que Google lo vea sin ejecutar JS.
11. **Medición de ecommerce.**
    - Eventos GA4 `view_item`, `add_to_cart`, `begin_checkout` y `purchase`.
    - Meta Pixel + Conversions API, con consentimiento.
12. **Monitoreo de errores** (Sentry o similar) en el front y en las Edge Functions.
    - Recargar una vez si falla un chunk después de un deploy.

## Prioridad media

**Datos e inventario**
- **Historial de inventario** (`movimientos_stock`).
  - Hoy, editar `pedidos.items` o borrar un talle con reservas desincroniza el stock sin dejar rastro (`20261004010000_talles.sql:143-164`).
- **Máquina de estados del pedido** y tabla `pedido_eventos`.
  - Hoy se puede pasar de `entregado` a `nuevo`, o cancelar un pedido ya enviado (y eso devuelve stock).
- **Ordenar los ítems por id dentro de `crear_pedido`**, para evitar deadlocks entre carritos con los mismos productos en distinto orden.
- **Cupones:** limitar los usos también por email y teléfono, rate limit en `validar_cupon`, y `on delete restrict` en `cupon_usos`.
- **Stock exacto expuesto:**
  - Los errores dicen "quedan N" y `mas_vendidos` devuelve unidades vendidas.
  - Devolver solo "disponible / pocas unidades".

**Storage y respaldo**
- **Storage:**
  - `file_size_limit` y `allowed_mime_types` en el bucket `productos`.
  - Quitar la política SELECT que permite listar todo el bucket.
- **Backups:**
  - Copia de las fotos de Storage.
  - Una copia fuera de GitHub con retención larga.
  - Prueba mensual de restauración.

**Edge Functions**
- Sumar `deno.json` + `deno.lock`, `deno check` en CI, `verify_jwt` declarado en `config.toml` y un deploy automatizado.
- **Rate limit de `cotizar-envio`:** hoy vive en memoria y confía en el primer valor de `x-forwarded-for`. Pasarlo a una tabla o a Upstash.

**Catálogo público**
- **Realtime en la vista pública:**
  - Hoy cada pedido hace que todas las visitantes conectadas vuelvan a bajar el catálogo.
  - Usar Realtime solo en el admin; en la tienda, refrescar al volver a la pestaña.
- **Ficha de producto:**
  - Cotizador por CP.
  - Política de cambios y devoluciones (clave en ropa de bebé por los talles).
  - Medios de pago y cuotas visibles.

**Accesibilidad**
- El botón principal (blanco sobre `--sage`) tiene contraste **3.04:1** (WCAG pide 4.5:1).
- La home no tiene `<h1>`.
- `ImageZoom` no maneja el foco.
- El CP usa teclado numérico, y el CPA argentino es alfanumérico.

**Checkout**
- Permitir cupones sin cuenta.
- Mostrar los errores en cada campo, con `aria-invalid`.

**Datos personales (Ley 25.326)**
- Política de retención y anonimización de pedidos viejos y de cuentas borradas.
- El recordatorio de carrito abandonado tiene que ser opt-in.

## Prioridad baja
- `search_path = ''` en las funciones `SECURITY DEFINER`.
- Envolver `auth.uid()` y `es_staff()` en `(select …)` dentro de las políticas RLS (rendimiento).
- `unique` en `pedidos.numero`.
- Tabla `pedido_items` en vez de jsonb (facilita reportes, devoluciones y facturación).
- Content-Security-Policy en `vercel.json`.
- Actions de GitHub fijadas por SHA.
- Un secreto propio por función en lugar de la service_role en Vault.
- ESLint (`react-hooks`, `jsx-a11y`) y un test E2E con Playwright del flujo carrito → checkout.
- Fuentes self-hosted.
- Iconos `maskable` en el manifest.
- Borrar `netlify.toml`, `public/_redirects` y `src/assets/logo-index.jpeg`, que no se usan.
- Logo en SVG o WebP: hoy pesa 99 kB para mostrarse a 42 px.
- Variantes de color, producto en borrador, precio de oferta, kits o regalos y gift cards.
- Sincronización con Mercado Libre.
- Corregir `CONTEXTO.md` §10, que todavía dice que el login es obligatorio para comprar.

## Hoja de ruta sugerida

| Etapa | Contenido | Por qué |
|---|---|---|
| 1. Esta semana | C1–C3 (topes, reserva con vencimiento, CAPTCHA), Auth de producción + MFA, invitaciones solo con email confirmado | Riesgos activos en producción |
| 2. Próximas 2–4 semanas | Mercado Pago con cuotas + tabla `pagos`, descuento por transferencia, botón de arrepentimiento y datos fiscales | Conversión y cumplimiento legal |
| 3. Después | Code splitting, imágenes WebP con `srcset`, JSON-LD, GA4 + Meta CAPI, Sentry | Tráfico orgánico, anuncios medibles, Core Web Vitals |
| 4. Más adelante | Factura ARCA, etiquetas de envío, historial de inventario, estados del pedido, promos 3x2, envío gratis desde $X | Operación al nivel de Tiendanube |

## Métricas de referencia
- **Abandono de carrito:** 70,22 % (Baymard, 2025).
- **Conversión en indumentaria:** alrededor de 1,5–2,5 %.
- **Celular:** 80 % de las visitas y más del 65 % de las compras en Tiendanube.
- **Core Web Vitals:** LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1.

## Notas
- Mercado Shops cerró el 31/12/2025.
- Instagram/Facebook Shopping no funciona en Argentina; el catálogo de Meta sigue sirviendo para anuncios.
- Los puntos legales y fiscales (Data Fiscal, precio sin impuestos para monotributo) conviene confirmarlos con un contador.
