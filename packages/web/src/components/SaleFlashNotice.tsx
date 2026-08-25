import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/cn';
import type { SaleFlash } from '../lib/sale-feedback';

export function SaleFlashNotice({
  flash,
  onDismiss,
}: {
  flash: SaleFlash;
  onDismiss?: () => void;
}) {
  const isError = flash.tone === 'error';
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-3 py-3',
        isError
          ? 'border-destructive/25 bg-destructive/5 text-destructive'
          : 'border-border bg-muted/40 text-foreground',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-5 shrink-0',
          isError ? 'text-destructive' : 'text-foreground',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5">{flash.title}</p>
        <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{flash.detail}</p>
        {flash.hint && (
          <p className="mt-1 text-xs leading-4 text-muted-foreground">{flash.hint}</p>
        )}
      </div>
      {onDismiss && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-9 shrink-0 cursor-pointer"
          aria-label="Cerrar aviso"
          onClick={onDismiss}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
