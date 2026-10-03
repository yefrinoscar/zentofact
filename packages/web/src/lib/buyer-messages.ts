// Presentación de la conversación posventa de Mercado Libre (chat desde la
// bandeja). Mantiene el vocabulario y los estados en un solo lugar.
export const BUYER_MESSAGE_MAX = 350;
export const BUYER_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const BUYER_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.pdf,.txt';

const LIMA = 'America/Lima';
const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: LIMA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat('es-PE', {
  timeZone: LIMA,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const CLOCK_FORMATTER = new Intl.DateTimeFormat('es-PE', {
  timeZone: LIMA,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export type BuyerMessageDirection = 'buyer' | 'seller' | 'system';

export type BuyerMessageAttachment = {
  id: string;
  name: string;
  size: number | null;
  contentType: string | null;
};

export type BuyerMessage = {
  id: string;
  direction: BuyerMessageDirection;
  text: string;
  sentAt: string | null;
  readAt: string | null;
  attachments: BuyerMessageAttachment[];
};

export type BuyerConversationBlockReason =
  | 'cancelled'
  | 'mediation'
  | 'fulfillment'
  | 'time'
  | 'payment'
  | 'buyer'
  | 'other';

export type BuyerConversationBlock = {
  reason: BuyerConversationBlockReason;
  substatus: string | null;
} | null;

export type BuyerConversationStatus = {
  status: string | null;
  substatus: string | null;
  statusDate: string | null;
  claimId: string | null;
  shippingId: string | null;
};

export type BuyerConversationPayload = {
  orderId: number;
  orderNumber: string;
  packId: string;
  companyId: number;
  sellerId: string;
  buyerId: string | null;
  buyerName: string | null;
  stage: string;
  blocked: BuyerConversationBlock;
  conversation: BuyerConversationStatus;
  sellerMaxMessageLength: number;
  messages: BuyerMessage[];
};

export type BuyerUnreadCounts = Record<string, number>;

export function buyerMessageDayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return DAY_FORMATTER.format(date);
}

export function buyerMessageDayLabel(key: string, now = new Date()): string {
  const today = DAY_FORMATTER.format(now);
  if (key === today) return 'Hoy';
  const yesterday = DAY_FORMATTER.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (key === yesterday) return 'Ayer';
  const parsed = new Date(`${key}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return key;
  const label = DAY_LABEL_FORMATTER.format(parsed).replace(/\./g, '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function groupBuyerMessagesByDay(messages: BuyerMessage[], now = new Date()) {
  const groups: Array<{ key: string; label: string; messages: BuyerMessage[] }> = [];
  for (const message of messages) {
    const key = buyerMessageDayKey(message.sentAt) || 'sin-fecha';
    const current = groups[groups.length - 1];
    if (current && current.key === key) current.messages.push(message);
    else groups.push({ key, label: key === 'sin-fecha' ? 'Sin fecha' : buyerMessageDayLabel(key, now), messages: [message] });
  }
  return groups;
}

export function buyerMessageClock(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return CLOCK_FORMATTER.format(date);
}

/**
 * Índice del primer mensaje sin leer al abrir el panel. El conteo viene del
 * endpoint de no leídos de Mercado Libre (contado antes de marcar leído).
 */
export function firstUnreadBuyerIndex(messages: BuyerMessage[], unreadCount: number): number | null {
  if (!Number.isFinite(unreadCount) || unreadCount <= 0) return null;
  const buyerIndexes = messages.flatMap((message, index) => (message.direction === 'buyer' ? [index] : []));
  if (!buyerIndexes.length) return null;
  const start = Math.max(0, buyerIndexes.length - Math.floor(unreadCount));
  return buyerIndexes[start] ?? null;
}

export function isImageAttachment(attachment: BuyerMessageAttachment): boolean {
  if (attachment.contentType?.startsWith('image/')) return true;
  return /\.(jpe?g|png)$/i.test(attachment.name || attachment.id);
}

export function formatAttachmentSize(bytes: number | null | undefined): string | null {
  if (!Number.isFinite(bytes) || (bytes as number) < 0) return null;
  const value = bytes as number;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function validateBuyerAttachment(file: { name: string; size: number }): 'type' | 'size' | null {
  if (file.size > BUYER_ATTACHMENT_MAX_BYTES) return 'size';
  if (!/\.(jpe?g|png|pdf|txt)$/i.test(file.name || '')) return 'type';
  return null;
}

export function blockedBuyerCopy(block: BuyerConversationBlock): { title: string; body: string } {
  switch (block?.reason) {
    case 'cancelled':
      return {
        title: 'Conversación bloqueada.',
        body: 'El pedido fue cancelado; Mercado Libre ya no permite enviar mensajes.',
      };
    case 'mediation':
      return {
        title: 'Conversación bloqueada.',
        body: 'Hay una mediación abierta. Responde desde Mercado Libre.',
      };
    case 'fulfillment':
      return {
        title: 'Conversación bloqueada.',
        body: 'Es una venta con Fulfillment: podrás escribir cuando el paquete se entregue.',
      };
    case 'payment':
      return {
        title: 'Conversación bloqueada.',
        body: 'El pago todavía no se procesó. Podrás escribir cuando Mercado Libre lo confirme.',
      };
    case 'time':
      return {
        title: 'Conversación bloqueada.',
        body: 'Pasaron más de 30 días desde el último mensaje; solo el comprador puede reabrirla.',
      };
    case 'buyer':
      return {
        title: 'Conversación bloqueada.',
        body: 'El comprador bloqueó la recepción de mensajes.',
      };
    default:
      return {
        title: 'Conversación bloqueada.',
        body: 'Mercado Libre no permite enviar mensajes en este pedido.',
      };
  }
}

export function composerDisabledHint(reason: 'empty' | 'offline' | 'no-permission' | 'blocked' | 'waiting-buyer'): string {
  switch (reason) {
    case 'offline':
      return 'Sin conexión. Tu mensaje se mantendrá aquí hasta que vuelvas a estar en línea.';
    case 'no-permission':
      return 'Tu rol puede ver la conversación, pero no responder.';
    case 'waiting-buyer':
      return 'Mercado Libre solo permite responder cuando el comprador escribe primero.';
    default:
      return '';
  }
}
