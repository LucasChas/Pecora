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
  // Slug único generado por la base (ver migración 0011). Puede venir null
  // hasta que esa migración corra en el ambiente.
  slug: string | null
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

// ---- Cuentas de clientas (ver migración 0005) ----
export interface Perfil {
  id: string
  nombre: string | null
  telefono: string | null
  rol: 'cliente' | 'admin'
  created_at: string
}

// ---- Pedidos (ver migraciones 0003 / 0005) ----
export type EstadoPedido = 'nuevo' | 'confirmado' | 'entregado' | 'cancelado'

export type OrigenPedido = 'checkout' | 'admin'

export type EntregaPedido = 'envio' | 'coordinar'

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
  entrega: EntregaPedido
  direccion: string | null
  localidad: string | null
  cp: string | null
  notas: string | null
  items: PedidoItem[]
  subtotal: number
  estado: EstadoPedido
  origen: OrigenPedido
  // Cuenta de la clienta (migración 0005). Opcional en el tipo: no todos los
  // lugares que arman un Pedido lo completan.
  user_id?: string | null
  created_at: string
  // Papelera: si tiene fecha, la admin lo mandó a la papelera (ver migración 0009).
  eliminado_at: string | null

  // ---- Totales, provincia e idempotencia (migración de totales del pedido) ----
  // Opcionales: el frontend puede llegar a producción antes que la migración, y
  // en ese caso las filas no traen estas columnas. Para leer los montos usar
  // totalesDe() (lib/orders), que completa lo que falte.
  descuento?: number | null
  costo_envio?: number | null
  // Columna generada en la base: subtotal - descuento + costo_envio.
  total?: number | null
  provincia?: string | null
  idempotency_key?: string | null
  email_enviado_at?: string | null
  aviso_duena_enviado_at?: string | null
}
