/// <reference types="vite/client" />

// Tipado de las variables de entorno que usa la app (autocompletado + chequeo).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_WHATSAPP_NUMBER: string
  // Usuario de Instagram (sin @). Opcional: si falta, no se muestra el botón.
  readonly VITE_INSTAGRAM_USER?: string
  // URL pública del muestrario (se imprime en la lista de precios exportable).
  // Opcional: si falta, se usa https://pecora-muestrario.vercel.app.
  readonly VITE_CATALOG_URL?: string
  // Dirección del remitente que se imprime en la nota de entrega y la etiqueta
  // de envío. Opcional: si falta, esos documentos muestran "—".
  readonly VITE_REMITENTE_DIRECCION?: string
  // 'catalog' | 'admin' | undefined. Define qué vista expone el deploy.
  readonly VITE_APP_MODE?: 'catalog' | 'admin'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Permite importar imágenes como assets (URL string).
declare module '*.svg' {
  const src: string
  export default src
}
