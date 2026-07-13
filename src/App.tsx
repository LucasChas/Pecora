import { BrowserRouter, Routes, Route } from 'react-router-dom'
import CatalogPage from './pages/CatalogPage'
import AdminPage from './pages/AdminPage'

// Dos rutas separadas:
//   /       -> catálogo público (vista cliente)
//   /admin  -> panel de administración (protegido por login)
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  )
}
