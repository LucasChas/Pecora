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
  // Peso (gramos) y medidas del paquete (cm) para cotizar el envío con
  // transportistas. Opcionales: null = sin cargar; undefined = la base todavía
  // no tiene esas columnas (migración de transportistas).
  peso_g?: number | null
  alto_cm?: number | null
  ancho_cm?: number | null
  largo_cm?: number | null
  // Código interno opcional (carga masiva, ver 20260928144838_importar_productos).
  sku?: string | null
  created_at: string
  updated_at: string
}

// Talle de un producto con su stock (tabla producto_talles, migración *_talles).
export interface Talle {
  id: string
  talle: string
  stock: number
  orden: number
}

// Producto ya "aplanado" con el nombre de su categoría resuelto,
// que es lo que consumen las vistas (para filtrar y mostrar).
export interface ProductoConCategoria extends Producto {
  categoria_nombre: string | null
  // Talles (vacío = el producto no se vende por talle). undefined si la base
  // todavía no tiene la tabla.
  talles?: Talle[]
}

// ---- Cuentas de clientas (ver migración 0005) ----
// 'empleado' = staff del panel sin acceso a ajustes, estadísticas ni equipo.
export type Rol = 'cliente' | 'empleado' | 'admin'

export interface Perfil {
  id: string
  nombre: string | null
  telefono: string | null
  rol: Rol
  created_at: string
  // Quiere recibir mails de novedades (migración *_mi_cuenta). false si la
  // base todavía no tiene la columna.
  acepta_novedades?: boolean
  // Recordatorio por mail del carrito abandonado (migración *_avisos_tienda).
  // true por defecto.
  recordar_carrito?: boolean
}

// ---- Pedidos (ver migraciones 0003 / 0005) ----
// 'enviado' = despachado por correo, todavía no entregado (migración 20261001030000).
export type EstadoPedido = 'nuevo' | 'confirmado' | 'enviado' | 'entregado' | 'cancelado'

export type OrigenPedido = 'checkout' | 'admin'

export type EntregaPedido = 'envio' | 'coordinar'

export interface PedidoItem {
  id: string
  nombre: string
  precio: number
  cantidad: number
  // Producto con talles (migración *_talles): el nombre ya incluye el talle.
  talle_id?: string
  talle?: string
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

  // ---- Pago y seguimiento (migración 20261001030000_pedido_enviado_pagado) ----
  // Opcionales por el mismo motivo. pagado_at null = todavía no pagado.
  pagado_at?: string | null
  seguimiento?: string | null

  // ---- Cupón y zona de envío (migración de cupones / envíos) ----
  // Opcionales por el mismo motivo: la base los completa en crear_pedido.
  cupon_id?: string | null
  cupon_codigo?: string | null
  zona_id?: string | null
  zona_nombre?: string | null

  // ---- Envío con transportista (migración de transportistas) ----
  // null si el envío se cobró por zona o se coordina. Para mostrarlo usar
  // etiquetaEnvioPedido() (lib/transportistas).
  transportista?: Transportista | null
  servicio_envio?: ServicioEnvio | null
  // Sucursal de destino (solo servicio 'sucursal'), como la guardó la base.
  sucursal_envio?: string | null
  cotizacion_envio_id?: string | null
}

// ---- Envíos con transportistas (Edge Function cotizar-envio) ----
export type Transportista = 'andreani' | 'correo_argentino'

export type ServicioEnvio = 'domicilio' | 'sucursal'

export interface SucursalEnvio {
  id: string
  nombre: string
  direccion: string
}

// ---- Cupones de descuento (migración de cupones / envíos) ----
export type TipoCupon = 'porcentaje' | 'monto' | 'envio_gratis'

export interface Cupon {
  id: string
  // Siempre en mayúsculas (la base lo normaliza y es único).
  codigo: string
  descripcion: string | null
  tipo: TipoCupon
  // Porcentaje (1-100) o monto fijo en pesos; 0 para envío gratis.
  valor: number
  // Sobre el subtotal antes del descuento. 0 = sin mínimo.
  minimo_compra: number
  // Vigencia (timestamptz). null = sin límite.
  desde: string | null
  hasta: string | null
  // Usos totales permitidos. null = ilimitado.
  usos_max: number | null
  usos_por_cliente: number | null
  solo_primera_compra: boolean
  activo: boolean
  // Se muestra en "Mi cuenta" de las clientas (migración *_cupones_visibles).
  visible_en_cuenta?: boolean
  created_at: string
}

// ---- Zonas de envío (migración de cupones / envíos) ----
export interface ZonaEnvio {
  id: string
  nombre: string
  provincias: string[]
  // Prefijos de código postal (ej. "50", "5152").
  cp_prefijos: string[]
  precio: number
  // Subtotal desde el que el envío es gratis. null = nunca.
  gratis_desde: number | null
  activo: boolean
  orden: number
}

// ---- Carga masiva de productos (RPC importar_productos) ----
// Una fila del CSV ya normalizada, tal como la recibe la RPC.
export interface FilaImportacion {
  sku: string
  nombre: string
  descripcion?: string | null
  precio: number
  stock: number
  // Nombre de la categoría (la base la resuelve por nombre).
  categoria: string
  imagen_url?: string | null
}

export interface ErrorFilaImportacion {
  // Número de fila del archivo (1 = encabezado, los datos arrancan en 2).
  fila: number
  mensaje: string
}

export interface ResultadoImportacion {
  nuevos: number
  actualizados: number
  errores: ErrorFilaImportacion[]
}

// ---- Equipo del panel (Edge Function gestionar-equipo) ----
export interface MiembroEquipo {
  id: string
  email: string
  nombre: string | null
  rol: Rol
  ultimo_ingreso: string | null
}

// ---- Reseñas de compradoras verificadas (migración *_resenas.sql) ----
// Nunca traen el email ni el id de la cuenta: solo el primer nombre.
export interface Resena {
  id: string
  // 1 a 5.
  estrellas: number
  comentario: string | null
  nombre_corto: string
  created_at: string
  updated_at: string
  // true si es la de quien está mirando (para ofrecerle editarla).
  es_mia: boolean
}

// La reseña propia de un producto (aunque la admin la haya ocultado).
export interface MiResena {
  id: string
  estrellas: number
  comentario: string | null
  oculta: boolean
  created_at: string
  updated_at: string
}

export interface ResumenResenas {
  // null si no hay reseñas visibles.
  promedio: number | null
  cantidad: number
}

// Fila de la lista de moderación del panel (solo admin).
export interface ResenaModeracion {
  id: string
  producto_id: string
  producto_nombre: string
  producto_slug: string | null
  estrellas: number
  comentario: string | null
  nombre_corto: string
  oculta: boolean
  created_at: string
}
