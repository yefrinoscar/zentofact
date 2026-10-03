// Conversaciones posventa de Mercado Libre para la bandeja.
// Mercado Libre es la fuente de verdad de los mensajes; aquí solo se orquesta
// el acceso del operador con el token de la empresa dueña del pedido y se
// normaliza la conversación para la interfaz.
import { MERCADO_LIBRE_MESSAGE_MAX_LENGTH } from '@zentofact/mercado-libre-api';

const MESSAGE_PAGE_LIMIT = 50;
const MAX_UNREAD_ORDER_IDS = 300;

const BLOCKED_REASONS = new Map([
  ['blocked_by_cancelled_order', 'cancelled'],
  ['blocked_by_cancelled_order_by_fraud', 'cancelled'],
  ['blocked_by_cancelled_order_hidden', 'cancelled'],
  ['blocked_by_mediation', 'mediation'],
  ['blocked_by_mediation_fbm', 'mediation'],
  ['blocked_by_fulfillment', 'fulfillment'],
  ['blocked_by_time', 'time'],
  ['blocked_by_payment', 'payment'],
  ['blocked_by_buyer', 'buyer'],
]);

function loadCore() {
  return import('@zentofact/core');
}

function text(value) {
  return String(value ?? '').trim();
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function unreadOrderIds(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const ids = [];
  for (const entry of list) {
    const id = Number(String(entry).trim());
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_UNREAD_ORDER_IDS);
}

async function loadChatOrder(orderId, db) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) throw httpError('Pedido inválido.', 400);
  const result = await db.query(
    `select o.id, o.company_id, o.external_order_id, o.external_order_number,
            o.order_status, o.fulfillment_status, o.customer, o.metadata,
            channel.code as channel_code
       from orders o
       join order_channel_accounts account on account.id = o.channel_account_id
       join order_channels channel on channel.id = account.channel_id
      where o.id = $1`,
    [id],
  );
  const order = result.rows[0];
  if (!order) throw httpError('No encontramos el pedido.', 404);
  if (order.channel_code !== 'mercado_libre') throw httpError('Este pedido no es de Mercado Libre.', 400);
  return order;
}

async function chatContext(orderId, dependencies = {}) {
  const core = dependencies.core || await loadCore();
  const db = dependencies.db || core.pool;
  const order = await (dependencies.loadOrder || loadChatOrder)(orderId, db);
  const getCompany = dependencies.getCompany || core.getCompany;
  const company = await getCompany(Number(order.company_id));
  if (!company) throw httpError('No encontramos la empresa del pedido.', 404);
  const tokens = dependencies.tokens || await import('./mercado-libre-tokens.js');
  const client = await (dependencies.clientForCompany || tokens.mercadoLibreClientForCompany)(company, dependencies);
  const sellerId = text(company.mercadoLibreUserId || company.mercado_libre_user_id);
  if (!sellerId) throw httpError('La empresa no tiene Mercado Libre conectado.', 400);
  const packId = text(order.metadata?.packId) || text(order.external_order_id);
  if (!packId) throw httpError('El pedido no tiene conversación de Mercado Libre.', 400);
  return { core, db, order, company, client, sellerId, packId };
}

function messageDirection(message, sellerId, buyerId) {
  const fromUserId = text(message.fromUserId);
  if (!fromUserId || fromUserId === '0') return 'system';
  if (fromUserId === sellerId) return 'seller';
  if (buyerId) return fromUserId === buyerId ? 'buyer' : 'system';
  return 'buyer';
}

function mapMessage(message, sellerId, buyerId) {
  return {
    id: message.messageId,
    direction: messageDirection(message, sellerId, buyerId),
    text: message.text,
    sentAt: message.createdAt,
    readAt: message.readAt,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.attachmentId,
      name: attachment.filename || 'Adjunto',
      size: attachment.size,
      contentType: attachment.contentType,
    })),
  };
}

function buyerIdFromMessages(messages, sellerId) {
  for (const message of messages) {
    const fromUserId = text(message.fromUserId);
    if (fromUserId && fromUserId !== '0' && fromUserId !== sellerId) return fromUserId;
  }
  return null;
}

function conversationBlock(order, conversationStatus) {
  if (order.order_status === 'cancelled' || order.fulfillment_status === 'cancelled') {
    return { reason: 'cancelled', substatus: 'blocked_by_cancelled_order' };
  }
  if (!conversationStatus || conversationStatus.status !== 'blocked') return null;
  const substatus = text(conversationStatus.substatus) || null;
  return { reason: BLOCKED_REASONS.get(substatus) || 'other', substatus };
}

async function resolveBuyerId(context, dependencies = {}) {
  const stored = text(context.order.metadata?.buyerId);
  if (stored) return stored;
  try {
    const order = await context.client.getOrder(text(context.order.external_order_id));
    const buyerId = text(order?.buyerId);
    if (buyerId) return buyerId;
  } catch {
    // Si no se pudo leer la orden, el último recurso es la conversación.
  }
  const page = await context.client.getPackMessages({
    packId: context.packId,
    sellerId: context.sellerId,
    markAsRead: false,
    limit: MESSAGE_PAGE_LIMIT,
  });
  return buyerIdFromMessages(page.messages, context.sellerId);
}

export async function getOrderConversation(input = {}, dependencies = {}) {
  const context = await chatContext(input.orderId, dependencies);
  const markAsRead = input.markAsRead !== false;
  const page = await context.client.getPackMessages({
    packId: context.packId,
    sellerId: context.sellerId,
    markAsRead,
    limit: MESSAGE_PAGE_LIMIT,
  });
  const buyerId = buyerIdFromMessages(page.messages, context.sellerId)
    || text(context.order.metadata?.buyerId)
    || null;
  const customer = context.order.customer && typeof context.order.customer === 'object'
    ? context.order.customer
    : {};
  return {
    orderId: Number(context.order.id),
    orderNumber: text(context.order.external_order_number),
    packId: context.packId,
    companyId: Number(context.order.company_id),
    sellerId: context.sellerId,
    buyerId,
    buyerName: text(customer.name) || null,
    stage: text(context.order.fulfillment_status),
    blocked: conversationBlock(context.order, page.conversationStatus),
    conversation: {
      status: page.conversationStatus?.status ?? null,
      substatus: page.conversationStatus?.substatus ?? null,
      statusDate: page.conversationStatus?.statusDate ?? null,
      claimId: page.conversationStatus?.claimId ?? null,
      shippingId: page.conversationStatus?.shippingId ?? null,
    },
    sellerMaxMessageLength: page.sellerMaxMessageLength ?? MERCADO_LIBRE_MESSAGE_MAX_LENGTH,
    messages: page.messages.map((message) => mapMessage(message, context.sellerId, buyerId)),
  };
}

export async function sendOrderMessage(input = {}, dependencies = {}) {
  const body = text(input.text);
  if (!body) throw httpError('Escribe un mensaje.', 400);
  if (body.length > MERCADO_LIBRE_MESSAGE_MAX_LENGTH) {
    throw httpError(`El mensaje supera los ${MERCADO_LIBRE_MESSAGE_MAX_LENGTH} caracteres.`, 400);
  }
  const context = await chatContext(input.orderId, dependencies);
  if (context.order.order_status === 'cancelled' || context.order.fulfillment_status === 'cancelled') {
    throw httpError('El pedido está cancelado; Mercado Libre no permite enviar mensajes.', 409);
  }
  const toUserId = await resolveBuyerId(context, dependencies);
  if (!toUserId) {
    throw httpError('Todavía no podemos identificar al comprador. Cuando te escriba podrás responderle.', 409);
  }
  const attachmentId = text(input.attachmentId);
  const message = await context.client.sendPackMessage({
    packId: context.packId,
    sellerId: context.sellerId,
    fromUserId: context.sellerId,
    toUserId,
    text: body,
    attachments: attachmentId ? [attachmentId] : undefined,
  });
  return {
    sent: true,
    message: message ? mapMessage(message, context.sellerId, toUserId) : null,
  };
}

export async function uploadOrderAttachment(input = {}, dependencies = {}) {
  const file = input.file;
  if (!(file instanceof Uint8Array) || !file.byteLength) throw httpError('El adjunto está vacío.', 400);
  const filename = text(input.filename);
  if (!filename) throw httpError('Falta el nombre del archivo.', 400);
  const context = await chatContext(input.orderId, dependencies);
  const upload = await context.client.uploadMessageAttachment({
    file,
    filename,
    contentType: text(input.contentType) || undefined,
    siteId: text(context.company.mercadoLibreSiteId || context.company.mercado_libre_site_id) || undefined,
  });
  return { attachmentId: upload.attachmentId, name: filename, size: file.byteLength };
}

export async function downloadOrderAttachment(input = {}, dependencies = {}) {
  const attachmentId = text(input.attachmentId);
  if (!attachmentId) throw httpError('Falta el adjunto.', 400);
  const context = await chatContext(input.orderId, dependencies);
  const file = await context.client.getMessageAttachment(attachmentId);
  return { bytes: file.bytes, contentType: file.contentType };
}

export async function listUnreadMessages(input = {}, dependencies = {}) {
  const orderIds = unreadOrderIds(input.orderIds);
  const counts = Object.fromEntries(orderIds.map((id) => [id, 0]));
  if (!orderIds.length) return { counts };

  const core = dependencies.core || await loadCore();
  const db = dependencies.db || core.pool;
  const result = await db.query(
    `select o.id, o.company_id,
            coalesce(nullif(o.metadata->>'packId', ''), o.external_order_id) as pack_id
       from orders o
       join order_channel_accounts account on account.id = o.channel_account_id
       join order_channels channel on channel.id = account.channel_id
      where channel.code = 'mercado_libre' and o.id = any($1::bigint[])`,
    [orderIds],
  );
  if (!result.rows.length) return { counts };

  const byCompany = new Map();
  for (const row of result.rows) {
    const companyId = Number(row.company_id);
    if (!byCompany.has(companyId)) byCompany.set(companyId, []);
    byCompany.get(companyId).push(row);
  }

  const getCompany = dependencies.getCompany || core.getCompany;
  const tokens = dependencies.tokens || await import('./mercado-libre-tokens.js');
  const clientForCompany = dependencies.clientForCompany || tokens.mercadoLibreClientForCompany;
  await Promise.all([...byCompany.entries()].map(async ([companyId, rows]) => {
    try {
      const company = await getCompany(companyId);
      if (!company) return;
      const client = await clientForCompany(company, dependencies);
      const conversations = await client.listUnreadPackMessages({ role: 'seller' });
      const unreadByPack = new Map(conversations.map((entry) => [entry.packId, entry.count]));
      for (const row of rows) {
        counts[Number(row.id)] = unreadByPack.get(text(row.pack_id)) || 0;
      }
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'mercado_libre.unread_failed',
        companyId,
        message: String(error?.message || error),
      }));
    }
  }));
  return { counts };
}
