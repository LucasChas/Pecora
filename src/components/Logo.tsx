import logoUrl from '../assets/logo.png'

// Isologo de Pecora. La imagen se importa como asset (ver src/assets/logo.png):
// para reemplazarlo, cambiá ese archivo o el import de arriba (sirve .png/.webp/.svg).
export default function Logo({ className = 'logo-img' }: { className?: string }) {
  return <img className={className} src={logoUrl} alt="Pecora" />
}
