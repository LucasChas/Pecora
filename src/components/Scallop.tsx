// Borde festoneado (efecto "ribete de manta tejida"): elemento de marca de
// Pecora que va debajo del header del catálogo. El estilo está en catalog.css.
export default function Scallop({ flip = false }: { flip?: boolean }) {
  return <div className={flip ? 'scallop flip' : 'scallop'} aria-hidden="true" />
}
