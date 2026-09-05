import type {
  MercadoLibreApiClientOptions,
  MercadoLibreBillingInfo,
  MercadoLibreItem,
  MercadoLibreItemPage,
  MercadoLibreOrder,
  MercadoLibreOrderPage,
  MercadoLibreShipment,
  MercadoLibreUser,
  SearchItemsOptions,
  SearchOrdersOptions,
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
    if (this.baseUrl.protocol !== 'https:') throw new Error('La URL de Mercado Libre debe usar HTTPS.');
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

  async getShipment(shipmentId: string): Promise<MercadoLibreShipment> {
    const id = encodeURIComponent(requiredId(shipmentId, 'shipmentId'));
    const shipment = normalizeShipment(await this.getJson(`/shipments/${id}`, {
      'x-format-new': 'true',
    }));
    if (!shipment) throw new Error('Mercado Libre devolvió un envío inválido.');
    return shipment;
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
  return {
    orderId,
    packId: nonEmptyText(order.pack_id),
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
