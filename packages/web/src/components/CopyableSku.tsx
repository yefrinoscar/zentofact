import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/cn';

export function CopyableSku({
  sku,
  title = 'Copiar SKU',
  className,
}: {
  sku: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const value = String(sku || '').trim();
  if (!value) return null;
  return (
    <button
      type="button"
      title={copied ? 'SKU copiado' : title}
      aria-label={`Copiar SKU ${value}`}
      onClick={async (event) => {
        event.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      className={cn(
        'inline-flex max-w-full items-center gap-1 font-mono text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
    </button>
  );
}
