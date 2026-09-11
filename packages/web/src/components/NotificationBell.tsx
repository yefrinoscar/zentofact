import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { cn } from '../lib/cn';
import {
  notificationAriaLabel,
  unreadBadgeLabel,
} from '../lib/notifications-presentation';
import { emptyNotifications, useNotificationActions, useOperatorNotifications } from '../hooks/useOperatorNotifications';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { NotificationList } from './NotificationList';

function UnreadBadge({ count, className }: { count: number; className?: string }) {
  const label = unreadBadgeLabel(count);
  if (!label) return null;
  return (
    <span
      className={cn(
        'absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-md bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground',
        className,
      )}
    >
      {label}
    </span>
  );
}

export function NotificationBell({ variant = 'popover' }: { variant?: 'popover' | 'link' }) {
  const [open, setOpen] = useState(false);
  const query = useOperatorNotifications();
  const { markRead, dismiss } = useNotificationActions();
  const data = query.data || emptyNotifications();
  const unread = data.unreadCount;
  const label = notificationAriaLabel(unread);

  if (variant === 'link') {
    return (
      <Link
        to="/avisos"
        aria-label={label}
        className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground active:bg-muted/70"
      >
        <Bell className="size-5" />
        <UnreadBadge count={unread} />
      </Link>
    );
  }

  const preview = data.items.slice(0, 8);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative cursor-pointer"
          aria-label={label}
        >
          <Bell />
          <UnreadBadge count={unread} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">Avisos</p>
          {unread > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="cursor-pointer"
              onClick={() => markRead.mutate({ all: true })}
              disabled={markRead.isPending}
            >
              Marcar todo leído
            </Button>
          ) : null}
        </div>
        {query.isLoading ? (
          <div className="space-y-2 p-3">
            <div className="h-14 animate-pulse rounded-md bg-muted" />
            <div className="h-14 animate-pulse rounded-md bg-muted" />
          </div>
        ) : preview.length ? (
          <div className="max-h-80 overflow-y-auto">
            <NotificationList
              items={preview}
              dense
              onOpen={(item) => {
                if (item.unread) markRead.mutate({ ids: [item.id] });
                setOpen(false);
              }}
              onDismiss={(item) => dismiss.mutate(item.id)}
            />
          </div>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nada pendiente.</p>
        )}
        <div className="border-t border-border p-2">
          <Button variant="ghost" size="sm" className="w-full cursor-pointer" asChild>
            <Link to="/avisos" onClick={() => setOpen(false)}>Ver todos</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
