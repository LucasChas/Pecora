import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { agregarFavorito, cargarFavoritos, quitarFavorito } from '../lib/favoritos'

interface FavoritosContextValue {
  // null = sin sesión o la función no está disponible (no se muestra el corazón).
  ids: Set<string> | null
  esFavorito: (productoId: string) => boolean
  // Devuelve false si no se pudo guardar (se vuelve atrás el cambio).
  alternar: (productoId: string) => Promise<boolean>
}

const FavoritosContext = createContext<FavoritosContextValue | null>(null)

// Favoritos de la cuenta logueada, compartidos por las cards, la ficha y Mi
// cuenta. El corazón cambia al instante y, si la base falla, vuelve atrás.
export function FavoritosProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const uid = session?.user.id ?? null
  const [ids, setIds] = useState<Set<string> | null>(null)
  const [disponible, setDisponible] = useState(true)

  useEffect(() => {
    if (!uid) {
      setIds(null)
      return
    }
    let vigente = true
    void cargarFavoritos().then((lista) => {
      if (!vigente) return
      if (lista === null) {
        setDisponible(false)
        setIds(null)
      } else {
        setDisponible(true)
        setIds(new Set(lista))
      }
    })
    return () => {
      vigente = false
    }
  }, [uid])

  const esFavorito = useCallback((productoId: string) => ids?.has(productoId) ?? false, [ids])

  const alternar = useCallback(
    async (productoId: string) => {
      if (!ids) return false
      const estaba = ids.has(productoId)
      const cambiar = (agregar: boolean) =>
        setIds((prev) => {
          const nuevo = new Set(prev ?? [])
          if (agregar) nuevo.add(productoId)
          else nuevo.delete(productoId)
          return nuevo
        })
      cambiar(!estaba)
      const ok = estaba ? await quitarFavorito(productoId) : await agregarFavorito(productoId)
      if (!ok) cambiar(estaba)
      return ok
    },
    [ids],
  )

  const value = useMemo<FavoritosContextValue>(
    () => ({ ids: disponible ? ids : null, esFavorito, alternar }),
    [ids, disponible, esFavorito, alternar],
  )
  return <FavoritosContext.Provider value={value}>{children}</FavoritosContext.Provider>
}

export function useFavoritos(): FavoritosContextValue {
  const ctx = useContext(FavoritosContext)
  if (!ctx) throw new Error('useFavoritos debe usarse dentro de <FavoritosProvider>')
  return ctx
}
