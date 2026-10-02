// Franja de bienvenida de la portada del muestrario: cómo se compra, en tres
// puntos. Solo se ve sin búsqueda ni filtros.
export default function BandaConfianza() {
  return (
    <ul className="banda-confianza" aria-label="Cómo comprar en Pecora">
      <li>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z" />
        </svg>
        <span>
          <strong>Hecho a mano</strong>
          Textiles suaves pensados para bebés
        </span>
      </li>
      <li>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" />
          <path d="M3 8l9 5 9-5M12 13v8" />
        </svg>
        <span>
          <strong>Envío o retiro</strong>
          Calculás el envío al hacer el pedido
        </span>
      </li>
      <li>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z" />
        </svg>
        <span>
          <strong>Atención por WhatsApp</strong>
          Coordinamos el pago y la entrega
        </span>
      </li>
    </ul>
  )
}
