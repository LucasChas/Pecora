import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { Perfil } from '../types'

interface AuthContextValue {
  session: Session | null
  perfil: Perfil | null
  loading: boolean
  esAdmin: boolean
  registrar: (datos: {
    email: string
    password: string
    nombre: string
    telefono: string
  }) => Promise<{ error: string | null; necesitaConfirmar: boolean }>
  ingresar: (email: string, password: string) => Promise<{ error: string | null }>
  salir: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Provee la sesión y el perfil (con rol) a toda la app. Lo usan tanto el
// muestrario (clientas) como el panel (admin) para saber quién está logueado.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [loading, setLoading] = useState(true)

  // Trae el perfil (rol, nombre) del usuario logueado.
  //
  // Las cuentas creadas antes del trigger handle_new_user no tienen fila en
  // profiles (o la tienen sin nombre/teléfono). Para que la app no se quede sin
  // datos, completamos con el metadata que guardó Supabase Auth al registrarse.
  const cargarPerfil = useCallback(async (usuario: User | undefined) => {
    if (!usuario) {
      setPerfil(null)
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', usuario.id)
      .maybeSingle()

    const meta = usuario.user_metadata ?? {}
    const fila = data as Perfil | null
    setPerfil({
      id: usuario.id,
      nombre: fila?.nombre || (meta.nombre as string) || null,
      telefono: fila?.telefono || (meta.telefono as string) || null,
      rol: fila?.rol ?? 'cliente',
      created_at: fila?.created_at ?? '',
    })
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await cargarPerfil(data.session?.user)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_e, nueva) => {
      setSession(nueva)
      cargarPerfil(nueva?.user)
    })
    return () => sub.subscription.unsubscribe()
  }, [cargarPerfil])

  const registrar: AuthContextValue['registrar'] = useCallback(async (datos) => {
    const { data, error } = await supabase.auth.signUp({
      email: datos.email,
      password: datos.password,
      // Estos datos los toma el trigger handle_new_user para armar el perfil.
      options: { data: { nombre: datos.nombre, telefono: datos.telefono } },
    })
    if (error) return { error: error.message, necesitaConfirmar: false }
    // Si no hay sesión tras el signup, es porque falta confirmar el email.
    const necesitaConfirmar = !data.session
    return { error: null, necesitaConfirmar }
  }, [])

  const ingresar: AuthContextValue['ingresar'] = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? 'Email o contraseña incorrectos.' : null }
  }, [])

  const salir = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value: AuthContextValue = {
    session,
    perfil,
    loading,
    esAdmin: perfil?.rol === 'admin',
    registrar,
    ingresar,
    salir,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
