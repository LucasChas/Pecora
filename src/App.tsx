import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import CatalogPage from './pages/CatalogPage'
import AdminPage from './pages/AdminPage'

// El "modo" define qué expone cada deploy (ver VITE_APP_MODE en .env):
//   - 'admin'   -> deploy privado: SOLO el panel, servido en la raíz "/".
//   - 'catalog' -> deploy público: SOLO el muestrario. /admin no existe.
//   - sin definir (desarrollo local) -> ambas rutas: "/" y "/admin".
//
// Con esto podés crear dos proyectos de Vercel desde el MISMO repo, cada uno
// con su dominio y su variable, sin que el admin sea accesible desde la web pública.
const mode = import.meta.env.VITE_APP_MODE

export default function App() {
  if (mode === 'admin') {
    // Deploy privado: el panel vive en la raíz; cualquier otra ruta redirige ahí.
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (mode === 'catalog') {
    // Deploy público: solo el muestrario. No se registra la ruta /admin.
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<CatalogPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  // Desarrollo local: las dos vistas disponibles.
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  )
}
