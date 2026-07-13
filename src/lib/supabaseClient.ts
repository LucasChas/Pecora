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

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
