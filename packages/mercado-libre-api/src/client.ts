import type {
  MercadoLibreApiClientOptions,
  MercadoLibreBillingInfo,
  MercadoLibreConversationStatus,
  MercadoLibreItem,
  MercadoLibreItemPage,
  MercadoLibreMessage,
  MercadoLibreMessageAttachment,
  MercadoLibreMessageAttachmentUpload,
  MercadoLibreMessageResource,
  MercadoLibreOrder,
  MercadoLibreOrderPage,
  MercadoLibrePackMessages,
  MercadoLibreShipment,
  MercadoLibreUnreadConversation,
  MercadoLibreUser,
  ListUnreadMessagesOptions,
  PackMessagesOptions,
  SearchItemsOptions,
  SearchOrdersOptions,
  SendPackMessageOptions,
  UploadMessageAttachmentOptions,
} from './types.js';
import {
  DEFAULT_API_BASE,
  attributeValue,
  finiteNumber,
  isoDate,
  nonEmptyText,
  objectRecord,
  providerError,
  readJson,
} from './http.js';

const MAX_LIMIT = 50;
/** Límite de caracteres que Mercado Libre acepta para un mensaje del vendedor. */
export const MERCADO_LIBRE_MESSAGE_MAX_LENGTH = 350;
const MAX_MESSAGE_LIMIT = 100;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf', 'text/plain']);

export class MercadoLibreApiClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly accessToken: string;
  readonly siteId: string;

  constructor(options: MercadoLibreApiClientOptions) {
    const token = nonEmptyText(options.accessToken);
    if (!token) throw new Error('Falta el access token de Mercado Libre.');
    this.accessToken = token;
    this.baseUrl = new URL(options.baseUrl?.trim() || DEFAULT_API_BASE);
    if (!isAllowedMercadoLibreBase(this.baseUrl)) {
      throw new Error('La URL de Mercado Libre debe usar HTTPS.');
    }
    this.fetchImpl = options.fetchImpl || fetch;
    this.siteId = nonEmptyText(options.siteId) || 'MPE';
  }

  async getMe(): Promise<MercadoLibreUser> {
    return normalizeUser(await this.getJson('/users/me'));
  }

  async getUser(userId: string): Promise<MercadoLibreUser> {
    const id = encodeURIComponent(requiredId(userId, 'userId'));
    return normalizeUser(await this.getJson(`/users/${id}`));
  }

  async searchOrders(options: SearchOrdersOptions): Promise<MercadoLibreOrderPage> {
    const sellerId = requiredId(options.sellerId, 'sellerId');
    const limit = validLimit(options.limit);
    const offset = validOffset(options.offset);
    const url = this.url('/orders/search');
    url.searchParams.set('seller', sellerId);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sort', options.sort || 'date_desc');
    if (options.status) url.searchParams.set('order.status', options.status);
    addDate(url, 'order.date_created.from', options.createdFrom);
    addDate(url, 'order.date_created.to', options.createdTo);
    addDate(url, 'order.date_last_updated.from', options.updatedFrom);
    addDate(url, 'order.date_last_updated.to', options.updatedTo);
    const body = objectRecord(await this.getJson(url));
    if (!body || !Array.isArray(body.results)) throw new Error('Mercado Libre no devolvió la lista de pedidos.');
    const paging = objectRecord(body.paging) || {};
    return {
      orders: body.results.map(normalizeOrder).filter((order): order is MercadoLibreOrder => order !== null),
      total: finiteNumber(paging.total) ?? body.results.length,
      offset: finiteNumber(paging.offset) ?? offset,
      limit: finiteNumber(paging.limit) ?? limit,
    };
  }

  async getOrder(orderId: string): Promise<MercadoLibreOrder> {
    const id = encodeURIComponent(requiredId(orderId, 'orderId'));
    const order = normalizeOrder(await this.getJson(`/orders/${id}`));
    if (!order) throw new Error('Mercado Libre devolvió una orden inválida.');
    return order;
  }

  async getPack(packId: string): Promise<unknown> {
    const id = encodeURIComponent(requiredId(packId, 'packId'));
    return this.getJson(`/packs/${id}`);
  }

  /**
   * Mensajes posventa de un pack. Mercado Libre marca la conversación como
   * leída salvo que se envíe markAsRead=false; el panel la marca al abrirse.
   */
  async getPackMessages(options: PackMessagesOptions): Promise<MercadoLibrePackMessages> {
    const packId = requiredId(options.packId, 'packId');
    const sellerId = requiredId(options.sellerId, 'sellerId');
    const url = this.url(`/messages/packs/${encodeURIComponent(packId)}/sellers/${encodeURIComponent(sellerId)}`);
    url.searchParams.set('tag', 'post_sale');
    if (options.markAsRead === false) url.searchParams.set('mark_as_read', 'false');
    if (options.offset != null) url.searchParams.set('offset', String(validOffset(options.offset)));
    if (options.limit != null) url.searchParams.set('limit', String(validMessageLimit(options.limit)));
    return normalizePackMessages(packId, sellerId, await this.getJson(url));
  }

  async getMessage(messageId: string): Promise<MercadoLibreMessage> {
    const id = requiredId(messageId, 'messageId');
    const url = this.url(`/messages/${encodeURIComponent(id)}`);
    url.searchParams.set('tag', 'post_sale');
    const message = normalizeMessage(await this.getJson(url));
    if (!message) throw new Error('Mercado Libre devolvió un mensaje inválido.');
    return message;
  }

  async sendPackMessage(options: SendPackMessageOptions): Promise<MercadoLibreMessage | null> {
    const packId = requiredId(options.packId, 'packId');
    const sellerId = requiredId(options.sellerId, 'sellerId');
    const fromUserId = requiredId(options.fromUserId, 'fromUserId');
    const toUserId = requiredId(options.toUserId, 'toUserId');
    const text = nonEmptyText(options.text);
    if (!text) throw new Error('Falta el texto del mensaje.');
    if (text.length > MERCADO_LIBRE_MESSAGE_MAX_LENGTH) {
      throw new Error(`El mensaje supera los ${MERCADO_LIBRE_MESSAGE_MAX_LENGTH} caracteres de Mercado Libre.`);
    }
    const attachments = [...new Set((options.attachments || [])
      .map((value) => nonEmptyText(value))
      .filter((value): value is string => Boolean(value)))];
    const url = this.url(`/messages/packs/${encodeURIComponent(packId)}/sellers/${encodeURIComponent(sellerId)}`);
    url.searchParams.set('tag', 'post_sale');
    const body: Record<string, unknown> = {
      from: { user_id: fromUserId },
      to: { user_id: toUserId },
      text,
    };
    if (attachments.length) body.attachments = attachments;
    return normalizeMessage(await this.postJson(url, body));
  }

  /** Sube un adjunto y devuelve la key que debe asociarse al mensaje dentro de 48 h. */
  async uploadMessageAttachment(options: UploadMessageAttachmentOptions): Promise<MercadoLibreMessageAttachmentUpload> {
    const filename = nonEmptyText(options.filename);
    if (!filename) throw new Error('Falta el nombre del archivo.');
    const file = options.file;
    if (!(file instanceof Uint8Array) || file.byteLength === 0) throw new Error('El adjunto está vacío.');
    if (file.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('El adjunto supera los 25 MB que admite Mercado Libre.');
    const contentType = normalizeAttachmentContentType(options.contentType, filename);
    if (!contentType) throw new Error('Mercado Libre solo admite adjuntos JPG, PNG, PDF o TXT.');
    const url = this.url('/messages/attachments');
    url.searchParams.set('tag', 'post_sale');
    url.searchParams.set('site_id', nonEmptyText(options.siteId) || this.siteId);
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(file)], { type: contentType }), filename);
    const payload = await this.postForm(url, form);
    const record = objectRecord(payload);
    const attachmentId = nonEmptyText(record?.id);
    if (!attachmentId) throw new Error('Mercado Libre no devolvió el id del adjunto.');
    return { attachmentId, raw: payload };
  }

  /** Descarga un adjunto (mismo token del vendedor) para mostrarlo sin exponerlo al navegador. */
  async getMessageAttachment(attachmentId: string, siteId = this.siteId): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const id = requiredId(attachmentId, 'attachmentId');
    const url = this.url(`/messages/attachments/${encodeURIComponent(id)}`);
    url.searchParams.set('tag', 'post_sale');
    url.searchParams.set('site_id', nonEmptyText(siteId) || this.siteId);
    this.assertSandboxIsolation(url);
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: '*/*',
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    if (!response.ok) throw providerError(response.status, await readJson(response));
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error('Mercado Libre devolvió un adjunto vacío.');
    return { bytes, contentType: nonEmptyText(response.headers.get('content-type')) };
  }

  /**
   * Conversaciones con mensajes pendientes de leer, sin marcarlas como leídas.
   * Mercado Libre devuelve hasta 500 conversaciones por llamada.
   */
  async listUnreadPackMessages(options: ListUnreadMessagesOptions = {}): Promise<MercadoLibreUnreadConversation[]> {
    const url = this.url('/messages/unread');
    url.searchParams.set('tag', 'post_sale');
    url.searchParams.set('role', options.role === 'buyer' ? 'buyer' : 'seller');
    const root = objectRecord(await this.getJson(url)) || {};
    const results = Array.isArray(root.results) ? root.results : [];
    const conversations: MercadoLibreUnreadConversation[] = [];
    for (const entry of results) {
      const record = objectRecord(entry);
      const resource = nonEmptyText(record?.resource);
      if (!resource) continue;
      const parsed = /^\/packs\/([^/]+)\/sellers\/([^/]+)$/.exec(resource);
      if (!parsed) continue;
      conversations.push({
        resource,
        packId: parsed[1],
        sellerId: parsed[2],
        count: finiteNumber(record?.count) ?? 0,
      });
    }
    return conversations;
  }

  async getShipment(shipmentId: string): Promise<MercadoLibreShipment> {
    const id = encodeURIComponent(requiredId(shipmentId, 'shipmentId'));
    const shipment = normalizeShipment(await this.getJson(`/shipments/${id}`, {
      'x-format-new': 'true',
    }));
    if (!shipment) throw new Error('Mercado Libre devolvió un envío inválido.');
    return shipment;
  }

  async getShipmentLabels(shipmentIds: string[], responseType: 'pdf' | 'zpl2' = 'pdf'): Promise<Uint8Array> {
    const ids = [...new Set(shipmentIds.map((value) => String(value || '').trim()).filter(Boolean))];
    if (!ids.length) throw new Error('Faltan shipment_ids para la etiqueta.');
    if (ids.length > 50) throw new Error('Mercado Libre admite hasta 50 envíos por etiqueta.');
    const url = this.url('/shipment_labels');
    url.searchParams.set('shipment_ids', ids.join(','));
    url.searchParams.set('response_type', responseType === 'zpl2' ? 'zpl2' : 'pdf');
    return this.getBytes(url, {
      Accept: responseType === 'zpl2' ? 'text/plain' : 'application/pdf',
    });
  }

  async getBillingInfo(billingInfoId: string, siteId = this.siteId): Promise<MercadoLibreBillingInfo> {
    const site = encodeURIComponent(requiredId(siteId, 'siteId'));
    const id = encodeURIComponent(requiredId(billingInfoId, 'billingInfoId'));
    return normalizeBillingInfo(await this.getJson(`/orders/billing-info/${site}/${id}`));
  }

  async searchItems(options: SearchItemsOptions): Promise<MercadoLibreItemPage> {
    const sellerId = requiredId(options.sellerId, 'sellerId');
    const limit = validLimit(options.limit);
    const offset = validOffset(options.offset);
    const url = this.url(`/users/${encodeURIComponent(sellerId)}/items/search`);
    if (options.searchType === 'scan') {
      url.searchParams.set('search_type', 'scan');
      if (options.scrollId) url.searchParams.set('scroll_id', options.scrollId);
    } else {
      url.searchParams.set('offset', String(offset));
    }
    url.searchParams.set('limit', String(limit));
    if (options.status) url.searchParams.set('status', options.status);
    if (options.userProductId) url.searchParams.set('user_product_id', options.userProductId);
    const body = objectRecord(await this.getJson(url));
    if (!body || !Array.isArray(body.results)) throw new Error('Mercado Libre no devolvió las publicaciones.');
    const paging = objectRecord(body.paging) || {};
    const itemIds = body.results.map((value) => nonEmptyText(value)).filter((value): value is string => Boolean(value));
    return {
      itemIds,
      items: [],
      total: finiteNumber(paging.total) ?? itemIds.length,
      offset: finiteNumber(paging.offset) ?? offset,
      limit: finiteNumber(paging.limit) ?? limit,
      scrollId: nonEmptyText(body.scroll_id),
    };
  }

  async getItem(itemId: string): Promise<MercadoLibreItem> {
    const items = await this.getItems([itemId]);
    if (!items[0]) throw new Error('Mercado Libre devolvió una publicación inválida.');
    return items[0];
  }

  async getItems(itemIds: string[]): Promise<MercadoLibreItem[]> {
    const ids = [...new Set(itemIds.map((value) => String(value || '').trim()).filter(Boolean))];
    const items: MercadoLibreItem[] = [];
    for (let start = 0; start < ids.length; start += 20) {
      const chunk = ids.slice(start, start + 20);
      const url = this.url('/items');
      url.searchParams.set('ids', chunk.join(','));
      const body = await this.getJson(url);
      const rows = Array.isArray(body) ? body : [body];
      for (const row of rows) {
        const wrapped = objectRecord(row);
        const payload = wrapped && ('body' in wrapped || 'code' in wrapped) ? wrapped.body : row;
        const item = normalizeItem(payload);
        if (item) items.push(item);
      }
    }
    return items;
  }

  private url(path: string) {
    return new URL(path, this.baseUrl);
  }

  private async getJson(pathOrUrl: string | URL, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const url = typeof pathOrUrl === 'string' ? this.url(pathOrUrl) : pathOrUrl;
    this.assertSandboxIsolation(url);
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...extraHeaders,
      },
    });
    const body = await readJson(response);
    if (!response.ok) throw providerError(response.status, body);
    return body;
  }

  private async getBytes(pathOrUrl: string | URL, extraHeaders: Record<string, string> = {}): Promise<Uint8Array> {
    const url = typeof pathOrUrl === 'string' ? this.url(pathOrUrl) : pathOrUrl;
    this.assertSandboxIsolation(url);
    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...extraHeaders,
      },
    });
    if (!response.ok) throw providerError(response.status, await readJson(response));
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error('Mercado Libre devolvió una etiqueta vacía.');
    return bytes;
  }

  private async postJson(pathOrUrl: string | URL, body: unknown): Promise<unknown> {
    const url = typeof pathOrUrl === 'string' ? this.url(pathOrUrl) : pathOrUrl;
    this.assertSandboxIsolation(url);
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (!response.ok) throw providerError(response.status, payload);
    return payload;
  }

  private async postForm(pathOrUrl: string | URL, form: FormData): Promise<unknown> {
    const url = typeof pathOrUrl === 'string' ? this.url(pathOrUrl) : pathOrUrl;
    this.assertSandboxIsolation(url);
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: form,
    });
    const payload = await readJson(response);
    if (!response.ok) throw providerError(response.status, payload);
    return payload;
  }

  private assertSandboxIsolation(url: URL) {
    if (!this.accessToken.startsWith('SANDBOX-')) return;
    if (this.fetchImpl !== fetch) return;
    const host = url.hostname.toLowerCase();
    if (host === 'api.mercadolibre.com' || host.endsWith('.mercadolibre.com')) {
      throw new Error('Un token sandbox de Mercado Libre no puede usarse contra la API real.');
    }
  }
}

function isAllowedMercadoLibreBase(url: URL) {
  if (url.protocol === 'https:') return true;
  const host = url.hostname.toLowerCase();
  return url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '::1');
}

function requiredId(value: unknown, field: string) {
  const text = nonEmptyText(value);
  if (!text) throw new Error(`Falta ${field}.`);
  return text;
}

function validLimit(value: number | undefined) {
  if (value == null) return MAX_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new Error('limit debe ser un entero entre 1 y 50.');
  }
  return value;
}

function validOffset(value: number | undefined) {
  if (value == null) return 0;
  if (!Number.isInteger(value) || value < 0) throw new Error('offset debe ser un entero positivo.');
  return value;
}

function addDate(url: URL, key: string, value: string | undefined) {
  const text = nonEmptyText(value);
  if (!text) return;
  url.searchParams.set(key, hourPrecision(text));
}

/** ML pide precisión de hora y descarta minutos/segundos. */
export function hourPrecision(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const iso = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0,
  )).toISOString();
  return iso.replace(/\.\d{3}Z$/, '.000-00:00');
}

export function extractSellerSku(item: unknown): string | null {
  const record = objectRecord(item);
  if (!record) return null;
  return attributeValue(record.attributes, 'SELLER_SKU')
    || nonEmptyText(record.seller_sku);
}

export function extractOrderItemSellerSku(line: unknown): string | null {
  const record = objectRecord(line);
  const item = objectRecord(record?.item) || {};
  const variations = Array.isArray(item.variations) ? item.variations : [];
  const variation = objectRecord(variations[0]);
  return extractSellerSku(variation)
    || nonEmptyText(item.seller_sku)
    || extractSellerSku(item);
}

function normalizeOrder(value: unknown): MercadoLibreOrder | null {
  const order = objectRecord(value);
  if (!order) return null;
  const orderId = nonEmptyText(order.id);
  if (!orderId) return null;
  const shipping = objectRecord(order.shipping);
  const buyer = objectRecord(order.buyer);
  return {
    orderId,
    packId: nonEmptyText(order.pack_id),
    buyerId: nonEmptyText(buyer?.id),
    status: nonEmptyText(order.status) || 'unknown',
    createdAt: isoDate(order.date_created),
    updatedAt: isoDate(order.last_updated ?? order.date_last_updated),
    closedAt: isoDate(order.date_closed),
    currency: nonEmptyText(order.currency_id) || 'PEN',
    total: finiteNumber(order.total_amount ?? order.paid_amount),
    paidAmount: finiteNumber(order.paid_amount),
    shippingId: nonEmptyText(shipping?.id ?? order.shipping_id),
    raw: value,
  };
}

function normalizeItem(value: unknown): MercadoLibreItem | null {
  const item = objectRecord(value);
  if (!item) return null;
  const itemId = nonEmptyText(item.id);
  if (!itemId) return null;
  const pictures = Array.isArray(item.pictures) ? item.pictures : [];
  const firstPicture = objectRecord(pictures[0]);
  const variations = Array.isArray(item.variations) ? item.variations : [];
  const firstVariation = objectRecord(variations[0]);
  return {
    itemId,
    sellerSku: extractSellerSku(firstVariation) || extractSellerSku(item),
    title: nonEmptyText(item.title),
    status: nonEmptyText(item.status),
    availableQuantity: finiteNumber(item.available_quantity),
    price: finiteNumber(item.price),
    permalink: nonEmptyText(item.permalink),
    userProductId: nonEmptyText(item.user_product_id),
    catalogProductId: nonEmptyText(item.catalog_product_id),
    variationId: nonEmptyText(firstVariation?.id),
    pictureUrl: nonEmptyText(firstPicture?.secure_url ?? firstPicture?.url),
    raw: value,
  };
}

function normalizeShipment(value: unknown): MercadoLibreShipment | null {
  const shipment = objectRecord(value);
  if (!shipment) return null;
  const shipmentId = nonEmptyText(shipment.id);
  if (!shipmentId) return null;
  return {
    shipmentId,
    status: nonEmptyText(shipment.status),
    substatus: nonEmptyText(shipment.substatus),
    mode: nonEmptyText(shipment.mode),
    logisticType: nonEmptyText(shipment.logistic_type),
    trackingNumber: nonEmptyText(shipment.tracking_number),
    raw: value,
  };
}

function normalizeBillingInfo(value: unknown): MercadoLibreBillingInfo {
  const root = objectRecord(value) || {};
  const buyer = objectRecord(root.buyer) || {};
  const billing = objectRecord(buyer.billing_info) || {};
  const identification = objectRecord(billing.identification) || {};
  const attributes = objectRecord(billing.attributes) || {};
  return {
    siteId: nonEmptyText(root.site_id),
    name: nonEmptyText(billing.name),
    lastName: nonEmptyText(billing.last_name),
    documentType: nonEmptyText(identification.type),
    documentNumber: nonEmptyText(identification.number),
    customerType: nonEmptyText(attributes.cust_type ?? attributes.customer_type),
    raw: value,
  };
}

function normalizeUser(value: unknown): MercadoLibreUser {
  const user = objectRecord(value) || {};
  const userId = nonEmptyText(user.id);
  if (!userId) throw new Error('Mercado Libre no devolvió el user_id.');
  return {
    userId,
    nickname: nonEmptyText(user.nickname),
    siteId: nonEmptyText(user.site_id),
    raw: value,
  };
}

function normalizePackMessages(packId: string, sellerId: string, value: unknown): MercadoLibrePackMessages {
  const root = objectRecord(value) || {};
  const paging = objectRecord(root.paging) || {};
  const messages = Array.isArray(root.messages)
    ? root.messages
      .map((entry) => normalizeMessage(entry))
      .filter((message): message is MercadoLibreMessage => message !== null)
    : [];
  return {
    packId,
    sellerId,
    messages,
    total: finiteNumber(paging.total) ?? messages.length,
    offset: finiteNumber(paging.offset) ?? 0,
    limit: finiteNumber(paging.limit) ?? messages.length,
    conversationStatus: normalizeConversationStatus(root.conversation_status),
    sellerMaxMessageLength: finiteNumber(root.seller_max_message_length),
    raw: value,
  };
}

function normalizeConversationStatus(value: unknown): MercadoLibreConversationStatus | null {
  const record = objectRecord(value);
  if (!record) return null;
  return {
    path: nonEmptyText(record.path),
    status: nonEmptyText(record.status),
    substatus: nonEmptyText(record.substatus),
    statusDate: isoDate(record.status_date),
    claimId: nonEmptyText(record.claim_id),
    shippingId: nonEmptyText(record.shipping_id),
  };
}

function normalizeMessage(value: unknown): MercadoLibreMessage | null {
  const record = objectRecord(value);
  if (!record) return null;
  const messageId = nonEmptyText(record.id ?? record.message_id);
  if (!messageId) return null;
  const from = objectRecord(record.from) || {};
  const to = objectRecord(record.to) || {};
  const textRecord = objectRecord(record.text);
  const dates = objectRecord(record.message_date) || {};
  const moderation = objectRecord(record.message_moderation) || objectRecord(record.moderation) || {};
  return {
    messageId,
    fromUserId: nonEmptyText(from.user_id) ?? nonEmptyText(record.from_user_id),
    toUserId: nonEmptyText(to.user_id) ?? nonEmptyText(record.to_user_id),
    text: (textRecord ? nonEmptyText(textRecord.plain) : nonEmptyText(record.text)) || '',
    status: nonEmptyText(record.status),
    moderationStatus: nonEmptyText(moderation.status),
    createdAt: isoDate(dates.created ?? record.date_created ?? record.date),
    readAt: isoDate(dates.read ?? record.date_read),
    attachments: normalizeMessageAttachments(record.message_attachments ?? record.attachments),
    resources: normalizeMessageResources(record.message_resources, record.resource, record.resource_id),
    raw: value,
  };
}

function normalizeMessageAttachments(value: unknown): MercadoLibreMessageAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: MercadoLibreMessageAttachment[] = [];
  for (const entry of value) {
    const record = objectRecord(entry);
    // En la lista del pack la key es "filename"; al subir un adjunto es "id".
    const attachmentId = nonEmptyText(record?.id ?? record?.attachment_id ?? record?.file_id)
      ?? nonEmptyText(record?.filename)
      ?? nonEmptyText(entry);
    if (!attachmentId) continue;
    attachments.push({
      attachmentId,
      filename: nonEmptyText(record?.original_filename ?? record?.name) ?? nonEmptyText(record?.filename),
      contentType: nonEmptyText(record?.content_type ?? record?.mimetype ?? record?.type),
      size: finiteNumber(record?.size),
    });
  }
  return attachments;
}

function normalizeMessageResources(value: unknown, resource: unknown, resourceId: unknown): MercadoLibreMessageResource[] {
  const resources: MercadoLibreMessageResource[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const record = objectRecord(entry);
      const id = nonEmptyText(record?.id);
      const name = nonEmptyText(record?.name);
      if (id && name) resources.push({ id, name });
    }
  }
  const singleId = nonEmptyText(resourceId);
  const singleName = nonEmptyText(resource);
  if (singleId && singleName) resources.push({ id: singleId, name: singleName });
  return resources;
}

function validMessageLimit(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_MESSAGE_LIMIT) {
    throw new Error(`limit debe ser un entero entre 1 y ${MAX_MESSAGE_LIMIT}.`);
  }
  return value;
}

function normalizeAttachmentContentType(declared: unknown, filename: string): string | null {
  const provided = nonEmptyText(declared)?.toLowerCase();
  const normalized = provided === 'image/jpg' ? 'image/jpeg' : provided;
  if (normalized && ATTACHMENT_MIME_TYPES.has(normalized)) return normalized;
  const extension = filename.toLowerCase().split('.').pop() || '';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'txt') return 'text/plain';
  return null;
}

export function expandItemListings(item: MercadoLibreItem): MercadoLibreItem[] {
  const raw = objectRecord(item.raw);
  const variations = Array.isArray(raw?.variations) ? raw.variations : [];
  if (!variations.length) return [item];
  const listings: MercadoLibreItem[] = [];
  for (const variation of variations) {
    const record = objectRecord(variation);
    if (!record) continue;
    const sellerSku = extractSellerSku(record) || item.sellerSku;
    if (!sellerSku) continue;
    listings.push({
      ...item,
      sellerSku,
      variationId: nonEmptyText(record.id),
      availableQuantity: finiteNumber(record.available_quantity) ?? item.availableQuantity,
      raw: { ...raw, variation: record },
    });
  }
  return listings.length ? listings : [item];
}
