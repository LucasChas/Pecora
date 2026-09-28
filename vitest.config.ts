import { defineConfig } from 'vitest/config'

// Tests unitarios de lógica pura (sin DOM ni React): corren en Node.
// Si existe este archivo, Vitest lo usa en lugar de vite.config.ts.
// Incluye la lógica pura de las Edge Functions (sin imports remotos de Deno)
// y el handler de la Vercel Function de api/ (con dependencias inyectadas).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts', 'api/**/*.test.ts'],
  },
})
