import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

// Expone la sesión actual de Supabase Auth (la administradora logueada).
// `loading` evita el parpadeo login/contenido mientras se resuelve la sesión.
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Sesión inicial (si ya había login guardado).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    // Se actualiza al iniciar o cerrar sesión.
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSession(nuevaSesion)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  return { session, loading }
}
