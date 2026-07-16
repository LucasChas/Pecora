// Tipos que reflejan las tablas de Supabase (ver supabase/migrations/0001_init.sql).

export interface Categoria {
  id: string
  nombre: string
  created_at: string
}

export interface Producto {
  id: string
  nombre: string
  categoria_id: string | null
  descripcion: string | null
  precio: number
  stock: number
  imagen_url: string | null
  // Galería de imágenes (columna "imagenes text[]", ver migración 0002).
  // Puede venir undefined si todavía no corriste esa migración.
  imagenes?: string[] | null
  created_at: string
  updated_at: string
}

// Producto ya "aplanado" con el nombre de su categoría resuelto,
// que es lo que consumen las vistas (para filtrar y mostrar).
export interface ProductoConCategoria extends Producto {
  categoria_nombre: string | null
}

// ---- Pedidos (checkout como invitada, ver migración 0003) ----
export type EstadoPedido = 'nuevo' | 'confirmado' | 'entregado' | 'cancelado'

export interface PedidoItem {
  id: string
  nombre: string
  precio: number
  cantidad: number
}

export interface Pedido {
  id: string
  numero: number
  nombre: string
  telefono: string
  email: string | null
  entrega: 'envio' | 'coordinar'
  direccion: string | null
  localidad: string | null
  cp: string | null
  notas: string | null
  items: PedidoItem[]
  subtotal: number
  estado: EstadoPedido
  created_at: string
}
