import { cn } from '@/lib/utils';
import falabellaLogo from '../assets/falabella.png';
import mercadoLibreLogo from '../assets/mercado-libre.svg';
import ripleyBadge from '../assets/ripley.svg';
import ripleyWordmark from '../assets/logo-blanco.svg';

const SIZE = {
  xs: 'size-4',
  sm: 'size-5',
  md: 'size-6',
  lg: 'size-8',
} as const;

type ChannelMarkSize = keyof typeof SIZE;

export function ChannelMark({
  code,
  name,
  className,
  size = 'sm',
  title,
  ripley = 'badge',
}: {
  code?: string | null;
  name?: string | null;
  className?: string;
  size?: ChannelMarkSize;
  title?: string;
  ripley?: 'badge' | 'wordmark';
}) {
  const value = String(code || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const compact = value.replace(/_/g, '');
  const box = SIZE[size];
  const label = title || name || (
    compact === 'falabella' ? 'Falabella'
      : compact === 'ripley' ? 'Ripley'
        : compact === 'mercadolibre' ? 'Mercado Libre'
          : compact === 'manual' ? 'Manual'
            : undefined
  );

  if (compact === 'falabella') {
    return (
      <img
        src={falabellaLogo}
        alt=""
        title={label}
        className={cn(box, 'shrink-0 overflow-hidden rounded-[3px] object-contain', className)}
      />
    );
  }

  if (compact === 'ripley') {
    if (ripley === 'wordmark') {
      const mark = size === 'lg' ? 'h-6 w-auto' : size === 'md' ? 'h-4 w-auto' : 'h-3 w-auto';
      return (
        <span
          className={cn('grid shrink-0 place-items-center overflow-hidden rounded-[3px] border border-zinc-700 bg-zinc-950', box, className)}
          title={label}
          aria-label="Ripley"
        >
          <img src={ripleyWordmark} alt="" className={mark} />
        </span>
      );
    }
    return (
      <img
        src={ripleyBadge}
        alt=""
        title={label}
        className={cn(box, 'shrink-0 overflow-hidden rounded-[3px] object-contain', className)}
      />
    );
  }

  if (compact === 'mercadolibre') {
    return (
      <img
        src={mercadoLibreLogo}
        alt=""
        title={label}
        className={cn(box, 'shrink-0 overflow-hidden rounded-[3px] object-contain', className)}
      />
    );
  }

  if (compact === 'manual' || !name) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center rounded-[3px] bg-teal-100 text-[9px] font-bold text-teal-800', box, className)}
        title={label || 'Manual'}
        aria-label="Manual"
      >
        M
      </span>
    );
  }

  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-[3px] border text-[8px] font-bold', box, className)}
      title={label}
      aria-hidden="true"
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
