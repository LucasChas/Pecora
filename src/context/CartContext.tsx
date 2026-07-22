import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ProductoConCategoria } from '../types'
import { portadaDe } from '../lib/images'

// Un ítem del carrito guarda una "foto" de los datos del producto al momento de
// agregarlo (así el carrito no se rompe si el producto cambia). El precio y el
// stock se revalidan más adelante, en el checkout.
export interface CartItem {
  id: string
  nombre: string
  precio: number
  imagen: string
  stock: number
  cantidad: number
}

interface CartContextValue {
  items: CartItem[]
  cantidadTotal: number
  subtotal: number
  agregar: (producto: ProductoConCategoria, cantidad?: number) => void
  setCantidad: (id: string, cantidad: number) => void
  quitar: (id: string) => void
  vaciar: () => void
  // Reemplaza el contenido completo (lo usa el checkout al revalidar contra la base).
  reemplazar: (items: CartItem[]) => void
  // Estado del carrito lateral (drawer).
  drawerAbierto: boolean
  abrirDrawer: () => void
  cerrarDrawer: () => void
}

const CartContext = createContext<CartContextValue | null>(null)
const STORAGE_KEY = 'pecora_cart_v1'

function leerStorage(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CartItem[]) : []
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(leerStorage)
  const [drawerAbierto, setDrawerAbierto] = useState(false)

  // Persistimos el carrito en localStorage ante cualquier cambio.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  const agregar = useCallback((producto: ProductoConCategoria, cantidad = 1) => {
    setItems((prev) => {
      const existente = prev.find((i) => i.id === producto.id)
      const tope = producto.stock // no dejamos superar el stock conocido
      if (existente) {
        return prev.map((i) =>
          i.id === producto.id
            ? { ...i, cantidad: Math.min(i.cantidad + cantidad, tope) }
            : i,
        )
      }
      return [
        ...prev,
        {
          id: producto.id,
          nombre: producto.nombre,
          precio: producto.precio,
          imagen: portadaDe(producto),
          stock: producto.stock,
          cantidad: Math.min(cantidad, tope),
        },
      ]
    })
    // Feedback inmediato: abrimos el carrito lateral al agregar.
    setDrawerAbierto(true)
  }, [])

  const setCantidad = useCallback((id: string, cantidad: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, cantidad: Math.max(1, Math.min(cantidad, i.stock)) } : i,
      ),
    )
  }, [])

  const quitar = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const vaciar = useCallback(() => setItems([]), [])

  const reemplazar = useCallback((nuevos: CartItem[]) => setItems(nuevos), [])

  const cantidadTotal = useMemo(() => items.reduce((n, i) => n + i.cantidad, 0), [items])
  const subtotal = useMemo(
    () => items.reduce((n, i) => n + i.precio * i.cantidad, 0),
    [items],
  )

  const value: CartContextValue = {
    items,
    cantidadTotal,
    subtotal,
    agregar,
    setCantidad,
    quitar,
    vaciar,
    reemplazar,
    drawerAbierto,
    abrirDrawer: () => setDrawerAbierto(true),
    cerrarDrawer: () => setDrawerAbierto(false),
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

// Hook para consumir el carrito desde cualquier componente.
export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart debe usarse dentro de <CartProvider>')
  return ctx
}
