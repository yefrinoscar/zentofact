import type {
  ListOffersOptions,
  ListOrdersOptions,
  RipleyApiClientOptions,
  RipleyOffer,
  RipleyOfferPage,
  RipleyOrder,
  RipleyOrderPage,
  RipleySvcClientOptions,
  RipleySvcLabelOptions,
  RipleySvcLogisticsOrderOptions,
  RipleySvcManifestSchedule,
  RipleySvcPageOptions,
} from './types.js';

const MAX_PAGE_SIZE = 100;

export class RipleyApiClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RipleyApiClientOptions) {
    const baseUrl = new URL(options.baseUrl.trim());
    if (baseUrl.protocol !== 'https:') throw new Error('La URL de Ripley debe usar HTTPS.');
    if (!options.apiKey.trim()) throw new Error('Falta la API key de Ripley.');
    this.baseUrl = baseUrl;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async listOffers(options: ListOffersOptions = {}): Promise<RipleyOfferPage> {
    const max = validPageSize(options.max);
    const offset = validOffset(options.offset);
    const url = new URL('/api/offers', this.baseUrl);
    url.searchParams.set('max', String(max));
    url.searchParams.set('offset', String(offset));
    if (this.options.shopId != null && String(this.options.shopId).trim()) {
      url.searchParams.set('shop_id', String(this.options.shopId).trim());
    }
    if (options.offerStateCodes?.trim()) url.searchParams.set('offer_state_codes', options.offerStateCodes.trim());
    if (options.sku?.trim()) url.searchParams.set('sku', options.sku.trim());
    if (options.productId?.trim()) url.searchParams.set('product_id', options.productId.trim());
    if (options.favorite != null) url.searchParams.set('favorite', String(options.favorite));

    const response = await this.fetchImpl(url, {
      headers: { Accept: 'application/json', Authorization: this.options.apiKey },
    });
    const body = await readJson(response);
    if (!response.ok) throw providerError(response.status, body);
    const page = objectRecord(body);
    if (!page) throw new Error('Ripley devolvió una respuesta de ofertas inválida.');
    const rawOffers = page.offers;
    if (!Array.isArray(rawOffers)) throw new Error('Ripley no devolvió la lista de ofertas.');
    return {
      offers: rawOffers.map(normalizeOffer).filter((offer): offer is RipleyOffer => offer !== null),
      totalCount: finiteNumber(page.total_count ?? page.totalCount),
      offset,
      max,
    };
  }

  async listAllOffers(): Promise<RipleyOffer[]> {
    const offers: RipleyOffer[] = [];
    for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
      const page = await this.listOffers({ max: MAX_PAGE_SIZE, offset });
      offers.push(...page.offers);
      if (page.totalCount != null && page.offset + page.max >= page.totalCount) return offers;
      if (page.offers.length < MAX_PAGE_SIZE) return offers;
    }
  }

  async listOrders(options: ListOrdersOptions = {}): Promise<RipleyOrderPage> {
    const max = validPageSize(options.max);
    const offset = validOffset(options.offset);
    const url = new URL('/api/orders', this.baseUrl);
    url.searchParams.set('max', String(max));
    url.searchParams.set('offset', String(offset));
    this.addShopId(url);
    addCsv(url, 'order_ids', options.orderIds);
    addCsv(url, 'order_state_codes', options.orderStateCodes);
    addText(url, 'start_date', options.startDate);
    addText(url, 'end_date', options.endDate);
    addText(url, 'start_update_date', options.startUpdateDate);
    addText(url, 'end_update_date', options.endUpdateDate);

    const body = await this.getJson(url);
    const page = objectRecord(body);
    if (!page || !Array.isArray(page.orders)) throw new Error('Ripley no devolvió la lista de pedidos.');
    return {
      orders: page.orders.map(normalizeOrder).filter((order): order is RipleyOrder => order !== null),
      totalCount: finiteNumber(page.total_count ?? page.totalCount) ?? page.orders.length,
      offset,
      max,
    };
  }

  async listAllOrders(options: Omit<ListOrdersOptions, 'max' | 'offset'> = {}): Promise<RipleyOrder[]> {
    const orders: RipleyOrder[] = [];
    for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
      const page = await this.listOrders({ ...options, max: MAX_PAGE_SIZE, offset });
      orders.push(...page.orders);
      if (offset + MAX_PAGE_SIZE >= page.totalCount || page.orders.length < MAX_PAGE_SIZE) return orders;
    }
  }

  private addShopId(url: URL) {
    if (this.options.shopId != null && String(this.options.shopId).trim()) {
      url.searchParams.set('shop_id', String(this.options.shopId).trim());
    }
  }

  private async getJson(url: URL): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      headers: { Accept: 'application/json', Authorization: this.options.apiKey },
    });
    const body = await readJson(response);
    if (!response.ok) throw providerError(response.status, body);
    return body;
  }
}

/** Client for Ripley's separate Seller Vendor Center logistics API. */
export class RipleySvcClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private accessToken = '';

  constructor(private readonly options: RipleySvcClientOptions) {
    const baseUrl = new URL(options.baseUrl.trim());
    if (baseUrl.protocol !== 'https:') throw new Error('La URL de SVC Ripley debe usar HTTPS.');
    if (!options.username.trim() || !options.password) throw new Error('Faltan las credenciales de SVC Ripley.');
    this.baseUrl = baseUrl;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async listLogisticsOrders(options: RipleySvcLogisticsOrderOptions = {}): Promise<unknown> {
    const url = this.url('/api/v3/orders/order/list');
    url.searchParams.set('is_fast_management', 'true');
    addSvcPage(url, options);
    addText(url, 'order_id', options.orderId);
    addText(url, 'status_management', options.statusManagement);
    return this.authorizedJson(url);
  }

  async listLabels(options: RipleySvcLabelOptions = {}): Promise<unknown> {
    const url = this.url('/api/v7/label/labels');
    addSvcPage(url, options);
    addText(url, 'order_id', options.orderId);
    addText(url, 'find', options.find);
    return this.authorizedJson(url);
  }

  async listManifestEligibleLabels(options: RipleySvcPageOptions = {}): Promise<unknown> {
    const url = this.url('/bff/v1/manifest/label/list');
    url.searchParams.set('hasManifest', 'false');
    url.searchParams.set('active', 'true');
    addSvcPage(url, options);
    addText(url, 'order_id', options.orderId);
    return this.authorizedJson(url);
  }

  async listManifests(options: RipleySvcPageOptions = {}): Promise<unknown> {
    const url = this.url('/bff/v1/manifest/history/list');
    addSvcPage(url, options);
    addText(url, 'order_id', options.orderId);
    return this.authorizedJson(url);
  }

  async editPackages(orderId: string, packages: number): Promise<unknown> {
    const normalizedOrderId = nonEmptyText(orderId);
    if (!normalizedOrderId) throw new Error('Falta el identificador interno de la orden SVC.');
    if (!Number.isInteger(packages) || packages < 1) throw new Error('packages debe ser un entero positivo.');
    return this.authorizedJson(this.url('/api/v7/label/label/generate/edit/packages'), {
      method: 'POST',
      body: JSON.stringify({ label: { packages }, order: { _id: normalizedOrderId } }),
    });
  }

  async downloadLabels(documentIds: string[]): Promise<unknown> {
    const ids = documentIds.map(nonEmptyText).filter((value): value is string => value !== null);
    if (!ids.length) throw new Error('Selecciona al menos una etiqueta.');
    return this.authorizedJson(this.url('/api/v7/label/label/download/'), {
      method: 'POST',
      body: JSON.stringify({ orders: ids.map((documentId) => ({ document_id: documentId })) }),
    });
  }

  async scheduleManifest(payload: RipleySvcManifestSchedule): Promise<unknown> {
    if (!payload.warehouseAddress?.trim()) throw new Error('Falta la dirección de recojo.');
    return this.authorizedJson(this.url('/api/v1/manifest/schedule/generate'), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getManifest(manifestId: string): Promise<unknown> {
    return this.authorizedJson(this.manifestUrl(manifestId));
  }

  async downloadManifest(manifestId: string): Promise<unknown> {
    return this.authorizedJson(this.manifestUrl(manifestId, '/download'));
  }

  async detachManifestLabels(manifestId: string, labelIds: string[]): Promise<unknown> {
    const ids = labelIds.map(nonEmptyText).filter((value): value is string => value !== null);
    if (!ids.length) throw new Error('Selecciona al menos una etiqueta para desvincular.');
    return this.authorizedJson(this.manifestUrl(manifestId), {
      method: 'PATCH',
      body: JSON.stringify({ labels: ids.map((id) => ({ _id: id })) }),
    });
  }

  private url(path: string) {
    return new URL(path, this.baseUrl);
  }

  private manifestUrl(manifestId: string, suffix = '') {
    const id = nonEmptyText(manifestId);
    if (!id) throw new Error('Falta el identificador del manifiesto.');
    return this.url(`/bff/v1/manifest/${encodeURIComponent(id)}${suffix}`);
  }

  private async login() {
    const url = this.url('/api/current/auth/login/vendor');
    const credentials = encodeBasicCredentials(this.options.username, this.options.password);
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Basic ${credentials}` },
    });
    const body = await readJson(response);
    if (!response.ok) throw providerError(response.status, body);
    const record = objectRecord(body);
    const token = nonEmptyText(record?.access_token ?? record?.accessToken ?? record?.token);
    if (!token) throw new Error('SVC Ripley no devolvió un token de acceso.');
    this.accessToken = token;
  }

  private async authorizedJson(url: URL, init: RequestInit = {}): Promise<unknown> {
    if (!this.accessToken) await this.login();
    let response = await this.fetchImpl(url, this.authorizedInit(init));
    if (response.status === 401) {
      this.accessToken = '';
      await this.login();
      response = await this.fetchImpl(url, this.authorizedInit(init));
    }
    const body = await readJson(response);
    if (!response.ok) throw providerError(response.status, body);
    return body;
  }

  private authorizedInit(init: RequestInit): RequestInit {
    return {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
      },
    };
  }
}

function addSvcPage(url: URL, options: RipleySvcPageOptions) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 25;
  if (!Number.isInteger(page) || page < 1) throw new Error('page debe ser un entero positivo.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('limit debe ser un entero entre 1 y 200.');
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
}

function encodeBasicCredentials(username: string, password: string) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function addCsv(url: URL, key: string, values: string[] | undefined) {
  const normalized = values?.map((value) => String(value).trim()).filter(Boolean);
  if (normalized?.length) url.searchParams.set(key, normalized.join(','));
}

function addText(url: URL, key: string, value: string | undefined) {
  if (value?.trim()) url.searchParams.set(key, value.trim());
}

function validPageSize(value: number | undefined) {
  if (value == null) return MAX_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw new Error('max debe ser un entero entre 1 y 100.');
  return value;
}

function validOffset(value: number | undefined) {
  if (value == null) return 0;
  if (!Number.isInteger(value) || value < 0) throw new Error('offset debe ser un entero positivo.');
  return value;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function nonEmptyText(value: unknown): string | null {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text || null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOffer(value: unknown): RipleyOffer | null {
  const offer = objectRecord(value);
  if (!offer) return null;
  const sellerSku = nonEmptyText(offer.sku ?? offer.shop_sku ?? offer.shopSku);
  if (!sellerSku) return null;
  const pricing = objectRecord(offer.applicable_pricing ?? offer.applicablePricing);
  return {
    offerId: nonEmptyText(offer.offer_id ?? offer.offerId),
    sellerSku,
    productSku: nonEmptyText(offer.product_sku ?? offer.productSku ?? offer.product_id ?? offer.productId),
    productTitle: nonEmptyText(offer.product_title ?? offer.productTitle ?? offer.title),
    active: typeof offer.active === 'boolean' ? offer.active : null,
    quantity: finiteNumber(offer.quantity),
    price: finiteNumber(offer.price) ?? finiteNumber(pricing?.price),
    raw: value,
  };
}

function normalizeOrder(value: unknown): RipleyOrder | null {
  const order = objectRecord(value);
  if (!order) return null;
  const orderId = nonEmptyText(order.order_id ?? order.orderId);
  if (!orderId) return null;
  return {
    orderId,
    orderNumber: nonEmptyText(order.commercial_id ?? order.order_reference_for_seller ?? order.orderNumber) || orderId,
    status: nonEmptyText(order.order_state ?? order.status) || 'UNKNOWN',
    createdAt: isoDate(order.created_date ?? order.createdAt),
    updatedAt: isoDate(order.last_updated_date ?? order.updated_date ?? order.updatedAt),
    currency: nonEmptyText(order.currency_iso_code ?? order.currency) || 'PEN',
    total: finiteNumber(order.total_price ?? order.total),
    raw: value,
  };
}

function isoDate(value: unknown): string | null {
  const text = nonEmptyText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); }
  catch { return { message: text }; }
}

function providerError(status: number, body: unknown) {
  const record = objectRecord(body);
  const message = nonEmptyText(record?.message ?? record?.error_description ?? record?.error);
  return new Error(`Ripley respondió HTTP ${status}${message ? `: ${message}` : ''}`);
}
