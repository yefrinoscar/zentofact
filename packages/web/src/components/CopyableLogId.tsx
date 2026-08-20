import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyableLogId({ logId }: { logId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? 'ID copiado' : 'Copiar ID de seguimiento'}
      aria-label={`Copiar ID de seguimiento ${logId}`}
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(logId);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          // El ID sigue visible para copiarlo a mano.
        }
      }}
      className="inline-flex items-center gap-1 font-mono text-xs font-semibold tracking-wide hover:underline"
    >
      {logId}
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5 opacity-70" />}
    </button>
  );
}
