import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { Perfil } from '../types'
import { esSinConfirmar, traducirErrorAuth } from '../lib/authErrores'
import { borrarBorrador } from '../lib/borradorCheckout'

interface AuthContextValue {
  session: Session | null
  perfil: Perfil | null
  loading: boolean
  esAdmin: boolean
  // `volverA`: ruta de la app a la que vuelve después de confirmar el email
  // (ej. /checkout), para no perder la compra en el camino.
  registrar: (
    datos: {
      email: string
      password: string
      nombre: string
      telefono: string
    },
    volverA?: string,
  ) => Promise<{ error: string | null; necesitaConfirmar: boolean; yaRegistrado: boolean }>
  ingresar: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; sinConfirmar: boolean }>
  reenviarConfirmacion: (email: string, volverA?: string) => Promise<{ error: string | null }>
  recuperarPassword: (email: string) => Promise<{ error: string | null }>
  actualizarPassword: (password: string) => Promise<{ error: string | null }>
  // Vuelve a leer el perfil (después de editarlo en Mi cuenta).
  recargarPerfil: () => Promise<void>
  salir: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// URL a la que lleva el link del mail de confirmación: /cuenta con el destino
// en `next`; AccountPage ve la sesión nueva y redirige. Tiene que estar en
// Supabase → Authentication → URL Configuration → Redirect URLs; si no, Supabase
// usa la Site URL (la clienta queda logueada en el inicio, como antes).
function urlConfirmacion(volverA?: string): string {
  const destino = volverA && volverA.startsWith('/') ? volverA : '/'
  return `${window.location.origin}/cuenta?next=${encodeURIComponent(destino)}`
}

// Espera antes del único reintento cuando la lectura del perfil falla.
const ESPERA_REINTENTO_PERFIL_MS = 1500

type LecturaPerfil = { ok: true; fila: Perfil | null } | { ok: false; error: unknown }

// Lee la fila de profiles. Distingue "no hay fila" (ok con fila null) de un
// fallo del backend o de la red (ok: false), que NO dice nada sobre el rol.
async function leerPerfil(id: string): Promise<LecturaPerfil> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) return { ok: false, error }
    return { ok: true, fila: data as Perfil | null }
  } catch (e) {
    return { ok: false, error: e }
  }
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Provee la sesión y el perfil (con rol) a toda la app. Lo usan tanto el
// muestrario (clientas) como el panel (admin) para saber quién está logueado.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [loading, setLoading] = useState(true)
  // Cuenta cuyo perfil se pidió por última vez (null = sin sesión).
  const usuarioDelPerfilRef = useRef<string | null>(null)

  // Trae el perfil (rol, nombre) del usuario logueado.
  //
  // Las cuentas creadas antes del trigger handle_new_user no tienen fila en
  // profiles (o la tienen sin nombre/teléfono). Para que la app no se quede sin
  // datos, completamos con el metadata que guardó Supabase Auth al registrarse.
  //
  // Solo "sin fila" significa rol 'cliente'. Si la lectura FALLA (backend o
  // red), se reintenta una vez y, si vuelve a fallar, se conserva el perfil que
  // ya estaba cargado para esa cuenta: un corte momentáneo (ej. al refrescarse
  // el token) no le quita el panel a una admin.
  const cargarPerfil = useCallback(async (usuario: User | undefined) => {
    if (!usuario) {
      usuarioDelPerfilRef.current = null
      setPerfil(null)
      return
    }
    usuarioDelPerfilRef.current = usuario.id
    // El perfil de OTRA cuenta no queda a la vista mientras se lee el nuevo.
    setPerfil((previo) => (previo && previo.id !== usuario.id ? null : previo))
    // Si mientras tanto se cerró la sesión o entró otra cuenta, esta lectura
    // ya no corresponde y no toca el estado.
    const sigueVigente = () => usuarioDelPerfilRef.current === usuario.id

    let lectura = await leerPerfil(usuario.id)
    if (!lectura.ok && sigueVigente()) {
      console.error(
        `No se pudo leer el perfil; se reintenta en ${ESPERA_REINTENTO_PERFIL_MS} ms.`,
        lectura.error,
      )
      await esperar(ESPERA_REINTENTO_PERFIL_MS)
      if (sigueVigente()) lectura = await leerPerfil(usuario.id)
    }
    if (!sigueVigente()) return

    if (!lectura.ok) {
      // Sin datos confiables del rol: queda el perfil anterior de esta cuenta
      // (o ninguno, sin permisos de admin, si todavía no se había cargado).
      console.error(
        'No se pudo leer el perfil tras reintentar; se conserva el que estaba cargado.',
        lectura.error,
      )
      return
    }

    const meta = usuario.user_metadata ?? {}
    const fila = lectura.fila
    setPerfil({
      id: usuario.id,
      nombre: fila?.nombre || (meta.nombre as string) || null,
      telefono: fila?.telefono || (meta.telefono as string) || null,
      rol: fila?.rol ?? 'cliente',
      created_at: fila?.created_at ?? '',
      acepta_novedades: fila?.acepta_novedades === true,
      recordar_carrito: fila?.recordar_carrito !== false,
    })
  }, [])

  useEffect(() => {
    // Sesión inicial. `loading` se apaga SIEMPRE (finally): si getSession o el
    // perfil fallan, la app sigue como "sin sesión" en vez de quedar trabada
    // (Checkout y el panel no renderizan nada mientras loading es true).
    const iniciar = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) console.error('No se pudo recuperar la sesión:', error.message)
        setSession(data.session)
        await cargarPerfil(data.session?.user)
      } catch (e) {
        console.error('No se pudo recuperar la sesión:', e)
      } finally {
        setLoading(false)
      }
    }
    iniciar()

    const { data: sub } = supabase.auth.onAuthStateChange((_e, nueva) => {
      setSession(nueva)
      cargarPerfil(nueva?.user).catch((e) => console.error('No se pudo cargar el perfil:', e))
    })
    return () => sub.subscription.unsubscribe()
  }, [cargarPerfil])

  const registrar: AuthContextValue['registrar'] = useCallback(async (datos, volverA) => {
    const { data, error } = await supabase.auth.signUp({
      email: datos.email,
      password: datos.password,
      options: {
        // Estos datos los toma el trigger handle_new_user para armar el perfil.
        data: { nombre: datos.nombre, telefono: datos.telefono },
        emailRedirectTo: urlConfirmacion(volverA),
      },
    })
    if (error) return { error: traducirErrorAuth(error), necesitaConfirmar: false, yaRegistrado: false }

    // Supabase no avisa con un error si el email ya tiene una cuenta
    // confirmada (para no revelar qué emails existen): responde "OK" pero
    // sin mandar ningún mail. La única forma de distinguirlo de un alta
    // real es que `identities` viene vacío en ese caso (en un alta nueva
    // trae al menos una). Sin este chequeo, la pantalla prometía "revisá tu
    // email" para un mail que nunca se mandaba.
    const yaRegistrado = !data.session && data.user?.identities?.length === 0
    if (yaRegistrado) {
      return { error: null, necesitaConfirmar: false, yaRegistrado: true }
    }

    // Si no hay sesión tras el signup, es porque falta confirmar el email.
    const necesitaConfirmar = !data.session
    return { error: null, necesitaConfirmar, yaRegistrado: false }
  }, [])

  // "Email sin confirmar" se distingue de "contraseña incorrecta": antes las
  // dos decían lo mismo y una clienta sin confirmar no tenía cómo salir.
  const ingresar: AuthContextValue['ingresar'] = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: traducirErrorAuth(error), sinConfirmar: esSinConfirmar(error) }
  }, [])

  const reenviarConfirmacion: AuthContextValue['reenviarConfirmacion'] = useCallback(
    async (email, volverA) => {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: urlConfirmacion(volverA) },
      })
      return { error: traducirErrorAuth(error) }
    },
    [],
  )

  // Manda el mail de recuperación. Igual que en signUp, Supabase no distingue
  // por error si el email existe o no (para no revelar cuentas registradas),
  // así que la pantalla siempre debe mostrar el mismo aviso de éxito.
  const recuperarPassword: AuthContextValue['recuperarPassword'] = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/restablecer-contrasena`,
    })
    return { error: traducirErrorAuth(error) }
  }, [])

  // Se usa ya con la sesión temporal que crea Supabase al abrir el link del
  // mail de recuperación (evento PASSWORD_RECOVERY), no con la sesión normal.
  const actualizarPassword: AuthContextValue['actualizarPassword'] = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password })
    return { error: traducirErrorAuth(error) }
  }, [])

  const recargarPerfil = useCallback(async () => {
    const { data } = await supabase.auth.getUser()
    await cargarPerfil(data.user ?? undefined)
  }, [cargarPerfil])

  const salir = useCallback(async () => {
    // En un celular compartido, la próxima cuenta no hereda los datos de envío
    // que quedaron en el borrador del checkout.
    borrarBorrador()
    await supabase.auth.signOut()
  }, [])

  const value: AuthContextValue = {
    session,
    perfil,
    loading,
    esAdmin: perfil?.rol === 'admin',
    registrar,
    ingresar,
    reenviarConfirmacion,
    recuperarPassword,
    actualizarPassword,
    recargarPerfil,
    salir,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
