import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import type { OperatorNotification } from '../lib/notifications-presentation';
import {
  emptyNotifications,
  useNotificationActions,
  useOperatorNotifications,
} from '../hooks/useOperatorNotifications';
import { Button } from './ui/button';

const MAX_VISIBLE = 2;

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

function BannerRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: OperatorNotification;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="grid size-7 shrink-0 place-items-center rounded-md border border-destructive/20 bg-destructive/10 text-destructive"
        aria-hidden="true"
      >
        <AlertTriangle className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
        {item.body ? <p className="truncate text-xs text-muted-foreground">{item.body}</p> : null}
      </div>
      <Button asChild variant="ghost" size="xs" className="shrink-0 cursor-pointer">
        <Link to={item.href} onClick={onOpen}>
          Ver
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
        aria-label={`Descartar ${item.title}`}
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  );
}

// Franja operativa persistente: muestra los avisos críticos sin leer bajo el
// encabezado para que no dependan de que el operador abra Avisos.
export function OperationalAlertBanner() {
  const query = useOperatorNotifications();
  const { markRead, dismiss } = useNotificationActions();
  const data = query.data || emptyNotifications();

  const critical = data.items.filter((item) => item.unread && item.severity === 'critical');
  if (!critical.length) return null;

  const ordered = [...critical].sort((left, right) => (
    (BANNER_PRIORITY[left.kind] ?? 9) - (BANNER_PRIORITY[right.kind] ?? 9)
  ));
  const visible = ordered.slice(0, MAX_VISIBLE);
  const hidden = ordered.length - visible.length;

  return (
    <div
      role="alert"
      aria-label="Avisos críticos"
      className="shrink-0 border-b border-destructive/20 bg-destructive/5"
    >
      <div className="mx-auto w-full max-w-7xl space-y-1.5 px-4 py-2.5 md:px-6 lg:px-8">
        {visible.map((item) => (
          <BannerRow
            key={item.id}
            item={item}
            onOpen={() => { if (item.unread) markRead.mutate({ ids: [item.id] }); }}
            onDismiss={() => dismiss.mutate(item.id)}
          />
        ))}
        {hidden > 0 ? (
          <Link
            to="/avisos"
            className="inline-block text-xs font-medium text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
          >
            Ver {hidden} aviso{hidden === 1 ? '' : 's'} más en Avisos
          </Link>
        ) : null}
      </div>
    </div>
  );
}
