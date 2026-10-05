import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '@/lib/utils';
import { sellerShortName } from '../../lib/seller-name';
import { ChannelMark, CopyableOrderNumber, ProductImageLightbox } from '../../routes/bandeja-prototype/shared';
import { blockedBuyerCopy, firstUnreadBuyerIndex, type BuyerMessage } from '../../lib/buyer-messages';
import { ConversationComposer } from './ConversationComposer';
import { MessageList, type PendingBuyerMessage } from './MessageList';

export type BuyerConversationOrder = {
  id: number;
  externalOrderNumber: string;
  companyName?: string | null;
  channelCode?: string | null;
  stage?: string | null;
  customer?: { name?: string } | null;
};

const STAGE_LABELS: Record<string, string> = {
  pending: 'Por preparar',
  preparing: 'En preparación',
  ready: 'Confirmado',
  ready_to_ship: 'Confirmado',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export function BuyerConversation({
  order,
  open = true,
  initialUnread = 0,
  variant = 'sheet',
}: {
  order: BuyerConversationOrder;
  open?: boolean;
  initialUnread?: number;
  variant?: 'sheet' | 'embedded';
}) {
  const queryClient = useQueryClient();
  const { role, loading: permissionsLoading } = usePermissions();
  const canReply = !permissionsLoading && role !== 'viewer';
  const [pending, setPending] = useState<PendingBuyerMessage[]>([]);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [scrollSignal, setScrollSignal] = useState(0);
  const firstUnreadRef = useRef<{ orderId: number; index: number | null } | null>(null);
  const badgeRefreshed = useRef(false);

  const conversationQuery = useQuery({
    queryKey: ['buyer-messages', order.id],
    queryFn: () => api.buyerMessagesConversation(order.id),
    enabled: open && order.id > 0,
    refetchInterval: () => (typeof document !== 'undefined' && document.visibilityState === 'visible' ? 15_000 : false),
    staleTime: 5_000,
  });
  const conversation = conversationQuery.data;
  const messages: BuyerMessage[] = conversation?.messages || [];

  // El separador «Nuevos» se congela la primera vez que llega la conversación.
  if (firstUnreadRef.current?.orderId !== order.id && conversation) {
    firstUnreadRef.current = {
      orderId: order.id,
      index: firstUnreadBuyerIndex(messages, initialUnread),
    };
  }
  const firstUnreadIndex = firstUnreadRef.current?.orderId === order.id ? firstUnreadRef.current.index : null;

  useEffect(() => {
    if (!conversation || badgeRefreshed.current) return;
    badgeRefreshed.current = true;
    void queryClient.invalidateQueries({ queryKey: ['buyer-messages-unread'] });
  }, [conversation, queryClient]);

  const sendMutation = useMutation({
    mutationFn: (input: { tempId: string; text: string; attachmentId?: string }) => (
      api.buyerMessagesSend(order.id, { text: input.text, attachmentId: input.attachmentId })
    ),
    onSuccess: (_result, input) => {
      setPending((current) => current.filter((item) => item.tempId !== input.tempId));
      void queryClient.invalidateQueries({ queryKey: ['buyer-messages', order.id] });
      void queryClient.invalidateQueries({ queryKey: ['buyer-messages-unread'] });
    },
    onError: (error, input) => {
      const status = Number((error as { status?: number })?.status || 0);
      const nextStatus: PendingBuyerMessage['status'] = status >= 400 && status < 500 ? 'rejected' : 'failed';
      setPending((current) => current.map((item) => (
        item.tempId === input.tempId ? { ...item, status: nextStatus } : item
      )));
    },
  });

  const send = ({ text, attachmentId, attachmentName }: { text: string; attachmentId?: string; attachmentName?: string }) => {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPending((current) => [...current, { tempId, text, attachmentId, attachmentName, status: 'sending' }]);
    setScrollSignal((current) => current + 1);
    sendMutation.mutate({ tempId, text, attachmentId });
  };

  const retry = (tempId: string) => {
    const item = pending.find((entry) => entry.tempId === tempId);
    if (!item) return;
    setPending((current) => current.map((entry) => (
      entry.tempId === tempId ? { ...entry, status: 'sending' } : entry
    )));
    setScrollSignal((current) => current + 1);
    sendMutation.mutate({ tempId: item.tempId, text: item.text, attachmentId: item.attachmentId });
  };

  const discard = (tempId: string) => setPending((current) => current.filter((entry) => entry.tempId !== tempId));

  const blockedCopy = conversation?.blocked ? blockedBuyerCopy(conversation.blocked) : null;
  const hasBuyerMessage = messages.some((message) => message.direction === 'buyer');
  const waitingBuyer = Boolean(conversation) && !blockedCopy && !hasBuyerMessage;
  const disabledReason: 'no-permission' | 'waiting-buyer' | null = !canReply
    ? 'no-permission'
    : waitingBuyer ? 'waiting-buyer' : null;
  const stageLabel = STAGE_LABELS[String(order.stage || '')] || null;
  const statusBadge = blockedCopy
    ? <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">Bloqueada</span>
    : conversation?.conversation.status === 'active'
      ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">Conversación abierta</span>
      : null;

  const header = variant === 'sheet' ? (
    <SheetHeader className="border-b px-5 py-4 pr-14 text-left">
      <SheetDescription className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ChannelMark code="mercado_libre" className="size-4" />
        Mercado Libre{order.companyName ? ` · ${sellerShortName(order.companyName)}` : ''}
      </SheetDescription>
      <SheetTitle className="text-base font-semibold">
        Conversación con {conversation?.buyerName || order.customer?.name || 'el comprador'}
      </SheetTitle>
      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-muted-foreground">
        <CopyableOrderNumber value={order.externalOrderNumber} />
        {stageLabel && (
          <>
            <span aria-hidden>·</span>
            <span className="rounded-full border border-border px-2 py-0.5">{stageLabel}</span>
          </>
        )}
        {statusBadge}
      </div>
    </SheetHeader>
  ) : (
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-xs text-muted-foreground">
      {statusBadge}
      {!blockedCopy && !hasBuyerMessage && <span>La conversación la inicia el comprador.</span>}
    </div>
  );

  const body = conversationQuery.isError && !conversation ? (
    <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <AlertCircle className="size-5 text-destructive" />
      <p className="text-sm font-medium">No se pudieron cargar los mensajes.</p>
      <p className="text-xs text-muted-foreground">Revisa tu conexión o vuelve a intentarlo.</p>
      <Button variant="outline" size="sm" onClick={() => void conversationQuery.refetch()}>
        <RefreshCw />Reintentar
      </Button>
    </div>
  ) : (
    <MessageList
      orderId={order.id}
      messages={messages}
      pending={pending}
      firstUnreadIndex={firstUnreadIndex}
      loading={conversationQuery.isPending && !conversation}
      refreshing={conversationQuery.isFetching && Boolean(conversation)}
      refreshFailed={conversationQuery.isError && Boolean(conversation)}
      scrollSignal={scrollSignal}
      onRetry={retry}
      onDiscard={discard}
      onImageOpen={setPreview}
    />
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', variant === 'embedded' && 'h-[min(70vh,40rem)] border-b')}>
      {header}
      {body}
      {blockedCopy ? (
        <div className="border-t bg-muted/50 px-4 py-3 text-sm">
          <p className="font-medium">{blockedCopy.title}</p>
          <p className="text-muted-foreground">{blockedCopy.body}</p>
        </div>
      ) : disabledReason ? (
        <div className="border-t bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          {disabledReason === 'no-permission'
            ? 'Tu rol puede ver la conversación, pero no responder.'
            : 'Mercado Libre solo permite responder cuando el comprador escribe primero.'}
        </div>
      ) : (
        <ConversationComposer
          orderId={order.id}
          sending={sendMutation.isPending}
          onSend={send}
        />
      )}
      <ProductImageLightbox preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
