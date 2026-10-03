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
//   buscadores no indexen el login del panel, y la barra de estado del
//   celular toma el color oscuro de la barra superior del panel.
function metaDelSitio(env: Record<string, string>): Plugin {
  const sitio = urlDelSitio(env.VITE_CATALOG_URL)
  const esPanel = env.VITE_APP_MODE === 'admin'
  return {
    name: 'pecora-meta-del-sitio',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return {
          html: (esPanel
            ? html.replace(/(<meta name="theme-color" content=")[^"]*"/, '$1#3B2F22"')
            : html
          ).replace(/__SITE_URL__/g, sitio),
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

// robots.txt del deploy: el muestrario se puede indexar completo y apunta al
// sitemap (api/sitemap.ts). El panel sirve el mismo archivo sin sitemap: sus
// páginas llevan noindex y no se las bloquea acá a propósito (si el buscador
// no puede leer la página, tampoco ve el noindex).
function robotsDelSitio(env: Record<string, string>): Plugin {
  const sitio = urlDelSitio(env.VITE_CATALOG_URL)
  const esPanel = env.VITE_APP_MODE === 'admin'
  const lineas = ['User-agent: *', 'Allow: /']
  if (!esPanel) lineas.push('', `Sitemap: ${sitio}/sitemap.xml`)
  return {
    name: 'pecora-robots',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${lineas.join('\n')}\n` })
    },
  }
}

// Configuración de Vite para React + las meta del sitio.
export default defineConfig(({ mode }) => {
  // Las variables del entorno (Vercel, o la línea de comandos) pisan al .env.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), metaDelSitio(env), robotsDelSitio(env)],
  }
})
