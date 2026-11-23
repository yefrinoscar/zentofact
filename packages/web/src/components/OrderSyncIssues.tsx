import { useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import type { OrderSyncIssue } from '../lib/order-sync-issues';
import { cn } from '../lib/cn';

// Lista plana del último fallo de sincronización por cuenta: dice si falló el
// marketplace o Zentofact, el motivo exacto y el logId para buscar en los logs.
export function OrderSyncIssues({ issues }: { issues: OrderSyncIssue[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!issues.length) return null;

  const copy = (logId: string) => {
    void navigator.clipboard?.writeText(logId).then(() => {
      setCopied(logId);
      window.setTimeout(() => setCopied((current) => (current === logId ? null : current)), 1600);
    }).catch(() => {});
  };

  return (
    <section
      role="status"
      aria-label="Errores de sincronización"
      className="divide-y divide-destructive/10 border-y border-destructive/15 bg-destructive/[0.03]"
    >
      {issues.map((issue) => (
        <div key={issue.key} className="flex items-start gap-3 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                className={cn(
                  'rounded px-1.5 py-px text-[11px] font-medium',
                  issue.origin === 'marketplace'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    : 'bg-destructive/10 text-destructive',
                )}
              >
                {issue.originLabel}
              </span>
              <span className="font-medium">{issue.channel} · {issue.seller}</span>
              {issue.at ? (
                <span className="text-xs text-muted-foreground">
                  {new Date(issue.at).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground" title={issue.message}>
              {issue.message}
            </p>
          </div>
          {issue.logId ? (
            <button
              type="button"
              onClick={() => copy(issue.logId as string)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="Copiar ID del log"
              aria-label={`Copiar ID del log ${issue.logId}`}
            >
              {copied === issue.logId ? <Check className="size-3" /> : <Copy className="size-3" />}
              {issue.logId}
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
