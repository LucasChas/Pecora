import type { Perfil, Rol } from '../types'

// Roles del panel. La base es la que manda (RLS + chequeos en las RPC y en la
// Edge Function); esto solo decide qué se MUESTRA para no ofrecer acciones que
// después la base va a rechazar.
//
//   cliente  → sin acceso al panel.
//   empleado → productos y categorías, pedidos (ver, cambiar estado, papelera,
//              alta manual). Sin borrado definitivo, ajustes, estadísticas ni
//              equipo.
//   admin    → todo.

type ConRol = Pick<Perfil, 'rol'> | { rol?: string | null } | null | undefined

function rolDe(perfil: ConRol): Rol | null {
  const rol = perfil?.rol
  return rol === 'admin' || rol === 'empleado' || rol === 'cliente' ? rol : null
}

export function esAdmin(perfil: ConRol): boolean {
  return rolDe(perfil) === 'admin'
}

// Staff = puede entrar al panel (admin o empleado).
export function esStaff(perfil: ConRol): boolean {
  const rol = rolDe(perfil)
  return rol === 'admin' || rol === 'empleado'
}

export interface PermisosPanel {
  panel: boolean
  productos: boolean
  pedidos: boolean
  borrarPedidoDefinitivo: boolean
  ajustes: boolean
  estadisticas: boolean
  equipo: boolean
}

export function permisosDe(perfil: ConRol): PermisosPanel {
  const staff = esStaff(perfil)
  const admin = esAdmin(perfil)
  return {
    panel: staff,
    productos: staff,
    pedidos: staff,
    borrarPedidoDefinitivo: admin,
    ajustes: admin,
    estadisticas: admin,
    equipo: admin,
  }
}

export const TEXTO_ROL: Record<Rol, string> = {
  admin: 'Admin',
  empleado: 'Empleado',
  cliente: 'Cliente',
}
