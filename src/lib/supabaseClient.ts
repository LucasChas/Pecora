import { createClient } from '@supabase/supabase-js'

// Cliente único de Supabase para toda la app.
// Las claves vienen de variables de entorno (ver .env.example).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Falla temprano y con un mensaje claro si falta configurar el .env.
  throw new Error(
    'Faltan las variables VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. ' +
      'Copiá .env.example a .env y completalas.',
  )
}

// ---------------------------------------------------------------------------
// Sesiones separadas: panel vs muestrario.
//
// El panel y el muestrario son dos "aplicaciones" distintas aunque compartan el
// código. Si usaran la misma clave de sesión, entrar como clienta en el
// muestrario pisaría la sesión de la administradora (y al revés): cerrar sesión
// en un lado dejaría al otro afuera.
//
// Guardando la sesión bajo claves distintas, cada vista mantiene su propio
// login de forma independiente. En producción son dos deploys con dominios
// distintos (VITE_APP_MODE), y en desarrollo local se distingue por la ruta.
// ---------------------------------------------------------------------------
const modo = import.meta.env.VITE_APP_MODE
const esPanel =
  modo === 'admin' ||
  (!modo && typeof window !== 'undefined' && window.location.pathname.startsWith('/admin'))

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: esPanel ? 'pecora-auth-panel' : 'pecora-auth-muestrario',
  },
})
