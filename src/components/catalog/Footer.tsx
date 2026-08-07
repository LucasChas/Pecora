import { instagramHabilitado, instagramPerfilLink, waPerfilLink } from '../../lib/config'

// Footer institucional del catálogo público: se monta una sola vez en
// CatalogLayout (App.tsx), así aparece en todas las vistas públicas
// (muestrario, producto, carrito, checkout, cuenta, mis pedidos).
// Alcance (D12): redes sociales, logos de medios de pago, copyright.
// Explícitamente fuera de alcance: envíos, devoluciones, contacto extendido.
export default function Footer() {
  const anio = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-social">
          <a
            className="site-footer-link"
            href={waPerfilLink()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2 22l5.42-1.35a9.86 9.86 0 0 0 4.62 1.15h.01c5.46 0 9.9-4.45 9.9-9.9C21.96 6.45 17.5 2 12.04 2Zm0 18.03h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.78.83-3.03-.2-.31a8.13 8.13 0 0 1-1.26-4.33c0-4.5 3.66-8.16 8.17-8.16a8.1 8.1 0 0 1 5.78 2.39 8.1 8.1 0 0 1 2.39 5.77c0 4.5-3.67 8.22-8.11 8.22Z" />
            </svg>
            WhatsApp
          </a>
          {instagramHabilitado && (
            <a
              className="site-footer-link"
              href={instagramPerfilLink()}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="2" y="2" width="20" height="20" rx="5.5" />
                <circle cx="12" cy="12" r="4.2" />
                <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
              </svg>
              Instagram
            </a>
          )}
        </div>

        {/* TODO(owner-assets): reemplazar por los logos reales de Abril y
            Mercado Pago (SVG/PNG provistos por el dueño). Placeholder de texto
            hasta entonces. */}

        {/* TODO(owner-copy): reemplazar por la copy institucional definitiva. */}
        <p className="site-footer-copy">© {anio} Pecora — Accesorios de bebé</p>
      </div>
    </footer>
  )
}
