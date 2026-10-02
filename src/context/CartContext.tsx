import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ProductoConCategoria } from '../types'
import { portadaDe } from '../lib/images'
import { useAuth } from './AuthContext'
import {
  aGuardar,
  firma,
  guardarCarritoRemoto,
  leerCarritoRemoto,
  rearmarCarrito,
} from '../lib/carritoRemoto'
import { cargarProductosPorId } from '../lib/pedidoCliente'

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
  // Slug del producto al momento de agregarlo (ver migración 0011), para armar
  // el link a /producto/:param. Puede venir null/undefined en carritos viejos
  // guardados en localStorage antes de este cambio; el link cae al id.
  slug?: string | null
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

  // Persistimos el carrito en localStorage ante cualquier cambio. Puede fallar
  // (modo privado, sin espacio): el carrito sigue andando en memoria.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      /* sin persistencia */
    }
  }, [items])

  // Con la tienda abierta en dos pestañas, lo que se agrega en una aparece en
  // la otra (antes la última en escribir pisaba a la otra).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setItems(leerStorage())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Carrito en la cuenta (ver lib/carritoRemoto.ts). Al entrar: si este
  // dispositivo no tiene nada y la cuenta sí, se recupera; si no, manda lo
  // local. Después, cada cambio se guarda (con una pausa, para no escribir con
  // cada toque de +/−).
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const sincronizadoRef = useRef<string | null>(null)
  const ultimaFirmaRef = useRef<string | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (!userId) {
      sincronizadoRef.current = null
      ultimaFirmaRef.current = null
      return
    }
    if (sincronizadoRef.current === userId) return
    let vigente = true
    ;(async () => {
      const remoto = await leerCarritoRemoto(userId)
      if (!vigente) return
      if (remoto && remoto.length > 0 && itemsRef.current.length === 0) {
        const productos = await cargarProductosPorId(remoto.map((r) => r.id))
        if (!vigente) return
        const rearmado = rearmarCarrito(remoto, productos)
        // Si mientras tanto agregó algo, no se pisa.
        if (rearmado.length > 0 && itemsRef.current.length === 0) setItems(rearmado)
        ultimaFirmaRef.current = firma(remoto)
      } else if (remoto) {
        ultimaFirmaRef.current = firma(remoto)
        // Lo de este dispositivo pasa a la cuenta.
        const local = aGuardar(itemsRef.current)
        if (local.length > 0 && firma(local) !== ultimaFirmaRef.current) {
          ultimaFirmaRef.current = firma(local)
          void guardarCarritoRemoto(userId, local)
        }
      }
      sincronizadoRef.current = userId
    })()
    return () => {
      vigente = false
    }
  }, [userId])

  useEffect(() => {
    if (!userId || sincronizadoRef.current !== userId) return
    const guardar = aGuardar(items)
    const f = firma(guardar)
    if (f === ultimaFirmaRef.current) return
    const t = window.setTimeout(() => {
      ultimaFirmaRef.current = f
      void guardarCarritoRemoto(userId, guardar)
    }, 1500)
    return () => window.clearTimeout(t)
  }, [items, userId])

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
          slug: producto.slug,
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

  // Estables entre renders: el carrito lateral las usa en efectos y, si
  // cambiaran con cada render, le robarían el foco a la clienta al tocar +/−.
  const abrirDrawer = useCallback(() => setDrawerAbierto(true), [])
  const cerrarDrawer = useCallback(() => setDrawerAbierto(false), [])

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
    abrirDrawer,
    cerrarDrawer,
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

// Hook para consumir el carrito desde cualquier componente.
export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart debe usarse dentro de <CartProvider>')
  return ctx
}
