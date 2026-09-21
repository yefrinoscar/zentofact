import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import type { OperatorNotification } from '../lib/notifications-presentation';
import {
  emptyNotifications,
  useNotificationActions,
  useOperatorNotifications,
} from '../hooks/useOperatorNotifications';
import { Button } from './ui/button';

// Prioridad operativa del banner: primero lo que detiene trabajo, después lo
// informativo. Es solo una preferencia de este banner, no cambia Avisos.
const BANNER_PRIORITY: Record<OperatorNotification['kind'], number> = {
  stock_discount_failed: 0,
  emission_failed: 1,
  bandeja_overdue: 2,
  insumo_low_stock: 3,
  product_sold_out: 4,
  product_low_stock: 5,
  marketplace_mutation: 6,
};

// Franja compacta de una sola línea: resume los avisos críticos sin leer sin
// empujar la app con una lista. Muestra el más importante, cuántos más hay y
// un único "Ver"; la X descarta el aviso visible para dar paso al siguiente.
export function OperationalAlertBanner() {
  const query = useOperatorNotifications();
  const { markRead, dismiss } = useNotificationActions();
  const data = query.data || emptyNotifications();

  const critical = data.items.filter((item) => item.unread && item.severity === 'critical');
  if (!critical.length) return null;

  const ordered = [...critical].sort((left, right) => (
    (BANNER_PRIORITY[left.kind] ?? 9) - (BANNER_PRIORITY[right.kind] ?? 9)
  ));
  const primary = ordered[0];
  const more = ordered.length - 1;

  return (
    <div
      role="alert"
      aria-label="Avisos críticos"
      className="shrink-0 border-b border-destructive/15 bg-destructive/[0.04]"
    >
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-2 md:px-6 lg:px-8">
        <span
          className="grid size-6 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"
          aria-hidden="true"
        >
          <AlertTriangle className="size-3.5" />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm text-foreground">
          <span className="font-medium">{primary.title}</span>
          {more > 0 ? (
            <>
              <span className="mx-1.5 text-muted-foreground/60">·</span>
              <Link
                to="/avisos"
                className="text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
              >
                {more} aviso{more === 1 ? '' : 's'} más
              </Link>
            </>
          ) : null}
        </p>
        <Button asChild variant="ghost" size="xs" className="shrink-0 cursor-pointer">
          <Link to={primary.href} onClick={() => markRead.mutate({ ids: [primary.id] })}>
            Ver
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          aria-label={`Descartar ${primary.title}`}
          onClick={() => dismiss.mutate(primary.id)}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
