import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Dominio de producción del muestrario: se usa si falta VITE_CATALOG_URL o no
// es una URL válida (mismo valor por defecto que src/lib/config.ts).
const SITIO_POR_DEFECTO = 'https://pecora-muestrario.vercel.app'

// URL absoluta y sin barra final. Solo se aceptan http(s) sin comillas ni
// espacios, porque va dentro de atributos del HTML.
function urlDelSitio(valor: string | undefined): string {
  const limpio = (valor ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[^\s"'<>]+$/i.test(limpio) ? limpio : SITIO_POR_DEFECTO
}

// Completa las meta de index.html que dependen del deploy:
// - __SITE_URL__ -> URL pública del muestrario. og:url y og:image tienen que
//   ser absolutas para que WhatsApp, Instagram, etc. muestren la vista previa.
// - Deploy del panel (VITE_APP_MODE=admin): agrega noindex para que los
//   buscadores no indexen el login del panel.
function metaDelSitio(env: Record<string, string>): Plugin {
  const sitio = urlDelSitio(env.VITE_CATALOG_URL)
  const esPanel = env.VITE_APP_MODE === 'admin'
  return {
    name: 'pecora-meta-del-sitio',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return {
          html: html.replace(/__SITE_URL__/g, sitio),
          tags: esPanel
            ? [
                {
                  tag: 'meta',
                  attrs: { name: 'robots', content: 'noindex, nofollow' },
                  injectTo: 'head-prepend',
                },
              ]
            : [],
        }
      },
    },
  }
}

// Configuración de Vite para React + las meta del sitio.
export default defineConfig(({ mode }) => {
  // Las variables del entorno (Vercel, o la línea de comandos) pisan al .env.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), metaDelSitio(env)],
  }
})
