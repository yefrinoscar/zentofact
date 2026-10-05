import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, FileText, RotateCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  buyerMessageClock,
  formatAttachmentSize,
  groupBuyerMessagesByDay,
  isImageAttachment,
  type BuyerMessage,
  type BuyerMessageAttachment,
} from '../../lib/buyer-messages';

export type PendingBuyerMessage = {
  tempId: string;
  text: string;
  attachmentId?: string;
  attachmentName?: string;
  status: 'sending' | 'failed' | 'rejected';
};

type MessageListProps = {
  orderId: number;
  messages: BuyerMessage[];
  pending: PendingBuyerMessage[];
  firstUnreadIndex: number | null;
  loading: boolean;
  refreshing: boolean;
  refreshFailed: boolean;
  scrollSignal: number;
  onRetry: (tempId: string) => void;
  onDiscard: (tempId: string) => void;
  onImageOpen: (preview: { src: string; name: string }) => void;
};

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function sameGroup(left: BuyerMessage, right: BuyerMessage | undefined) {
  if (!right || right.direction !== left.direction || left.direction === 'system') return false;
  const leftTime = left.sentAt ? new Date(left.sentAt).getTime() : Number.NaN;
  const rightTime = right.sentAt ? new Date(right.sentAt).getTime() : Number.NaN;
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return false;
  return rightTime - leftTime < GROUP_WINDOW_MS;
}

function AttachmentBody({
  orderId,
  attachment,
  onImageOpen,
}: {
  orderId: number;
  attachment: BuyerMessageAttachment;
  onImageOpen: (preview: { src: string; name: string }) => void;
}) {
  const url = `/mercado-libre/attachments/${orderId}/${encodeURIComponent(attachment.id)}`;
  const size = formatAttachmentSize(attachment.size);
  if (isImageAttachment(attachment)) {
    return (
      <button
        type="button"
        className="mt-1.5 block overflow-hidden rounded-xl border text-left"
        onClick={() => onImageOpen({ src: url, name: attachment.name })}
      >
        <img src={url} alt={attachment.name} loading="lazy" className="h-32 w-48 object-cover" />
        <span className="block px-2 py-1 text-[11px] text-muted-foreground">
          {attachment.name}{size ? ` · ${size}` : ''}
        </span>
      </button>
    );
  }
  const extension = (attachment.name.split('.').pop() || '').toUpperCase();
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener"
      className="mt-1.5 flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs hover:bg-muted/50"
    >
      <span className={cn(
        'grid size-8 shrink-0 place-items-center rounded-md text-[10px] font-semibold',
        extension === 'PDF' ? 'bg-rose-100 text-rose-700' : 'bg-muted text-muted-foreground',
      )}>
        {extension || <FileText className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{attachment.name}</span>
        <span className="block text-[11px] text-muted-foreground">{size ? `${size} · ` : ''}Abrir</span>
      </span>
    </a>
  );
}

export function MessageList({
  orderId,
  messages,
  pending,
  firstUnreadIndex,
  loading,
  refreshing,
  refreshFailed,
  scrollSignal,
  onRetry,
  onDiscard,
  onImageOpen,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [live, setLive] = useState(false);
  const previousCount = useRef<number | null>(null);
  const didInitialScroll = useRef(false);
  const groups = groupBuyerMessagesByDay(messages);
  const total = messages.length;

  const nearBottom = () => {
    const node = containerRef.current;
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    setNewBelow(0);
  };

  useEffect(() => {
    const node = containerRef.current;
    if (!node || loading) return;
    if (!didInitialScroll.current) {
      didInitialScroll.current = true;
      previousCount.current = total;
      if (firstUnreadIndex != null) {
        const target = node.querySelector<HTMLElement>('[data-unread-separator]');
        if (target) {
          node.scrollTo({ top: Math.max(0, target.offsetTop - 12), behavior: 'auto' });
          setNewBelow(Math.max(0, total - firstUnreadIndex));
          return;
        }
      }
      node.scrollTo({ top: node.scrollHeight, behavior: 'auto' });
      return;
    }
    const previous = previousCount.current ?? total;
    previousCount.current = total;
    if (total > previous) {
      if (nearBottom()) scrollToBottom();
      else setNewBelow((current) => current + (total - previous));
    }
  }, [total, loading, firstUnreadIndex]);

  useEffect(() => {
    if (!scrollSignal) return;
    scrollToBottom();
  }, [scrollSignal]);

  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => setLive(true), 0);
    return () => window.clearTimeout(timer);
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-busy="true" aria-label="Cargando mensajes">
        <div className="flex justify-start"><div className="h-10 w-2/3 animate-pulse rounded-2xl rounded-bl-sm bg-muted" /></div>
        <div className="flex justify-end"><div className="h-10 w-1/2 animate-pulse rounded-2xl rounded-br-sm bg-muted" /></div>
        <div className="flex justify-start"><div className="h-14 w-3/4 animate-pulse rounded-2xl rounded-bl-sm bg-muted" /></div>
      </div>
    );
  }

  if (!messages.length && !pending.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-8 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted">
          <AlertCircle className="size-5 text-muted-foreground" />
        </span>
        <p className="text-sm font-medium">Aún no hay mensajes</p>
        <p className="text-xs text-muted-foreground">Te avisaremos en la bandeja cuando llegue su mensaje.</p>
      </div>
    );
  }

  let globalIndex = -1;
  return (
    <div className="relative min-h-0 flex-1">
      {refreshFailed && (
        <p className="bg-muted/50 px-5 py-2 text-xs text-muted-foreground">
          No se pudo actualizar. Mostrando lo último cargado.
        </p>
      )}
      <div
        ref={containerRef}
        role="log"
        aria-live={live ? 'polite' : 'off'}
        aria-relevant="additions"
        tabIndex={0}
        className="h-full space-y-3 overflow-y-auto px-5 py-4 outline-none"
      >
        {groups.map((group) => (
          <div key={group.key} className="space-y-3">
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] font-medium text-muted-foreground">{group.label}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {group.messages.map((message, index) => {
              globalIndex = messages.indexOf(message);
              const own = message.direction === 'seller';
              const system = message.direction === 'system';
              const hideMeta = sameGroup(message, group.messages[index + 1]);
              const showUnread = firstUnreadIndex != null && globalIndex === firstUnreadIndex;
              return (
                <div key={message.id}>
                  {showUnread && (
                    <div data-unread-separator className="flex items-center gap-3 py-2">
                      <span className="h-px flex-1 bg-sky-200" />
                      <span className="text-[11px] font-medium text-sky-700">Nuevos</span>
                      <span className="h-px flex-1 bg-sky-200" />
                    </div>
                  )}
                  {system ? (
                    <p className="mx-auto max-w-[85%] text-center text-xs text-muted-foreground">
                      {message.text}
                    </p>
                  ) : (
                    <div className={cn('flex', own ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[80%]', own ? 'items-end' : 'items-start')}>
                        <div className={cn(
                          'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-5',
                          own ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted',
                        )}>
                          {message.text}
                          {message.attachments.map((attachment) => (
                            <AttachmentBody key={attachment.id} orderId={orderId} attachment={attachment} onImageOpen={onImageOpen} />
                          ))}
                        </div>
                        {!hideMeta && (
                          <p className={cn('mt-1 text-[11px] text-muted-foreground', own && 'text-right')}>
                            {own ? 'Tú' : 'Comprador'} · {buyerMessageClock(message.sentAt)}{refreshing ? ' · Actualizando…' : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {pending.map((message) => (
          <div key={message.tempId} className="flex justify-end">
            <div className="max-w-[80%] space-y-1">
              <div className={cn(
                'whitespace-pre-wrap break-words rounded-2xl rounded-br-sm px-3.5 py-2 text-sm leading-5',
                message.status === 'sending' ? 'bg-primary/60 text-primary-foreground' : 'border border-destructive/30 bg-destructive/5',
              )}>
                {message.text}
                {message.attachmentName && <p className="mt-1 text-[11px] opacity-80">{message.attachmentName}</p>}
              </div>
              <div className="flex items-center justify-end gap-2 text-[11px]">
                {message.status === 'sending' && <span className="text-muted-foreground">Enviando…</span>}
                {message.status === 'failed' && (
                  <>
                    <span className="text-destructive">No se envió.</span>
                    <Button variant="ghost" size="xs" onClick={() => onRetry(message.tempId)}><RotateCw />Reintentar</Button>
                    <Button variant="ghost" size="xs" onClick={() => onDiscard(message.tempId)}><X />Descartar</Button>
                  </>
                )}
                {message.status === 'rejected' && (
                  <>
                    <span className="text-destructive">Mercado Libre rechazó el mensaje. Revisa el contenido.</span>
                    <Button variant="ghost" size="xs" onClick={() => onDiscard(message.tempId)}><X />Descartar</Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        <div className="h-px" />
      </div>
      {newBelow > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button size="sm" variant="secondary" className="pointer-events-auto shadow" onClick={() => scrollToBottom()}>
            <ArrowDown />{newBelow} {newBelow === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}
          </Button>
        </div>
      )}
    </div>
  );
}
