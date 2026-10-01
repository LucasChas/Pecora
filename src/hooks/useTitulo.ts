import { useEffect } from 'react'

const MARCA = 'Pecora'

// Título de la pestaña por página ("Tu carrito · Pecora"). Antes todas decían
// lo mismo, así que el historial, los favoritos y las pestañas no se
// distinguían. Sin texto, el título de marca de index.html.
export function useTitulo(texto: string | null | undefined) {
  useEffect(() => {
    const anterior = document.title
    if (texto) document.title = `${texto} · ${MARCA}`
    return () => {
      document.title = anterior
    }
  }, [texto])
}
