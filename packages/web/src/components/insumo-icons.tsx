import type { SVGProps } from 'react';
import { cn } from '../lib/cn';
import cintaFillPhoto from '../assets/cinta-fill.jpg';
import cintaScotchPhoto from '../assets/cinta-scotch.jpg';
import fillPequenoPhoto from '../assets/fill-pequeno.jpg';

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ className, children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-4', className)}
      {...props}
    >
      {children}
    </svg>
  );
}

export function CintaFillIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 4h8a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <ellipse cx="12" cy="5" rx="4" ry="1.4" />
      <ellipse cx="12" cy="5" rx="1.5" ry="0.55" />
      <path d="M8 9h8" />
      <path d="M8 13h8" />
    </IconBase>
  );
}

export function CintaScotchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <ellipse cx="12" cy="13" rx="8" ry="6.5" />
      <ellipse cx="12" cy="13" rx="3.2" ry="2.5" />
      <path d="M9.2 11.2c1.8-2.2 4.8-2.2 6.6 0" />
    </IconBase>
  );
}

export function HojasBondIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 4h7.5A1.5 1.5 0 0 1 17 5.5V20H9.5A1.5 1.5 0 0 1 8 18.5Z" />
      <path d="M8 7H6.5A1.5 1.5 0 0 0 5 8.5V21a1 1 0 0 0 1 1h9" />
      <path d="M13 4v4h4" />
      <path d="M11 12h3.5" />
      <path d="M11 15.5h3.5" />
    </IconBase>
  );
}

export function CartuchosTintaIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 3h8v4.2L18 10v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9L8 7.2Z" />
      <path d="M10 6h4" />
      <path d="M12 13.2c.8 0 1.6.8 1.6 1.7S12.8 17 12 17s-1.6-.4-1.6-2.1.8-1.7 1.6-1.7Z" />
    </IconBase>
  );
}

export function InsumoGenericIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 8.5 12 4l9 4.5v9L12 22 3 17.5Z" />
      <path d="M12 12v10" />
      <path d="M21 8.5 12 12 3 8.5" />
    </IconBase>
  );
}

export const INSUMO_ICON_KEYS = [
  'cinta-fill', 'fill-pequeno', 'fill-amarillo', 'cinta-scotch',
  'hojas-bond', 'cartuchos-tinta', 'generic',
] as const;
export type InsumoIconKey = (typeof INSUMO_ICON_KEYS)[number];

export const INSUMO_ICON_OPTIONS: Array<{ key: InsumoIconKey; label: string }> = [
  { key: 'cinta-fill', label: 'Fill grande' },
  { key: 'fill-pequeno', label: 'Fill pequeño' },
  { key: 'cinta-scotch', label: 'Cinta scotch' },
  { key: 'generic', label: 'Otro' },
];

const ICONS = {
  'cinta-fill': CintaFillIcon,
  'fill-pequeno': CintaFillIcon,
  'fill-amarillo': CintaFillIcon,
  'cinta-scotch': CintaScotchIcon,
  'hojas-bond': HojasBondIcon,
  'cartuchos-tinta': CartuchosTintaIcon,
  generic: InsumoGenericIcon,
};

const PHOTOS: Partial<Record<InsumoIconKey, string>> = {
  'cinta-fill': cintaFillPhoto,
  'fill-pequeno': fillPequenoPhoto,
  'cinta-scotch': cintaScotchPhoto,
};

function resolveIconKey(iconKey?: string | null): InsumoIconKey {
  if (iconKey === 'papel-fill') return 'cinta-fill';
  if (iconKey === 'cinta') return 'cinta-scotch';
  if (INSUMO_ICON_KEYS.includes(iconKey as InsumoIconKey)) return iconKey as InsumoIconKey;
  return 'generic';
}

export function hasInsumoPhoto(iconKey?: string | null) {
  return Boolean(PHOTOS[resolveIconKey(iconKey)]);
}

export function InsumoIcon({
  iconKey,
  className,
}: {
  iconKey?: string | null;
  className?: string;
}) {
  const key = resolveIconKey(iconKey);
  const photo = PHOTOS[key];
  if (photo) {
    return <img src={photo} alt="" className={cn('object-contain', className)} />;
  }
  const Icon = ICONS[key];
  return <Icon className={className} />;
}
