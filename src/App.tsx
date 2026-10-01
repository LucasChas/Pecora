import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import CatalogPage from './pages/CatalogPage'
import ProductPage from './pages/ProductPage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import AccountPage from './pages/AccountPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import MyOrdersPage from './pages/MyOrdersPage'
import CartDrawer from './components/cart/CartDrawer'
import Footer from './components/catalog/Footer'
import ScrollManager from './components/ScrollManager'
import { PrivacyPage } from './pages/PrivacyPage'
import { TermsPage } from './pages/TermsPage'
import BajaAvisoPage from './pages/BajaAvisoPage'
import NotFoundPage from './pages/NotFoundPage'

// El panel se descarga aparte, solo cuando se abre: antes el muestrario
// público bajaba todo el panel (y sus dependencias) en el mismo archivo.
const AdminPage = lazy(() => import('./pages/AdminPage'))

function Panel() {
  return (
    <Suspense fallback={<div className="loading-state">Cargando el panel…</div>}>
      <AdminPage />
    </Suspense>
  )
}
// El "modo" define qué expone cada deploy (ver VITE_APP_MODE en .env):
//   - 'admin'   -> deploy privado: SOLO el panel, servido en la raíz "/".
//   - 'catalog' -> deploy público: muestrario + páginas de producto. /admin no existe.
//   - sin definir (desarrollo local) -> todas las rutas.
//
// Con esto podés crear dos proyectos de Vercel desde el MISMO repo, cada uno
// con su dominio y su variable, sin que el admin sea accesible desde la web pública.
const mode = import.meta.env.VITE_APP_MODE

// Layout del catálogo: monta el carrito lateral (drawer) una sola vez, disponible
// en todas las vistas públicas (muestrario, producto, carrito, checkout).
// `.shop` es la raíz de la tienda pública: define los tokens de ancho
// (--shop-max / --shop-gutter) y es una columna flex de alto mínimo 100dvh
// para que el footer quede abajo incluso en páginas cortas.
function CatalogLayout() {
  return (
    <div className="shop">
      <ScrollManager />
      <Outlet />
      <Footer />
      <CartDrawer />
    </div>
  )
}

// Rutas públicas del catálogo (se reusan en modo 'catalog' y en local).
function RutasCatalogo() {
  return (
    <Route element={<CatalogLayout />}>
      <Route path="/" element={<CatalogPage />} />
      <Route path="/producto/:param" element={<ProductPage />} />
      <Route path="/carrito" element={<CartPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/cuenta" element={<AccountPage />} />
      <Route path="/restablecer-contrasena" element={<ResetPasswordPage />} />
      <Route path="/mis-pedidos" element={<MyOrdersPage />} />
      <Route path="/privacidad" element={<PrivacyPage />} />
      <Route path="/terminos" element={<TermsPage />} />
      <Route path="/aviso/baja" element={<BajaAvisoPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  )
}

export default function App() {
  if (mode === 'admin') {
    // Deploy privado: el panel vive en la raíz; cualquier otra ruta redirige ahí.
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Panel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (mode === 'catalog') {
    // Deploy público: muestrario + detalle + carrito/checkout. No se registra /admin.
    return (
      <BrowserRouter>
        <Routes>{RutasCatalogo()}</Routes>
      </BrowserRouter>
    )
  }

  // Desarrollo local: todas las vistas disponibles.
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<Panel />} />
        {RutasCatalogo()}
      </Routes>
    </BrowserRouter>
  )
}
