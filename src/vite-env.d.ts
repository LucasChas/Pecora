/// <reference types="vite/client" />

// Tipado de las variables de entorno que usa la app (autocompletado + chequeo).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_WHATSAPP_NUMBER: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Permite importar imágenes como assets (URL string).
declare module '*.svg' {
  const src: string
  export default src
}
