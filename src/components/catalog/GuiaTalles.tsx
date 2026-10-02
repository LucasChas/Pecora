import { useEffect, useRef } from 'react'

// Tabla orientativa de talles de bebé (Argentina). Se abre desde la ficha de
// un producto que se vende por talle.
const FILAS: [string, string, string, string][] = [
  ['RN', 'Recién nacido', 'hasta 56', 'hasta 4'],
  ['0-3 m', '0 a 3 meses', '56 a 62', '4 a 6'],
  ['3-6 m', '3 a 6 meses', '62 a 68', '6 a 8'],
  ['6-9 m', '6 a 9 meses', '68 a 74', '8 a 9'],
  ['9-12 m', '9 a 12 meses', '74 a 80', '9 a 10'],
  ['12-18 m', '12 a 18 meses', '80 a 86', '10 a 12'],
  ['18-24 m', '18 a 24 meses', '86 a 92', '12 a 13'],
]

export default function GuiaTalles({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (abierta && !d.open) d.showModal?.()
    if (!abierta && d.open) d.close()
  }, [abierta])

  return (
    <dialog
      ref={ref}
      className="guia-talles"
      aria-labelledby="guia-talles-titulo"
      onClose={onCerrar}
      onClick={(e) => {
        // Tocar afuera de la tarjeta cierra.
        if (e.target === e.currentTarget) onCerrar()
      }}
    >
      <div className="guia-talles-card">
        <div className="guia-talles-head">
          <h2 id="guia-talles-titulo">Guía de talles</h2>
          <button type="button" className="guia-talles-cerrar" onClick={onCerrar} aria-label="Cerrar la guía de talles">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th scope="col">Talle</th>
              <th scope="col">Edad</th>
              <th scope="col">Altura (cm)</th>
              <th scope="col">Peso (kg)</th>
            </tr>
          </thead>
          <tbody>
            {FILAS.map(([talle, edad, altura, peso]) => (
              <tr key={talle}>
                <th scope="row">{talle}</th>
                <td>{edad}</td>
                <td>{altura}</td>
                <td>{peso}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="guia-talles-nota">
          Las medidas son orientativas. Si tu bebé está entre dos talles, conviene el más grande. ¿Dudas?
          Escribinos por WhatsApp.
        </p>
      </div>
    </dialog>
  )
}
