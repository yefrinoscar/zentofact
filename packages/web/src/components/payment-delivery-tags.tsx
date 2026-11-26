import type { ReactNode } from 'react';
import { Banknote } from 'lucide-react';
import shalomLogo from '../assets/shalom.png';
import { cn } from '../lib/cn';

const TAG = 'inline-flex h-5 max-w-full shrink-0 items-center gap-1 truncate rounded-md border px-1.5 text-[11px] font-bold uppercase tracking-wide';

function YapeLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-4 shrink-0', className)}>
      <rect width="16" height="16" rx="4" fill="#742284" />
      <path d="M4.2 4.6 7 9.1v2.7h1.9V9.1l2.9-4.5H9.7L8 7.4 6.3 4.6Z" fill="#fff" />
      <circle cx="12.1" cy="11.4" r="1.1" fill="#00D2C6" />
    </svg>
  );
}

function PlinLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-4 shrink-0', className)}>
      <rect width="16" height="16" rx="4" fill="#00B2C9" />
      <path d="M5.3 12.4V4.2h3.1c1.8 0 2.9 1 2.9 2.6S10.2 9.4 8.4 9.4H7.2v3Zm1.9-4.6h1.1c.7 0 1.1-.4 1.1-1s-.4-1-1.1-1H7.2Z" fill="#fff" />
    </svg>
  );
}

function CashLogo() {
  return (
    <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-emerald-600 text-white">
      <Banknote className="size-3" strokeWidth={2.4} />
    </span>
  );
}

function ShalomLogo() {
  return <img src={shalomLogo} alt="" className="size-4 shrink-0 rounded-[3px]" />;
}

const PAYMENT_LOGOS: Record<string, ReactNode> = {
  efectivo: <CashLogo />,
  yape_plin: (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <YapeLogo />
      <PlinLogo />
    </span>
  ),
};

/** Método de pago con el logo de la marca cuando existe (efectivo, Yape / Plin). */
export function PaymentMethodTag({ method, label }: { method?: string | null; label: ReactNode }) {
  const logo = PAYMENT_LOGOS[String(method || '').trim()];
  return (
    <span className={cn(TAG, 'border-border bg-background', logo && 'pl-0.5')} title={typeof label === 'string' ? label : undefined}>
      {logo}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Modalidad de entrega; Shalom lleva su logo. */
export function DeliveryTag({ label }: { label: ReactNode }) {
  const isShalom = typeof label === 'string' && ['shalom', 'shaloom'].includes(label.trim().toLowerCase());
  return (
    <span className={cn(TAG, 'border-transparent bg-secondary text-secondary-foreground', isShalom && 'pl-0.5')}>
      {isShalom && <ShalomLogo />}
      <span className="truncate">{label}</span>
    </span>
  );
}
