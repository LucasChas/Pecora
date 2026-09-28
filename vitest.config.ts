import { defineConfig } from 'vitest/config'

// Tests unitarios de lógica pura (sin DOM ni React): corren en Node.
// Si existe este archivo, Vitest lo usa en lugar de vite.config.ts.
// Incluye la lógica pura de las Edge Functions (sin imports remotos de Deno)
// y el handler de la Vercel Function de api/ (con dependencias inyectadas).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts', 'api/**/*.test.ts'],
    // Valores ficticios: algunos módulos testeados importan supabaseClient, que
    // falla al cargar si faltan estas variables (en CI no hay .env). Los tests
    // nunca llaman a Supabase de verdad, así que tampoco usan el .env local.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:1',
      VITE_SUPABASE_ANON_KEY: 'clave-de-prueba',
    },
  },
})
