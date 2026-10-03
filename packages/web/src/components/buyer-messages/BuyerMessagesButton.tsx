import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LogisticsOrder } from '../../routes/bandeja-prototype/shared';

export function BuyerMessagesButton({
  order,
  unread,
  disabled,
  onOpen,
}: {
  order: LogisticsOrder;
  unread: number;
  disabled: boolean;
  onOpen: () => void;
}) {
  const label = unread > 0
    ? `Conversar con el comprador del pedido ${order.externalOrderNumber}, ${unread} mensajes nuevos`
    : `Conversar con el comprador del pedido ${order.externalOrderNumber}`;
  return (
    <Button
      size="sm"
      variant={unread > 0 ? 'outline' : 'ghost'}
      className={cn(unread === 0 && 'text-muted-foreground')}
      disabled={disabled}
      aria-label={label}
      onClick={onOpen}
    >
      <MessageCircle />
      <span className="hidden sm:inline">Conversar</span>
      {unread > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] tabular-nums text-primary-foreground">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Button>
  );
}
