import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { LogisticsOrder } from '../../routes/bandeja-prototype/shared';
import { BuyerConversation } from './BuyerConversation';

export function BuyerConversationSheet({
  order,
  unread,
  open,
  onOpenChange,
}: {
  order: LogisticsOrder | null;
  unread: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0 sm:max-w-[480px]">
        {order && (
          <BuyerConversation
            order={order}
            open={open}
            initialUnread={unread}
            variant="sheet"
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
