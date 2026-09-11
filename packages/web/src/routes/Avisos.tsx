import { Bell } from 'lucide-react';
import { emptyNotifications, useNotificationActions, useOperatorNotifications } from '../hooks/useOperatorNotifications';
import { NotificationList } from '../components/NotificationList';
import { Button } from '../components/ui/button';
import { usePermissions } from '../hooks/usePermissions';

export default function Avisos() {
  const { can } = usePermissions();
  const query = useOperatorNotifications();
  const { markRead, dismiss } = useNotificationActions();
  const data = query.data || emptyNotifications();
  const canReceive = can('auto_emision') || can('insumos') || can('orders_inbox')
    || can('productos') || can('order_management');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {query.isLoading
            ? 'Cargando avisos…'
            : data.unreadCount > 0
              ? `${data.unreadCount} sin leer`
              : 'Todo al día'}
        </p>
        {data.unreadCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={() => markRead.mutate({ all: true })}
            disabled={markRead.isPending}
          >
            Marcar todo leído
          </Button>
        ) : null}
      </div>

      {query.isError ? (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          No se pudieron cargar los avisos. Vuelve a intentar.
        </div>
      ) : query.isLoading ? (
        <div className="space-y-2">
          <div className="h-20 animate-pulse rounded-md bg-muted" />
          <div className="h-20 animate-pulse rounded-md bg-muted" />
        </div>
      ) : data.items.length ? (
        <NotificationList
          items={data.items}
          onOpen={(item) => {
            if (item.unread) markRead.mutate({ ids: [item.id] });
          }}
          onDismiss={(item) => dismiss.mutate(item.id)}
        />
      ) : (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <Bell className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Nada pendiente</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {canReceive
              ? 'Cuando falle una boleta, se agote un producto o un insumo, o se venza un pedido, aparece aquí.'
              : 'Tu perfil no recibe avisos de operación.'}
          </p>
        </div>
      )}
    </div>
  );
}
