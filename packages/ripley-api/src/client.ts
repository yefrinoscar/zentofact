import type { ListOffersOptions, RipleyApiClientOptions, RipleyOffer, RipleyOfferPage } from './types.js';

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
