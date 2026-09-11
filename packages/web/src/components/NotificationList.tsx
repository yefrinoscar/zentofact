import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, PackageOpen, X } from 'lucide-react';
import { cn } from '../lib/cn';
import {
  notificationElapsedLabel,
  type OperatorNotification,
} from '../lib/notifications-presentation';
import { Button } from './ui/button';

function iconForKind(kind: OperatorNotification['kind']) {
  if (kind === 'emission_failed') return AlertTriangle;
  if (kind === 'insumo_low_stock') return PackageOpen;
  return Clock;
}

function NotificationIcon({ item }: { item: OperatorNotification }) {
  const Icon = iconForKind(item.kind);
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-md border',
        item.severity === 'critical'
          ? 'border-destructive/20 bg-destructive/10 text-destructive'
          : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
      )}
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </span>
  );
}

export function NotificationList({
  items,
  now,
  dense = false,
  onOpen,
  onDismiss,
}: {
  items: OperatorNotification[];
  now?: Date;
  dense?: boolean;
  onOpen?: (item: OperatorNotification) => void;
  onDismiss?: (item: OperatorNotification) => void;
}) {
  return (
    <ul className={cn('divide-y divide-border/70', dense ? '' : 'rounded-md border border-border bg-card')}>
      {items.map((item) => {
        const elapsed = notificationElapsedLabel(item.createdAt, now);
        return (
          <li key={item.id} className="relative">
            {item.unread ? (
              <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />
            ) : null}
            <Link
              to={item.href}
              className={cn(
                'flex gap-3 py-3 pr-10 transition-colors hover:bg-muted/40',
                dense ? 'px-3' : 'px-4',
                item.unread ? 'bg-muted/20' : '',
              )}
              aria-label={item.unread ? `${item.title}, sin leer` : item.title}
              onClick={() => onOpen?.(item)}
            >
              <NotificationIcon item={item} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{item.title}</span>
                {item.body ? (
                  <span className="mt-0.5 block text-sm text-muted-foreground">{item.body}</span>
                ) : null}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {item.moduleLabel}
                  {elapsed ? ` · ${elapsed}` : ''}
                </span>
              </span>
            </Link>
            {onDismiss ? (
              <Button
                type="button"
                variant="ghost"
                size={dense ? 'icon-xs' : 'icon-sm'}
                className="absolute top-2.5 right-2 cursor-pointer text-muted-foreground hover:text-foreground"
                aria-label={`Descartar ${item.title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDismiss(item);
                }}
              >
                <X />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
