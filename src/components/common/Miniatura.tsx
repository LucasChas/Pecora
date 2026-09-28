import { useEffect, useState, useSyncExternalStore, type ImgHTMLAttributes } from 'react'
import { elegirFuente, registroMiniaturas } from '../../lib/miniaturasDisponibles'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  // URL de la foto ORIGINAL (la que guarda el producto). La miniatura se deriva.
  src: string
}

// <img> que muestra la miniatura liviana de una foto SOLO si el registro de
// Storage confirma que existe (lib/miniaturasDisponibles); si no, el original.
// - Registro todavía sin cargar: arranca con el original y pasa a la
//   miniatura si el registro llega antes de que el original termine de
//   cargar; una imagen ya cargada no se reemplaza (sin parpadeo). Con el
//   registro en sessionStorage (visitas siguientes) sale directo la miniatura.
// - Si la miniatura falla igual (ej. la borraron), cae UNA sola vez al
//   original; si el original también falla no reintenta: sin bucles.
// Por defecto carga diferida: pasá loading="eager" para lo que se ve de entrada.
export default function Miniatura({
  src,
  loading = 'lazy',
  decoding = 'async',
  onLoad,
  ...resto
}: Props) {
  const disponibles = useSyncExternalStore(
    registroMiniaturas.suscribir,
    registroMiniaturas.disponibles,
  )
  // Se guardan URLs (no booleanos) para que, si la foto cambia, se reevalúe.
  const [fallida, setFallida] = useState<string | null>(null)
  const [originalCargado, setOriginalCargado] = useState<string | null>(null)

  // Un solo listado compartido por todas las miniaturas y vigente unos
  // minutos: montar muchas a la vez no dispara más pedidos.
  useEffect(() => {
    void registroMiniaturas.cargar()
  }, [])

  const actual = elegirFuente(src, disponibles, { fallida, originalCargado })

  return (
    <img
      {...resto}
      src={actual}
      loading={loading}
      decoding={decoding}
      onLoad={(evento) => {
        if (actual === src) setOriginalCargado(src)
        onLoad?.(evento)
      }}
      onError={() => {
        if (actual !== src) setFallida(actual)
      }}
    />
  )
}
