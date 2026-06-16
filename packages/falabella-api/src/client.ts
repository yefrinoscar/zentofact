import {
  FalabellaApiCallOptions,
  FalabellaApiClientOptions,
  FalabellaApiResponse,
  FalabellaErrorDocument,
  GetOrdersV2Filters,
  NormalizedGetOrdersResult,
  FalabellaOrderRecord,
} from './types';
import { buildIsoUtcTimestamp, canonicalizeParameters, signParameters } from './signing';

const DEFAULT_BASE_URL = 'https://sellercenter-api.falabella.com/';
const DEFAULT_VERSION = '1.0';

export class FalabellaApiClient {
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly defaultFormat: 'JSON' | 'XML';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: FalabellaApiClientOptions) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.version = options.version || DEFAULT_VERSION;
    this.defaultFormat = options.defaultFormat || 'JSON';
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async call<T = unknown>(options: FalabellaApiCallOptions): Promise<FalabellaApiResponse<T>> {
    const format = options.format || this.defaultFormat;
    const baseParameters: Record<string, string> = {
      Action: options.action,
      Format: format,
      Timestamp: buildIsoUtcTimestamp(),
      UserID: this.options.userId,
      Version: this.version,
    };

    for (const [key, value] of Object.entries(options.params || {})) {
      if (value === undefined) continue;
      baseParameters[key] = String(value);
    }

    baseParameters.Signature = signParameters(baseParameters, this.options.apiKey);

    const query = canonicalizeParameters(baseParameters);
    const path = options.path ? (options.path.startsWith('/') ? options.path : `/${options.path}`) : '';
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}?${query}`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: options.accept || (format === 'JSON' ? 'application/json' : 'application/xml'),
      },
      signal: options.signal,
    });

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const data = parseResponseBody<T>(rawText, format, contentType);

    return {
      url,
      status: response.status,
      ok: response.ok,
      contentType,
      data,
      rawText,
    };
  }

  async getOrdersV2(filters: GetOrdersV2Filters): Promise<FalabellaApiResponse<unknown>> {
    if (!filters.createdAfter && !filters.updatedAfter) {
      throw new Error('Falabella GetOrders requiere createdAfter o updatedAfter.');
    }

    return this.call({
      action: 'GetOrders',
      path: '/orders/v2/',
      params: {
        CreatedAfter: filters.createdAfter,
        CreatedBefore: filters.createdBefore,
        UpdatedAfter: filters.updatedAfter,
        UpdatedBefore: filters.updatedBefore,
        Limit: filters.limit,
        Offset: filters.offset,
        Status: filters.status,
        SortDirection: filters.sortDirection,
        ShippingType: filters.shippingType,
      },
    });
  }

  async resolveOrderIds(entries: Array<{ orderNumber: string; invoiceDate: string }>): Promise<{
    results: Array<{ orderNumber: string; invoiceDate: string; found: boolean; orderId?: string | number; invoiceRequired: boolean }>;
    debug: { searchesByDate: Record<string, string[]>; totalOrdersFound: number };
  }> {
    const byDate = new Map<string, Array<{ orderNumber: string; invoiceDate: string }>>();
    for (const entry of entries) {
      const orderNumber = String(entry?.orderNumber || '').trim();
      const invoiceDate = String(entry?.invoiceDate || '').trim();
      if (!orderNumber || !invoiceDate) continue;
      const current = byDate.get(invoiceDate) || [];
      current.push({ orderNumber, invoiceDate });
      byDate.set(invoiceDate, current);
    }

    const dateMaps = new Map<string, Map<string, any>>();
    const dateDebug: Record<string, string[]> = {};
    for (const [invoiceDate] of byDate) {
      const ordersMap = await this.#getOrdersMapByDate(invoiceDate);
      dateMaps.set(invoiceDate, ordersMap);
      dateDebug[invoiceDate] = (ordersMap as any).__debug || [];
    }

    return {
      results: entries.map((entry) => {
        const orderNumber = String(entry?.orderNumber || '').trim();
        const invoiceDate = String(entry?.invoiceDate || '').trim();
        const order = dateMaps.get(invoiceDate)?.get(orderNumber);
        return {
          orderNumber,
          invoiceDate,
          found: !!order,
          orderId: order?.OrderId,
          invoiceRequired: isInvoiceRequired(order?.InvoiceRequired),
        };
      }),
      debug: {
        searchesByDate: dateDebug,
        totalOrdersFound: Array.from(dateMaps.values()).reduce((sum, m) => sum + m.size, 0),
      },
    };
  }

  async findOrderByOrderNumber(orderNumber: string, invoiceDate: string): Promise<{ OrderId?: string | number; OrderNumber: string; InvoiceRequired: boolean; raw: any } | null> {
    const map = await this.#getOrdersMapByDate(invoiceDate);
    const raw = map.get(String(orderNumber).trim()) || null;
    if (!raw) return null;
    return {
      OrderId: raw.OrderId,
      OrderNumber: raw.OrderNumber || orderNumber,
      InvoiceRequired: isInvoiceRequired(raw.InvoiceRequired),
      raw,
    };
  }

  async #getOrdersMapByDate(invoiceDate: string) {
    const ordersByNumber = new Map<string, any>();
    const debug: string[] = [];
    const searchPlans: Array<{ label: string; filters: GetOrdersV2Filters }> = [
      {
        label: `created ${invoiceDate} exacto`,
        filters: { createdAfter: toApiStartOfDay(invoiceDate, 0), createdBefore: toApiEndOfDay(invoiceDate, 0), limit: 1000 },
      },
      {
        label: `updated ${invoiceDate} exacto`,
        filters: { updatedAfter: toApiStartOfDay(invoiceDate, 0), updatedBefore: toApiEndOfDay(invoiceDate, 0), limit: 1000 },
      },
      {
        label: `created ${invoiceDate} ±1d`,
        filters: { createdAfter: toApiStartOfDay(invoiceDate, -1), createdBefore: toApiEndOfDay(invoiceDate, 1), limit: 1000 },
      },
      {
        label: `updated ${invoiceDate} ±1d`,
        filters: { updatedAfter: toApiStartOfDay(invoiceDate, -1), updatedBefore: toApiEndOfDay(invoiceDate, 1), limit: 1000 },
      },
    ];

    for (const { label, filters: plan } of searchPlans) {
      const limit = plan.limit || 1000;
      let planPages = 0;
      let planOrders = 0;
      for (let offset = 0; offset < 10000; offset += limit) {
        const response = await this.getOrdersV2({ ...plan, offset });

        const error = getFalabellaError(response.data);
        if (error) {
          debug.push(`[${label}] Error en página ${planPages} (offset=${offset}): ${error.Head?.ErrorMessage || error.Head?.ErrorCode || 'sin mensaje'}`);
          break;
        }

        const normalized = normalizeGetOrdersResult(response.data);
        planPages++;
        for (const order of normalized.orders) {
          const orderNumber = String((order as any)?.OrderNumber || '').trim();
          if (orderNumber && !ordersByNumber.has(orderNumber)) {
            ordersByNumber.set(orderNumber, order);
            planOrders++;
          }
        }

        if (!normalized.orders.length || normalized.orders.length < limit) break;
      }
      debug.push(`[${label}] ${planPages} página(s), ${planOrders} órdenes nuevas (total acumulado: ${ordersByNumber.size})`);
    }

    (ordersByNumber as any).__debug = debug;
    return ordersByNumber;
  }
}

function toApiStartOfDay(dateText: string, deltaDays = 0) {
  return `${shiftIsoDate(dateText, deltaDays)}T00:00:00+00:00`;
}

function toApiEndOfDay(dateText: string, deltaDays = 0) {
  return `${shiftIsoDate(dateText, deltaDays)}T23:59:59+00:00`;
}

function shiftIsoDate(dateText: string, deltaDays = 0) {
  const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const fallback = new Date();
    return fallback.toISOString().slice(0, 10);
  }
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

function isInvoiceRequired(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  return false;
}

export function getFalabellaError(document: unknown): FalabellaErrorDocument['ErrorResponse'] | null {
  if (!document || typeof document !== 'object') return null;
  const maybeError = (document as FalabellaErrorDocument).ErrorResponse;
  if (maybeError && typeof maybeError === 'object') return maybeError;
  // v2 REST response error format
  const data = (document as any)?.data;
  if (data && typeof data === 'object' && (data.error || data.message)) {
    return { Head: { ErrorMessage: data.error || data.message, ErrorCode: data.code } };
  }
  const topError = (document as any)?.error;
  if (topError && typeof topError === 'string') {
    return { Head: { ErrorMessage: topError } };
  }
  return null;
}

export function normalizeGetOrdersResult(document: unknown): NormalizedGetOrdersResult {
  const orders = extractOrders(document);
  const totalCount = extractTotalCount(document);
  return { totalCount, orders };
}

function parseResponseBody<T>(rawText: string, format: 'JSON' | 'XML', contentType: string): T {
  const shouldParseJson = format === 'JSON' || contentType.includes('application/json');
  if (!shouldParseJson) return rawText as T;
  return JSON.parse(rawText) as T;
}

function extractOrders(document: unknown): FalabellaOrderRecord[] {
  const candidates: Array<{ orders: unknown; unwrap: boolean }> = [
    // v2 format: Body.Orders is array of { Order: {...} }
    { orders: readPath(document, ['SuccessResponse', 'Body', 'Orders']), unwrap: true },
    // v1 format: Body.Orders is a single { Order: {...} } or array of raw orders
    { orders: readPath(document, ['SuccessResponse', 'Body', 'Orders', 'Order']), unwrap: false },
    // v2 REST fallback
    { orders: readPath(document, ['data', 'orders']), unwrap: false },
    // Direct orders
    { orders: readPath(document, ['orders']), unwrap: false },
    { orders: readPath(document, ['Orders']), unwrap: false },
    { orders: readPath(document, ['Orders', 'Order']), unwrap: false },
  ];

  for (const { orders, unwrap } of candidates) {
    if (!orders) continue;
    if (Array.isArray(orders)) {
      if (unwrap) {
        const unwrapped = orders.map((item: any) => item?.Order || item).filter(Boolean);
        if (unwrapped.length > 0) return unwrapped as FalabellaOrderRecord[];
      }
      return orders as FalabellaOrderRecord[];
    }
    if (typeof orders === 'object') {
      const maybeWrapped = (orders as any)?.Order;
      if (unwrap && maybeWrapped && typeof maybeWrapped === 'object' && !Array.isArray(maybeWrapped)) {
        return [maybeWrapped as FalabellaOrderRecord];
      }
      return [orders as FalabellaOrderRecord];
    }
  }

  // Fallback: direct array
  if (Array.isArray(document)) return document as FalabellaOrderRecord[];

  return [];
}

function extractTotalCount(document: unknown): number | null {
  const candidates = [
    readPath(document, ['SuccessResponse', 'Head', 'TotalCount']),
    readPath(document, ['Head', 'TotalCount']),
    readPath(document, ['SuccessResponse', 'Body', 'TotalCount']),
    readPath(document, ['totalCount']),
    readPath(document, ['data', 'totalCount']),
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
