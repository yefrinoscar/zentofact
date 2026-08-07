import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import puppeteer, { Browser, BrowserContext, HTTPRequest, Page } from 'puppeteer';
import { getCompany, type CompanyRecord } from './company.service';

const SELLER_CENTER_URL = 'https://sellercenter.falabella.com';
const ORDERS_API_URL = 'https://seller-platforms.falabella.services/manage-orders';
const ORDER_GROUPS = ['TODAY', 'UPCOMING', 'DELAYED'] as const;
let manifestRunTail: Promise<void> = Promise.resolve();

export type FalabellaManifestOrderInput = {
  companyId: number;
  orderId?: string | number;
  orderNumber?: string | number;
};

export type CreateFalabellaWebManifestsInput = {
  orders?: FalabellaManifestOrderInput[];
};

export type FalabellaManifestOrderReference = {
  orderId: string;
  orderNumber: string;
  deliveryOrderNumber: string;
};

export type FalabellaManifestSummary = {
  id: string;
  code: string;
  carrier: string;
  numberOfItems: number;
  status: string;
  createdAt: string;
  orders: FalabellaManifestOrderReference[];
  createdByApp?: boolean;
};

export type FalabellaManifestDiagnosticEvent = {
  at: string;
  kind: 'step' | 'http' | 'error';
  stage: string;
  message: string;
  method?: string;
  endpoint?: string;
  status?: number;
  durationMs?: number;
};

export type FalabellaManifestDiagnostic = {
  stage: string;
  pageUrl: string;
  pageTitle: string;
  pageText: string;
  durationMs: number;
  events: FalabellaManifestDiagnosticEvent[];
  screenshotMimeType?: string;
  screenshotBase64?: string;
};

export type FalabellaManifestListCompanyResult = {
  companyId: number;
  companyName: string;
  ok: boolean;
  requestedOrders: number;
  providerOrders: number;
  manifestedOrders: number;
  manifests: FalabellaManifestSummary[];
  source: 'seller_center' | 'local_cache';
  syncedAt: string;
  error?: string;
  diagnostic?: FalabellaManifestDiagnostic;
};

export type ListFalabellaWebManifestsResult = {
  companies: number;
  failedCompanies: number;
  manifestedOrders: number;
  manifests: number;
  source: 'seller_center' | 'local_cache' | 'mixed';
  syncedAt: string;
  results: FalabellaManifestListCompanyResult[];
};

type WebOrder = {
  orderId?: string;
  manifestId?: string;
  deliveryOrderNumber?: string;
  orderNumber?: string;
  sellerOrderNumber?: string;
  status?: string;
  displayStatus?: string;
  noOfItems?: number;
  [key: string]: unknown;
};

type WebManifest = {
  id?: string;
  code?: string;
  carrier?: string;
  numberOfItems?: number;
  orderNumbers?: string[];
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
};

export type CompanyDocument = {
  filename: string;
  mimeType: string;
  base64: string;
  manifestIds: string[];
  manifestCodes: string[];
};

export type FalabellaManifestDocumentRequest = {
  companyId: number;
  manifestId: string;
};

export type FalabellaManifestDocumentsResult = {
  requested: number;
  downloaded: number;
  companies: number;
  documents: Array<CompanyDocument & { companyId: number; companyName: string }>;
};

export type ResolvedFalabellaManifestDocumentRequest = {
  companyId: number;
  manifest: FalabellaManifestSummary;
};

export type FalabellaManifestCompanyResult = {
  companyId: number;
  companyName: string;
  ok: boolean;
  requestedOrders: number;
  providerOrders: number;
  eligibleOrders: number;
  alreadyManifestedOrders: number;
  notReadyOrders: number;
  missingOrders: number;
  createdManifests: number;
  createdOrders: number;
  manifestIds: string[];
  manifestCodes: string[];
  existingManifestIds: string[];
  notAllowedOrders: string[];
  source: 'seller_center' | 'local_cache';
  syncedAt: string;
  document?: CompanyDocument;
  error?: string;
  diagnostic?: FalabellaManifestDiagnostic;
};

export type CreateFalabellaWebManifestsResult = {
  companies: number;
  failedCompanies: number;
  createdManifests: number;
  createdOrders: number;
  documentCount: number;
  source: 'seller_center' | 'local_cache' | 'mixed';
  syncedAt: string;
  results: FalabellaManifestCompanyResult[];
};

type ManifestSelection = {
  eligible: WebOrder[];
  alreadyManifested: WebOrder[];
  notReady: WebOrder[];
  missingRequested: number;
};

type Session = {
  baseHeaders: Record<string, string>;
  record: (event: Omit<FalabellaManifestDiagnosticEvent, 'at'>) => void;
};

type QueryTarget = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, any>> }>;
  connect?: () => Promise<QueryTarget>;
  release?: () => void;
};

export type FalabellaManifestCacheLookup = {
  manifests: FalabellaManifestSummary[];
  missingOrders: FalabellaManifestOrderInput[];
  syncedAt: string;
};

export function falabellaManifestNeedsRemote(
  requestedOrders: FalabellaManifestOrderInput[],
  cache: FalabellaManifestCacheLookup,
): boolean {
  return requestedOrders.length === 0 || cache.missingOrders.length > 0;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function upper(value: unknown): string {
  return text(value).toUpperCase().replace(/[ -]+/g, '_');
}

function asArray<T = any>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function falabellaManifestErrorMessage(error: unknown): string {
  const message = text((error as any)?.message || error);
  if (/waiting failed:\s*\d+ms exceeded/i.test(message)) {
    return 'Falabella no mostró el elemento esperado dentro de 30 segundos.';
  }
  if (/navigation timeout/i.test(message)) {
    return 'Falabella no terminó de cargar la página dentro del tiempo esperado.';
  }
  if (/aborterror|the operation was aborted|signal timed out/i.test(message)) {
    return 'La llamada interna a Falabella no respondió dentro de 30 segundos.';
  }
  if (/net::err_/i.test(message)) {
    return `El navegador no pudo conectarse con Falabella (${message.slice(0, 180)}).`;
  }
  return message || 'Falabella devolvió un error sin detalle.';
}

export function falabellaLoginValidationMode(value: unknown): 'password' | 'federated' | 'unknown' {
  if (!value || typeof value !== 'object' || typeof (value as any).response !== 'boolean') return 'unknown';
  return (value as any).response ? 'federated' : 'password';
}

export function falabellaDiagnosticEndpoint(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname.startsWith('/cdn-cgi/challenge-platform/')
      ? '/cdn-cgi/challenge-platform/[ruta-oculta]'
      : url.pathname;
    return `${url.hostname}${path}`;
  } catch {
    return text(value).split('?')[0].slice(0, 500);
  }
}

export function falabellaManifestDurationMs(
  events: Array<{ at?: unknown; durationMs?: unknown }> = [],
): number {
  const timestamps = events
    .map((event) => Date.parse(text(event?.at)))
    .filter(Number.isFinite);
  const timelineDuration = timestamps.length < 2
    ? 0
    : Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
  const measuredDuration = events.reduce((maximum, event) => {
    const duration = Number(event?.durationMs);
    return Number.isFinite(duration) ? Math.max(maximum, duration) : maximum;
  }, 0);
  return Math.max(timelineDuration, measuredDuration);
}

export function falabellaLocalCacheDiagnostic(
  requestedOrders: number,
  durationMs: number,
  at = new Date().toISOString(),
): FalabellaManifestDiagnostic {
  const measuredDurationMs = Math.max(1, Math.round(Number(durationMs) || 0));
  const events: FalabellaManifestDiagnosticEvent[] = [{
    at,
    kind: 'step',
    stage: 'resuelto desde caché local',
    message: `${requestedOrders} pedido(s) ya tenían una asociación local; no se abrió Seller Center.`,
    durationMs: measuredDurationMs,
  }];
  return {
    stage: 'resuelto desde caché local',
    pageUrl: '',
    pageTitle: '',
    pageText: '',
    durationMs: falabellaManifestDurationMs(events),
    events,
  };
}

function maskedPageText(value: unknown): string {
  return text(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[correo oculto]')
    .replace(/\s+/g, ' ')
    .slice(0, 2_000);
}

function safePageUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.slice(0, 500);
  }
}

async function capturePageDiagnostic(
  page: Page | null,
  stage: string,
  events: FalabellaManifestDiagnosticEvent[],
  withScreenshot = true,
): Promise<FalabellaManifestDiagnostic> {
  if (!page) {
    return {
      stage,
      pageUrl: '',
      pageTitle: '',
      pageText: '',
      durationMs: falabellaManifestDurationMs(events),
      events,
    };
  }
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('input')) {
      const input = node as HTMLInputElement;
      if (/password|email|text/i.test(input.type || 'text')) input.value = '';
    }
  }).catch(() => undefined);
  const [pageTitle, pageText] = await Promise.all([
    page.title().catch(() => ''),
    page.evaluate(() => String(document.body?.innerText || '')).catch(() => ''),
  ]);
  let screenshotBase64 = '';
  if (withScreenshot) {
    try {
      screenshotBase64 = await page.screenshot({
        type: 'jpeg',
        quality: 65,
        fullPage: false,
        encoding: 'base64',
      }) as string;
    } catch {}
  }
  return {
    stage,
    pageUrl: safePageUrl(page.url()),
    pageTitle: maskedPageText(pageTitle),
    pageText: maskedPageText(pageText),
    durationMs: falabellaManifestDurationMs(events),
    events,
    ...(screenshotBase64 ? { screenshotMimeType: 'image/jpeg', screenshotBase64 } : {}),
  };
}

function webOrderIdentifiers(order: WebOrder): string[] {
  return unique([
    text(order.orderId),
    text(order.deliveryOrderNumber),
    text(order.orderNumber),
    text(order.sellerOrderNumber),
  ].filter(Boolean));
}

export function falabellaProviderOrderMatchesRequest(
  providerOrder: WebOrder,
  requestedOrder: FalabellaManifestOrderInput,
): boolean {
  const requestedOrderId = text(requestedOrder.orderId);
  const requestedOrderNumber = text(requestedOrder.orderNumber);
  const providerOrderIds = new Set([
    text(providerOrder.orderId),
    text(providerOrder.sellerOrderNumber),
  ].filter(Boolean));
  const providerOrderNumbers = new Set([
    text(providerOrder.orderNumber),
    text(providerOrder.deliveryOrderNumber),
  ].filter(Boolean));
  return Boolean(
    (requestedOrderId && providerOrderIds.has(requestedOrderId))
    || (requestedOrderNumber && providerOrderNumbers.has(requestedOrderNumber)),
  );
}

function matchingRequestedOrders(
  providerOrder: WebOrder,
  requestedOrders: FalabellaManifestOrderInput[],
): FalabellaManifestOrderInput[] {
  return requestedOrders.filter((requestedOrder) => (
    falabellaProviderOrderMatchesRequest(providerOrder, requestedOrder)
  ));
}

function isReadyToManifest(order: WebOrder): boolean {
  const status = upper(order.status);
  if (status === 'READY_TO_SHIP' || status === 'NON_MANIFESTED') return true;
  const displayStatus = upper(order.displayStatus);
  return displayStatus.includes('LISTO_PARA_ENVIAR')
    || displayStatus.includes('LISTO_PARA_DESPACHAR');
}

export function selectFalabellaManifestOrders(
  providerOrders: WebOrder[],
  requestedOrders: FalabellaManifestOrderInput[] = [],
): ManifestSelection {
  const restrict = requestedOrders.length > 0;
  const relevant = providerOrders.filter((order) => (
    !restrict || requestedOrders.some((requestedOrder) => (
      falabellaProviderOrderMatchesRequest(order, requestedOrder)
    ))
  ));
  const matchedRequested = requestedOrders.filter((requestedOrder) => (
    relevant.some((providerOrder) => (
      falabellaProviderOrderMatchesRequest(providerOrder, requestedOrder)
    ))
  )).length;
  const alreadyManifested: WebOrder[] = [];
  const notReady: WebOrder[] = [];
  const eligible: WebOrder[] = [];

  for (const order of relevant) {
    if (text(order.manifestId)) {
      alreadyManifested.push(order);
      continue;
    }
    if (!isReadyToManifest(order)) {
      notReady.push(order);
      continue;
    }
    if (!text(order.deliveryOrderNumber)) {
      notReady.push(order);
      continue;
    }
    eligible.push(order);
  }

  return {
    eligible,
    alreadyManifested,
    notReady,
    missingRequested: restrict ? Math.max(0, requestedOrders.length - matchedRequested) : 0,
  };
}

export function findNewFalabellaManifests(
  before: WebManifest[],
  after: WebManifest[],
  candidateOrders: WebOrder[],
  createResponse: any,
): WebManifest[] {
  const beforeIds = new Set(before.flatMap((manifest) => [text(manifest.id), text(manifest.code)]).filter(Boolean));
  const candidateOrderNumbers = new Set(candidateOrders.flatMap((order) => [
    text(order.orderNumber),
    text(order.deliveryOrderNumber),
  ]).filter(Boolean));
  const responseKeys = new Set(asArray(createResponse?.created).flatMap((created: any) => (
    typeof created === 'string'
      ? [created]
      : [created?.id, created?.code, created?.manifestId, created?.manifestCode]
  )).map(text).filter(Boolean));

  return after.filter((manifest) => {
    const id = text(manifest.id);
    const code = text(manifest.code);
    const newSinceSnapshot = !beforeIds.has(id) && !beforeIds.has(code);
    const explicitlyCreated = responseKeys.has(id) || responseKeys.has(code);
    const belongsToCandidate = asArray(manifest.orderNumbers).map(text)
      .some((orderNumber) => candidateOrderNumbers.has(orderNumber));
    return explicitlyCreated || (newSinceSnapshot && belongsToCandidate);
  });
}

export function matchFalabellaReadyOrderManifests(
  providerOrders: WebOrder[],
  manifests: WebManifest[],
  requestedOrders: FalabellaManifestOrderInput[] = [],
): FalabellaManifestSummary[] {
  const manifestByIdentifier = new Map<string, WebManifest>();
  const manifestByOrderNumber = new Map<string, WebManifest>();
  for (const manifest of manifests) {
    for (const identifier of [text(manifest.id), text(manifest.code)].filter(Boolean)) {
      manifestByIdentifier.set(identifier, manifest);
    }
    for (const orderNumber of asArray(manifest.orderNumbers).map(text).filter(Boolean)) {
      manifestByOrderNumber.set(orderNumber, manifest);
    }
  }

  const restrict = requestedOrders.length > 0;
  const matched = new Map<string, FalabellaManifestSummary>();
  for (const providerOrder of providerOrders) {
    if (restrict && !requestedOrders.some((requestedOrder) => (
      falabellaProviderOrderMatchesRequest(providerOrder, requestedOrder)
    ))) continue;
    const manifest = manifestByIdentifier.get(text(providerOrder.manifestId))
      || [text(providerOrder.orderNumber), text(providerOrder.deliveryOrderNumber)]
        .map((identifier) => manifestByOrderNumber.get(identifier))
        .find(Boolean);
    if (!manifest) continue;
    const manifestKey = text(manifest.id) || text(manifest.code);
    if (!manifestKey) continue;

    const current = matched.get(manifestKey) || {
      id: text(manifest.id),
      code: text(manifest.code),
      carrier: text(manifest.carrier),
      numberOfItems: Math.max(0, Number(manifest.numberOfItems) || 0),
      status: text(manifest.status),
      createdAt: text(manifest.createdAt),
      orders: [],
    };
    const localMatches = matchingRequestedOrders(providerOrder, requestedOrders);
    const references: FalabellaManifestOrderReference[] = localMatches.length
      ? localMatches.map((requestedOrder) => ({
        orderId: text(requestedOrder.orderId),
        orderNumber: text(requestedOrder.orderNumber),
        deliveryOrderNumber: text(providerOrder.deliveryOrderNumber),
      }))
      : [{
        orderId: text(providerOrder.orderId || providerOrder.sellerOrderNumber),
        orderNumber: text(providerOrder.orderNumber || providerOrder.deliveryOrderNumber),
        deliveryOrderNumber: text(providerOrder.deliveryOrderNumber),
      }];
    for (const reference of references) {
      const referenceKey = `${reference.orderId}:${reference.orderNumber}:${reference.deliveryOrderNumber}`;
      if (!current.orders.some((order) => (
        `${order.orderId}:${order.orderNumber}:${order.deliveryOrderNumber}` === referenceKey
      ))) current.orders.push(reference);
    }
    matched.set(manifestKey, current);
  }

  return [...matched.values()].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || right.code.localeCompare(left.code)
  ));
}

export function mergeFalabellaManifestSummaries(
  ...collections: FalabellaManifestSummary[][]
): FalabellaManifestSummary[] {
  const merged = new Map<string, FalabellaManifestSummary>();
  for (const manifest of collections.flat()) {
    const key = text(manifest.id) || text(manifest.code);
    if (!key) continue;
    const current = merged.get(key) || { ...manifest, orders: [] };
    current.id ||= text(manifest.id);
    current.code ||= text(manifest.code);
    current.carrier ||= text(manifest.carrier);
    current.status ||= text(manifest.status);
    current.createdAt ||= text(manifest.createdAt);
    current.numberOfItems = Math.max(current.numberOfItems || 0, manifest.numberOfItems || 0);
    current.createdByApp = Boolean(current.createdByApp || manifest.createdByApp);
    for (const order of manifest.orders || []) {
      const orderKey = `${text(order.orderId)}:${text(order.orderNumber)}:${text(order.deliveryOrderNumber)}`;
      if (!current.orders.some((candidate) => (
        `${text(candidate.orderId)}:${text(candidate.orderNumber)}:${text(candidate.deliveryOrderNumber)}` === orderKey
      ))) current.orders.push({ ...order });
    }
    merged.set(key, current);
  }
  return [...merged.values()].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || right.code.localeCompare(left.code)
  ));
}

function manifestRequestMatchesReference(
  requested: FalabellaManifestOrderInput,
  reference: Pick<FalabellaManifestOrderReference, 'orderId' | 'orderNumber'>,
): boolean {
  const requestedOrderId = text(requested.orderId);
  const requestedOrderNumber = text(requested.orderNumber);
  return Boolean(
    (requestedOrderId && requestedOrderId === text(reference.orderId))
    || (requestedOrderNumber && requestedOrderNumber === text(reference.orderNumber)),
  );
}

export async function readCachedFalabellaManifests(
  companyId: number,
  requestedOrders: FalabellaManifestOrderInput[],
  target?: QueryTarget,
): Promise<FalabellaManifestCacheLookup> {
  const orderIds = unique(requestedOrders.map((order) => text(order.orderId)).filter(Boolean));
  const orderNumbers = unique(requestedOrders.map((order) => text(order.orderNumber)).filter(Boolean));
  if (!orderIds.length && !orderNumbers.length) {
    return { manifests: [], missingOrders: requestedOrders, syncedAt: '' };
  }
  const resolvedTarget = target || (await import('../db')).pool;
  const { rows } = await resolvedTarget.query(
    `SELECT i.company_id, m.manifest_id, m.manifest_code, m.shipment_provider, m.status,
       m.item_count, m.provider_created_at, m.created_by_app, m.synced_at,
       i.local_order_id, i.order_number, i.delivery_order_number
     FROM falabella_manifest_orders i
     JOIN falabella_manifests m
       ON m.company_id=i.company_id AND m.manifest_id=i.manifest_id
     WHERE i.company_id=$1
       AND (i.local_order_id = ANY($2::text[]) OR i.order_number = ANY($3::text[]))`,
    [companyId, orderIds, orderNumbers],
  );
  const grouped = new Map<string, FalabellaManifestSummary>();
  const matchedSyncedAt: string[] = [];
  for (const row of rows) {
    if (Number(row.company_id) !== companyId) continue;
    const manifestId = text(row.manifest_id);
    if (!manifestId) continue;
    const reference = {
      orderId: text(row.local_order_id),
      orderNumber: text(row.order_number),
      deliveryOrderNumber: text(row.delivery_order_number),
    };
    if (!requestedOrders.some((requested) => (
      manifestRequestMatchesReference(requested, reference)
    ))) continue;
    if (row.synced_at) matchedSyncedAt.push(new Date(row.synced_at).toISOString());
    const manifest = grouped.get(manifestId) || {
      id: manifestId,
      code: text(row.manifest_code) || manifestId,
      carrier: text(row.shipment_provider),
      numberOfItems: Math.max(0, Number(row.item_count) || 0),
      status: text(row.status),
      createdAt: row.provider_created_at
        ? new Date(row.provider_created_at).toISOString()
        : '',
      createdByApp: Boolean(row.created_by_app),
      orders: [],
    };
    if (!manifest.orders.some((candidate) => (
      candidate.orderId === reference.orderId && candidate.orderNumber === reference.orderNumber
    ))) manifest.orders.push(reference);
    grouped.set(manifestId, manifest);
  }
  const manifests = [...grouped.values()];
  const references = manifests.flatMap((manifest) => manifest.orders);
  return {
    manifests,
    missingOrders: requestedOrders.filter((requested) => (
      !references.some((reference) => manifestRequestMatchesReference(requested, reference))
    )),
    syncedAt: matchedSyncedAt.sort().at(0) || '',
  };
}

export async function readCachedFalabellaManifest(
  companyId: number,
  manifestIdOrCode: string,
  target?: QueryTarget,
): Promise<FalabellaManifestSummary | null> {
  const requested = text(manifestIdOrCode);
  if (!requested) return null;
  const resolvedTarget = target || (await import('../db')).pool;
  const { rows } = await resolvedTarget.query(
    `SELECT manifest_id, manifest_code, shipment_provider, status,
       item_count, provider_created_at
     FROM falabella_manifests
     WHERE company_id=$1 AND (manifest_id=$2 OR manifest_code=$2)
     LIMIT 1`,
    [companyId, requested],
  );
  const row = rows[0];
  if (!row?.manifest_id) return null;
  return {
    id: text(row.manifest_id),
    code: text(row.manifest_code),
    carrier: text(row.shipment_provider),
    numberOfItems: Math.max(0, Number(row.item_count) || 0),
    status: text(row.status),
    createdAt: row.provider_created_at ? new Date(row.provider_created_at).toISOString() : '',
    orders: [],
  };
}

export async function resolveCachedFalabellaManifestDocumentRequests(
  requests: FalabellaManifestDocumentRequest[],
  target?: QueryTarget,
): Promise<ResolvedFalabellaManifestDocumentRequest[]> {
  if (!Array.isArray(requests) || !requests.length) {
    throw new Error('Selecciona al menos un manifiesto guardado.');
  }
  if (requests.length > 50) {
    throw new Error('Puedes imprimir hasta 50 manifiestos por vez.');
  }
  const resolvedTarget = target || (await import('../db')).pool;
  const resolved: ResolvedFalabellaManifestDocumentRequest[] = [];
  const seen = new Set<string>();
  for (const [index, request] of requests.entries()) {
    const companyId = Number(request?.companyId);
    const manifestIdOrCode = text(request?.manifestId);
    if (!Number.isInteger(companyId) || companyId <= 0 || !manifestIdOrCode) {
      throw new Error(`El manifiesto en la posición ${index + 1} no es válido.`);
    }
    const { rows } = await resolvedTarget.query(
      `SELECT DISTINCT m.manifest_id, m.manifest_code, m.shipment_provider, m.status,
         m.item_count, m.provider_created_at, m.created_by_app
       FROM falabella_manifests m
       JOIN falabella_manifest_orders o
         ON o.company_id=m.company_id AND o.manifest_id=m.manifest_id
       WHERE m.company_id=$1 AND (m.manifest_id=$2 OR m.manifest_code=$2)
       LIMIT 1`,
      [companyId, manifestIdOrCode],
    );
    const row = rows[0];
    if (!row?.manifest_id) {
      throw new Error(`El manifiesto ${manifestIdOrCode} no está guardado para la tienda ${companyId}.`);
    }
    const key = `${companyId}:${text(row.manifest_id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({
      companyId,
      manifest: {
        id: text(row.manifest_id),
        code: text(row.manifest_code),
        carrier: text(row.shipment_provider),
        numberOfItems: Math.max(0, Number(row.item_count) || 0),
        status: text(row.status),
        createdAt: row.provider_created_at ? new Date(row.provider_created_at).toISOString() : '',
        createdByApp: Boolean(row.created_by_app),
        orders: [],
      },
    });
  }
  if (!resolved.length) throw new Error('No hay manifiestos guardados para imprimir.');
  return resolved;
}

export async function recordCachedFalabellaManifestDownload(
  companyId: number,
  manifestId: string,
  target?: QueryTarget,
): Promise<void> {
  const resolvedManifestId = text(manifestId);
  if (!resolvedManifestId) return;
  const resolvedTarget = target || (await import('../db')).pool;
  await resolvedTarget.query(
    `UPDATE falabella_manifests SET
       download_count=download_count+1,
       first_downloaded_at=COALESCE(first_downloaded_at, NOW()),
       last_downloaded_at=NOW(),
       last_seen_at=NOW()
     WHERE company_id=$1 AND manifest_id=$2`,
    [companyId, resolvedManifestId],
  );
}

function falabellaManifestPdfBuffer(document: Pick<CompanyDocument, 'base64'>): Buffer {
  const buffer = Buffer.from(text(document.base64).replace(/\s+/g, ''), 'base64');
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('El archivo de manifiesto recibido no es un PDF válido.');
  }
  return buffer;
}

export async function cacheFalabellaManifestDocument(
  companyId: number,
  manifestId: string,
  document: CompanyDocument,
  target?: QueryTarget,
): Promise<void> {
  const resolvedManifestId = text(manifestId);
  if (!Number.isInteger(companyId) || companyId <= 0 || !resolvedManifestId) {
    throw new Error('No se puede guardar un PDF sin tienda e identificador de manifiesto.');
  }
  const buffer = falabellaManifestPdfBuffer(document);
  const filename = text(document.filename) || `manifiesto-${resolvedManifestId}.pdf`;
  const resolvedTarget = target || (await import('../db')).pool;
  const { rows } = await resolvedTarget.query(
    `UPDATE falabella_manifests SET
       pdf_data=$3,
       pdf_filename=$4,
       pdf_cached_at=NOW(),
       pdf_byte_size=$5,
       last_seen_at=NOW()
     WHERE company_id=$1 AND manifest_id=$2
     RETURNING manifest_id`,
    [companyId, resolvedManifestId, buffer, filename, buffer.length],
  );
  if (!rows[0]?.manifest_id) {
    throw new Error(`El manifiesto ${resolvedManifestId} no está guardado para la tienda ${companyId}.`);
  }
}

export async function readCachedFalabellaManifestDocument(
  companyId: number,
  manifestId: string,
  target?: QueryTarget,
): Promise<CompanyDocument | null> {
  const resolvedManifestId = text(manifestId);
  if (!Number.isInteger(companyId) || companyId <= 0 || !resolvedManifestId) return null;
  const resolvedTarget = target || (await import('../db')).pool;
  const { rows } = await resolvedTarget.query(
    `SELECT manifest_id, manifest_code, pdf_data, pdf_filename
     FROM falabella_manifests
     WHERE company_id=$1 AND manifest_id=$2
     LIMIT 1`,
    [companyId, resolvedManifestId],
  );
  const row = rows[0];
  if (!row?.manifest_id || row.pdf_data == null) return null;
  const buffer = Buffer.isBuffer(row.pdf_data) ? row.pdf_data : Buffer.from(row.pdf_data);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`El PDF cacheado del manifiesto ${resolvedManifestId} está dañado.`);
  }
  return {
    filename: text(row.pdf_filename) || `manifiesto-${text(row.manifest_code) || resolvedManifestId}.pdf`,
    mimeType: 'application/pdf',
    base64: buffer.toString('base64'),
    manifestIds: [resolvedManifestId],
    manifestCodes: [text(row.manifest_code)].filter(Boolean),
  };
}

async function combineFalabellaManifestDocuments(
  documents: CompanyDocument[],
  filename = `manifiestos-falabella-${new Date().toISOString().slice(0, 10)}.pdf`,
): Promise<CompanyDocument> {
  if (!documents.length) throw new Error('No hay PDF de manifiestos para combinar.');
  if (documents.length === 1) return documents[0];
  const output = await PDFDocument.create();
  for (const document of documents) {
    const source = await PDFDocument.load(falabellaManifestPdfBuffer(document));
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  return {
    filename,
    mimeType: 'application/pdf',
    base64: Buffer.from(await output.save()).toString('base64'),
    manifestIds: documents.flatMap((document) => document.manifestIds),
    manifestCodes: documents.flatMap((document) => document.manifestCodes),
  };
}

function providerCreatedAt(value: unknown): string | null {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function upsertCachedFalabellaManifests(
  companyId: number,
  manifests: FalabellaManifestSummary[],
  createdManifestIds: string[] = [],
  target?: QueryTarget,
): Promise<void> {
  if (!manifests.length) return;
  const resolvedTarget: QueryTarget = target || (await import('../db')).pool;
  const client = resolvedTarget.connect ? await resolvedTarget.connect() : resolvedTarget;
  const created = new Set(createdManifestIds.map(text).filter(Boolean));
  try {
    await client.query('BEGIN');
    for (const manifest of manifests) {
      const manifestId = text(manifest.id);
      if (!manifestId) continue;
      const createdByApp = created.has(manifestId) || created.has(text(manifest.code));
      await client.query(
        `INSERT INTO falabella_manifests (
           company_id, manifest_id, manifest_code, shipment_provider, tracking_code, status,
           item_count, provider_created_at, created_by_app, source, synced_at,
           first_seen_at, last_seen_at
         ) VALUES ($1,$2,$3,$4,$3,$5,$6,$7,$8,'seller_center',NOW(),NOW(),NOW())
         ON CONFLICT (company_id, manifest_id) DO UPDATE SET
           manifest_code=EXCLUDED.manifest_code,
           shipment_provider=EXCLUDED.shipment_provider,
           tracking_code=EXCLUDED.tracking_code,
           status=EXCLUDED.status,
           item_count=EXCLUDED.item_count,
           provider_created_at=COALESCE(EXCLUDED.provider_created_at, falabella_manifests.provider_created_at),
           created_by_app=falabella_manifests.created_by_app OR EXCLUDED.created_by_app,
           source='seller_center', synced_at=NOW(), last_seen_at=NOW()`,
        [
          companyId,
          manifestId,
          text(manifest.code),
          text(manifest.carrier),
          text(manifest.status),
          Math.max(0, Number(manifest.numberOfItems) || 0),
          providerCreatedAt(manifest.createdAt),
          createdByApp,
        ],
      );
      for (const order of manifest.orders || []) {
        const localOrderId = text(order.orderId) || text(order.orderNumber) || text(order.deliveryOrderNumber);
        if (!localOrderId) continue;
        await client.query(
          `INSERT INTO falabella_manifest_orders (
             company_id, manifest_id, local_order_id, order_number, delivery_order_number,
             first_seen_at, last_seen_at
           ) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
           ON CONFLICT (company_id, local_order_id) DO UPDATE SET
             manifest_id=EXCLUDED.manifest_id,
             order_number=EXCLUDED.order_number,
             delivery_order_number=EXCLUDED.delivery_order_number,
             last_seen_at=NOW()`,
          [companyId, manifestId, localOrderId, text(order.orderNumber), text(order.deliveryOrderNumber)],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}

async function executablePath(): Promise<string | undefined> {
  const configured = text(process.env.PUPPETEER_EXECUTABLE_PATH);
  if (configured) return configured;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  try {
    const bundled = await puppeteer.executablePath();
    if (bundled && existsSync(bundled)) return bundled;
  } catch {}
  return candidates.find((candidate) => existsSync(candidate));
}

async function launchBrowser(): Promise<Browser> {
  const resolvedExecutable = await executablePath();
  if (!resolvedExecutable) {
    throw new Error('No se encontró Chrome para automatizar Falabella. Configura PUPPETEER_EXECUTABLE_PATH.');
  }
  return puppeteer.launch({
    headless: true,
    executablePath: resolvedExecutable,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

export function falabellaIsStaleDomError(error: unknown): boolean {
  return /cannot find context|execution context was destroyed|node is detached|detached frame|cannot find node/i
    .test(text((error as any)?.message || error));
}

async function retryFalabellaDomAction<T>(action: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!falabellaIsStaleDomError(error) || attempt === 3) throw error;
      await wait(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function fillVisibleInput(page: Page, selector: string, value: string): Promise<boolean> {
  return retryFalabellaDomAction(() => page.evaluate((inputSelector, nextValue) => {
    const input = [...document.querySelectorAll(inputSelector)]
      .find((node) => Boolean(
        (node as HTMLElement).offsetWidth
        || (node as HTMLElement).offsetHeight
        || node.getClientRects().length,
      )) as HTMLInputElement | undefined;
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, selector, value));
}

async function clickLoginSubmit(page: Page): Promise<void> {
  const clicked = await retryFalabellaDomAction(() => page.evaluate(() => {
    const candidates = [...document.querySelectorAll(
      '#kc-login, button[type="submit"], input[type="submit"], button',
    )].filter((node) => Boolean(
      (node as HTMLElement).offsetWidth
      || (node as HTMLElement).offsetHeight
      || node.getClientRects().length,
    ));
    const preferred = candidates.find((node) => /login|ingresar|iniciar/i.test(String(
      (node as HTMLElement).innerText || (node as HTMLInputElement).value || '',
    ).trim()));
    const submit = (preferred || candidates.find((node) => /continuar/i.test(String(
      (node as HTMLElement).innerText || (node as HTMLInputElement).value || '',
    ).trim())) || candidates[0]) as HTMLElement | undefined;
    if (!submit) return false;
    submit.click();
    return true;
  }));
  if (clicked) return;
  const focused = await retryFalabellaDomAction(() => page.evaluate(() => {
    const password = [...document.querySelectorAll('input[type="password"]')]
      .find((node) => Boolean(
        (node as HTMLElement).offsetWidth
        || (node as HTMLElement).offsetHeight
        || node.getClientRects().length,
      )) as HTMLInputElement | undefined;
    password?.focus();
    return Boolean(password);
  }));
  if (!focused) throw new Error('Falabella no mostró un botón para iniciar sesión.');
  await page.keyboard.press('Enter');
}

async function login(
  page: Page,
  company: CompanyRecord,
  step: (stage: string, message: string) => void,
): Promise<void> {
  const username = text(company.sellerUsername);
  const password = String(company.sellerPassword ?? '');
  if (!username || !password) throw new Error('La tienda no tiene usuario y contraseña web de Falabella.');

  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(45_000);
  let loginStage = 'abriendo la página de acceso de Falabella';
  try {
    step(loginStage, 'Abriendo Seller Center.');
    await page.goto(`${SELLER_CENTER_URL}/user/auth/login`, { waitUntil: 'domcontentloaded' });
    loginStage = 'esperando el campo de correo de Seller Center';
    step(loginStage, 'La página inicial cargó; buscando el campo de correo.');
    if (!(await page.waitForSelector('#email', { visible: true }))) {
      throw new Error('Falabella no mostró el campo de correo.');
    }

    // Seller Center carga App/helpers/Login.js de forma asíncrona. Si se hace clic
    // apenas termina DOMContentLoaded, todavía no existe su onclick y el navegador
    // envía el formulario HTML con password vacío. Falabella responde 200 mostrando
    // nuevamente /user/auth/login, que antes se confundía con un timeout.
    loginStage = 'esperando que Falabella active el formulario de acceso';
    step(loginStage, 'Esperando el flujo de validación de correo de Seller Center.');
    await page.waitForFunction(() => (
      typeof (document.querySelector('#submit') as HTMLInputElement | null)?.onclick === 'function'
    ), { timeout: 20_000 });

    if (!(await fillVisibleInput(page, '#email', username))) {
      throw new Error('Falabella dejó de mostrar el campo de correo.');
    }
    loginStage = 'enviando el correo a Falabella';
    step(loginStage, 'Correo completado; esperando la validación interna de Falabella.');
    const validationResponsePromise = page.waitForResponse((response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === 'GET'
          && url.hostname === 'sellercenter.falabella.com'
          && url.pathname === '/user/auth/validate-user';
      } catch {
        return false;
      }
    }, { timeout: 20_000 });
    await retryFalabellaDomAction(() => page.click('#submit'));
    const validationResponse = await validationResponsePromise;
    if (!validationResponse.ok()) {
      throw new Error(`La validación del correo respondió HTTP ${validationResponse.status()}.`);
    }
    // El IdP puede navegar inmediatamente y Puppeteer ya no siempre conserva el
    // body de esta respuesta. El JSON ayuda al log, pero no determina el flujo.
    const validationMode = falabellaLoginValidationMode(
      await validationResponse.json().catch(() => null),
    );

    loginStage = 'esperando el resultado de la validación del correo';
    step(
      loginStage,
      validationMode === 'federated'
        ? 'Falabella indicó acceso federado; esperando la redirección al proveedor de identidad.'
        : validationMode === 'password'
          ? 'Falabella indicó acceso con contraseña; esperando que habilite el campo.'
          : 'Falabella respondió correctamente; comprobando la URL y el formulario resultantes.',
    );
    await page.waitForFunction(() => {
      const leftInitialLogin = location.hostname !== 'sellercenter.falabella.com'
        || !location.pathname.includes('/user/auth/login');
      const passwordVisible = [...document.querySelectorAll('input[type="password"]')].some((node) => Boolean(
        (node as HTMLElement).offsetWidth || (node as HTMLElement).offsetHeight || node.getClientRects().length,
      ));
      return leftInitialLogin || passwordVisible;
    }, { timeout: 30_000 });

    if (page.url().startsWith(`${SELLER_CENTER_URL}/`) && !page.url().includes('/user/auth/login')) {
      step('sesión de Falabella iniciada', 'Seller Center reutilizó una sesión válida.');
      return;
    }

    loginStage = 'esperando el campo de contraseña';
    step(loginStage, page.url().startsWith(SELLER_CENTER_URL)
      ? 'Falabella habilitó el flujo local de contraseña.'
      : 'La redirección al proveedor de identidad terminó; esperando su formulario de contraseña.');
    if (!page.url().startsWith(SELLER_CENTER_URL)) {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8_000 }).catch(() => undefined);
    }
    await page.waitForFunction(() => (
      (location.hostname === 'sellercenter.falabella.com' && !location.pathname.includes('/user/auth/login'))
      || [...document.querySelectorAll('input[type="password"]')].some((node) => Boolean(
        (node as HTMLElement).offsetWidth || (node as HTMLElement).offsetHeight || node.getClientRects().length,
      ))
    ), { timeout: 30_000 });
    if (page.url().startsWith(`${SELLER_CENTER_URL}/`) && !page.url().includes('/user/auth/login')) {
      step('sesión de Falabella iniciada', 'Seller Center reutilizó una sesión válida.');
      return;
    }
    await fillVisibleInput(page, 'input[type="email"]', username);
    if (!(await fillVisibleInput(page, 'input[type="password"]', password))) {
      throw new Error('Falabella dejó de mostrar el campo de contraseña.');
    }

    loginStage = 'validando las credenciales con Falabella';
    step(loginStage, 'Contraseña completada; enviando el formulario.');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 35_000 }).catch(() => null),
      clickLoginSubmit(page),
    ]);
    await page.waitForFunction(() => {
      const body = String(document.body?.innerText || '');
      return (location.hostname === 'sellercenter.falabella.com' && !location.pathname.includes('/user/auth/login'))
        || /invalid username|usuario o contraseña|credenciales inválidas/i.test(body);
    }, { timeout: 35_000 }).catch(() => null);

    if (!(page.url().startsWith(`${SELLER_CENTER_URL}/`) && !page.url().includes('/user/auth/login'))) {
      const visibleError = await page.evaluate(() => {
        const selectors = [
          '.alert-error', '.alert-danger', '.error', '.errors', '.form-error',
          '[role="alert"]', '.message-error', '.notification-error',
        ];
        return selectors
          .map((selector) => String((document.querySelector(selector) as HTMLElement | null)?.innerText || '').trim())
          .find(Boolean) || '';
      }).catch(() => '');
      const detail = maskedPageText(visibleError);
      throw new Error(detail
        ? `Falabella rechazó el acceso: ${detail}`
        : 'Falabella devolvió nuevamente el formulario de acceso después de enviar la contraseña. Verifica las credenciales web de esta tienda.');
    }
    step('sesión de Falabella iniciada', 'Credenciales aceptadas por Seller Center.');
  } catch (error) {
    // `step` ya deja `loginStage` como etapa activa en el diagnóstico. Repetirla
    // aquí produciría mensajes como "esperando...: esperando...: detalle".
    throw new Error(falabellaManifestErrorMessage(error));
  }
}

function captureApiHeaders(request: HTTPRequest): Record<string, string> {
  const allowed = new Set([
    'authorization', 'accept-language', 'cache-control', 'origin', 'referer', 'referrer-policy',
    'user-agent', 'x-channel', 'x-country', 'x-device', 'x-operator', 'x-seller', 'x-version',
  ]);
  return Object.fromEntries(Object.entries(request.headers()).filter(([key]) => allowed.has(key.toLowerCase())));
}

function observeBrowserHttp(page: Page, record: Session['record']): void {
  const requestStartedAt = new WeakMap<HTTPRequest, number>();
  page.on('request', (request) => {
    if (!['document', 'xhr', 'fetch'].includes(request.resourceType())) return;
    try {
      if (!/falabella/i.test(new URL(request.url()).hostname)) return;
      requestStartedAt.set(request, Date.now());
    } catch {}
  });
  page.on('response', (response) => {
    const request = response.request();
    const resourceType = request.resourceType();
    if (!['document', 'xhr', 'fetch'].includes(resourceType)) return;
    let endpoint = '';
    try {
      const url = new URL(response.url());
      if (!/falabella/i.test(url.hostname)) return;
      endpoint = falabellaDiagnosticEndpoint(response.url());
    } catch {
      return;
    }
    record({
      kind: 'http',
      stage: resourceType === 'document' ? 'navegación del navegador' : 'llamada interceptada del navegador',
      message: `${resourceType} respondió HTTP ${response.status()}.`,
      method: request.method(),
      endpoint,
      status: response.status(),
      ...(requestStartedAt.has(request)
        ? { durationMs: Date.now() - (requestStartedAt.get(request) || Date.now()) }
        : {}),
    });
  });
  page.on('requestfailed', (request) => {
    if (!['document', 'xhr', 'fetch'].includes(request.resourceType())) return;
    let endpoint = '';
    try {
      const url = new URL(request.url());
      if (!/falabella/i.test(url.hostname)) return;
      endpoint = falabellaDiagnosticEndpoint(request.url());
    } catch {
      return;
    }
    record({
      kind: 'error',
      stage: 'llamada fallida del navegador',
      message: request.failure()?.errorText || 'El navegador no recibió respuesta.',
      method: request.method(),
      endpoint,
      ...(requestStartedAt.has(request)
        ? { durationMs: Date.now() - (requestStartedAt.get(request) || Date.now()) }
        : {}),
    });
  });
}

async function createSession(
  page: Page,
  record: Session['record'],
): Promise<Session> {
  const startedAt = Date.now();
  const matchesListing = (request: HTTPRequest) => {
    try {
      const url = new URL(request.url());
      return request.method() === 'GET'
        && url.hostname === 'seller-platforms.falabella.services'
        && url.pathname === '/manage-orders/v2/listing';
    } catch {
      return false;
    }
  };
  const listingRequest = page.waitForRequest((request) => {
    return matchesListing(request);
  }, { timeout: 35_000 });
  const listingResponse = page.waitForResponse((response) => matchesListing(response.request()), { timeout: 35_000 });
  const [request, response] = await Promise.all([
    listingRequest,
    listingResponse,
    page.goto(`${SELLER_CENTER_URL}/order`, { waitUntil: 'domcontentloaded' }),
  ]);
  const baseHeaders = captureApiHeaders(request);
  if (!text(baseHeaders.authorization)) throw new Error('Falabella no entregó una sesión web autorizada.');
  record({
    kind: response.ok() ? 'http' : 'error',
    stage: 'capturando la sesión interna de Falabella',
    message: response.ok()
      ? `Se interceptó la llamada de pedidos (HTTP ${response.status()}) y se obtuvo una sesión autorizada.`
      : `La llamada inicial de pedidos respondió HTTP ${response.status()}.`,
    method: 'GET',
    endpoint: '/manage-orders/v2/listing',
    status: response.status(),
    durationMs: Date.now() - startedAt,
  });
  if (!response.ok()) throw new Error(`La sesión web de Falabella respondió HTTP ${response.status()} al consultar pedidos.`);
  return { baseHeaders, record };
}

function headers(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...session.baseHeaders,
    accept: '*/*',
    'x-reference': randomUUID(),
    ...extra,
  };
}

function responseSummary(data: any): string {
  const records = Array.isArray(data?.data) ? `${data.data.length} registro${data.data.length === 1 ? '' : 's'}` : '';
  const created = asArray(data?.created).length;
  const existing = asArray(data?.existing).length;
  const notAllowed = asArray(data?.notAllowed).length;
  return [
    records,
    created ? `${created} creado${created === 1 ? '' : 's'}` : '',
    existing ? `${existing} existente${existing === 1 ? '' : 's'}` : '',
    notAllowed ? `${notAllowed} no permitido${notAllowed === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ') || 'respuesta recibida';
}

async function jsonRequest(
  session: Session,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<any> {
  const method = init.method || 'GET';
  const attempts = method === 'GET' ? 3 : 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const startedAt = Date.now();
    const endpoint = `/manage-orders/${path.replace(/^\//, '')}`;
    try {
      const response = await fetch(`${ORDERS_API_URL}/${path.replace(/^\//, '')}`, {
        method,
        headers: headers(session, {
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(init.headers || {}),
        }),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(30_000),
      });
      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = null; }
      session.record({
        kind: 'http',
        stage: `llamada interna ${method} ${endpoint}`,
        message: response.ok || response.status === 207
          ? `Falabella respondió HTTP ${response.status}: ${responseSummary(data)}.`
          : `Falabella respondió HTTP ${response.status}: ${text(data?.message ?? data?.error ?? raw).slice(0, 300) || 'sin detalle'}.`,
        method,
        endpoint,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      if (!response.ok && response.status !== 207) {
        const message = text(data?.message ?? data?.error ?? raw).slice(0, 500);
        const error = new Error(message || `Falabella respondió HTTP ${response.status}.`);
        const retryableStatus = response.status === 429 || response.status >= 500;
        if (retryableStatus && attempt + 1 < attempts) {
          lastError = error;
          await wait(600 * (attempt + 1));
          continue;
        }
        if (!retryableStatus) Object.assign(error, { retryable: false });
        throw error;
      }
      return data ?? {};
    } catch (error) {
      lastError = error;
      session.record({
        kind: 'error',
        stage: `llamada interna ${method} ${endpoint}`,
        message: `Intento ${attempt + 1}/${attempts}: ${falabellaManifestErrorMessage(error)}`,
        method,
        endpoint,
        durationMs: Date.now() - startedAt,
      });
      if ((error as any)?.retryable === false || attempt + 1 >= attempts) throw error;
      await wait(600 * (attempt + 1));
    }
  }
  throw lastError;
}

async function listOrders(session: Session): Promise<WebOrder[]> {
  const found = new Map<string, WebOrder>();
  for (const group of ORDER_GROUPS) {
    let page = 1;
    let totalPages = 1;
    do {
      const response = await jsonRequest(session, 'v2/listing', {
        headers: {
          group,
          filter: 'PENDING',
          action: 'ALL',
          pickup: 'ALL',
          carriers: 'ALL',
          channel: 'FBS',
          sort: 'PROMISED_DATE:ASC',
          limit: '50',
          page: String(page),
        },
      });
      for (const order of asArray<WebOrder>(response?.data)) {
        const key = text(order.orderId) || text(order.deliveryOrderNumber) || text(order.sellerOrderNumber);
        if (key) found.set(key, order);
      }
      totalPages = Math.min(100, Math.max(1, Number(response?.meta?.pagination?.totalPages || 1)));
      page += 1;
    } while (page <= totalPages);
  }
  return [...found.values()];
}

async function listManifests(session: Session): Promise<WebManifest[]> {
  const found = new Map<string, WebManifest>();
  let page = 1;
  let totalPages = 1;
  do {
    const response = await jsonRequest(session, 'v1/manifest', {
      headers: { filter: 'PENDING', limit: '50', page: String(page) },
    });
    for (const manifest of asArray<WebManifest>(response?.data)) {
      const key = text(manifest.id) || text(manifest.code);
      if (key) found.set(key, manifest);
    }
    totalPages = Math.min(100, Math.max(1, Number(response?.meta?.pagination?.totalPages || 1)));
    page += 1;
  } while (page <= totalPages);
  return [...found.values()];
}

async function downloadManifests(session: Session, manifests: WebManifest[]): Promise<CompanyDocument> {
  const manifestIds = unique(manifests.map((manifest) => text(manifest.id)).filter(Boolean));
  if (!manifestIds.length) throw new Error('Falabella creó el manifiesto pero no devolvió su identificador de impresión.');
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(
        `${ORDERS_API_URL}/v1/print/manifest?manifestIds=${encodeURIComponent(manifestIds.join(','))}`,
        {
          headers: headers(session, { accept: 'application/pdf' }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const buffer = Buffer.from(await response.arrayBuffer());
      session.record({
        kind: response.ok ? 'http' : 'error',
        stage: 'descargando el PDF del manifiesto',
        message: response.ok
          ? `Falabella respondió HTTP ${response.status} con ${buffer.length} bytes.`
          : `Falabella respondió HTTP ${response.status}.`,
        method: 'GET',
        endpoint: '/manage-orders/v1/print/manifest',
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      if (response.ok && buffer.length && /pdf/i.test(response.headers.get('content-type') || 'application/pdf')) {
        return {
          filename: manifests.length === 1
            ? `manifiesto-${text(manifests[0].code).replace(/[^a-zA-Z0-9_-]+/g, '-') || manifestIds[0]}.pdf`
            : `manifiestos-falabella-${new Date().toISOString().slice(0, 10)}.pdf`,
          mimeType: 'application/pdf',
          base64: buffer.toString('base64'),
          manifestIds,
          manifestCodes: manifests.map((manifest) => text(manifest.code)).filter(Boolean),
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error: any) {
      lastError = text(error?.message || error) || 'error de red';
      session.record({
        kind: 'error',
        stage: 'descargando el PDF del manifiesto',
        message: `Intento ${attempt + 1}/3: ${falabellaManifestErrorMessage(error)}`,
        method: 'GET',
        endpoint: '/manage-orders/v1/print/manifest',
        durationMs: Date.now() - startedAt,
      });
    }
    await wait(1_000);
  }
  throw new Error(`Falabella no pudo descargar el manifiesto creado (${lastError || 'archivo vacío'}).`);
}

function createResultBase(company: CompanyRecord, requested: FalabellaManifestOrderInput[]): FalabellaManifestCompanyResult {
  return {
    companyId: company.id,
    companyName: text(company.razonSocial || company.nombre),
    ok: true,
    requestedOrders: requested.length,
    providerOrders: 0,
    eligibleOrders: 0,
    alreadyManifestedOrders: 0,
    notReadyOrders: 0,
    missingOrders: 0,
    createdManifests: 0,
    createdOrders: 0,
    manifestIds: [],
    manifestCodes: [],
    existingManifestIds: [],
    notAllowedOrders: [],
    source: 'seller_center',
    syncedAt: '',
  };
}

function resultSource(
  results: Array<{ source: 'seller_center' | 'local_cache' }>,
): 'seller_center' | 'local_cache' | 'mixed' {
  const sources = new Set(results.map((result) => result.source));
  return sources.size > 1 ? 'mixed' : results[0]?.source || 'local_cache';
}

function resultSyncedAt(results: Array<{ syncedAt: string }>): string {
  // Representa la asociación menos fresca cubierta por la respuesta completa.
  return results.map((result) => result.syncedAt).filter(Boolean).sort().at(0) || '';
}

async function withFalabellaManifestCompanyLock<T>(
  companyId: number,
  operation: () => Promise<T>,
): Promise<T> {
  const { pool } = await import('../db');
  const client = await pool.connect();
  const lockNamespace = 117868526;
  await client.query('SELECT pg_advisory_lock($1, $2)', [lockNamespace, companyId]);
  try {
    return await operation();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, $2)', [lockNamespace, companyId])
      .catch(() => undefined);
    client.release();
  }
}

function failedCompanyResult(
  company: CompanyRecord,
  requested: FalabellaManifestOrderInput[],
  stage: string,
  error: unknown,
): FalabellaManifestCompanyResult {
  const result = createResultBase(company, requested);
  const message = falabellaManifestErrorMessage(error);
  result.ok = false;
  result.error = `${stage}: ${message}`;
  result.diagnostic = {
    stage,
    pageUrl: '',
    pageTitle: '',
    pageText: '',
    durationMs: 0,
    events: [{ at: new Date().toISOString(), kind: 'error', stage, message }],
  };
  return result;
}

async function processCompany(
  browser: Browser,
  company: CompanyRecord,
  requested: FalabellaManifestOrderInput[],
): Promise<FalabellaManifestCompanyResult> {
  const result = createResultBase(company, requested);
  let context: BrowserContext | null = null;
  const events: FalabellaManifestDiagnosticEvent[] = [];
  let stage = 'iniciando Seller Center';
  let page: Page | null = null;
  const record: Session['record'] = (event) => events.push({ at: new Date().toISOString(), ...event });
  const step = (nextStage: string, message: string) => {
    stage = nextStage;
    record({ kind: 'step', stage, message });
  };
  const finish = async () => {
    result.syncedAt = new Date().toISOString();
    result.diagnostic = await capturePageDiagnostic(page, stage, events, false);
    return result;
  };
  try {
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    observeBrowserHttp(page, record);
    step('iniciando sesión en Falabella', 'Preparando el navegador para esta tienda.');
    await login(page, company, step);
    step('abriendo la bandeja de pedidos', 'Abriendo /order e interceptando su llamada HTTP interna.');
    const session = await createSession(page, record);
    step('consultando los pedidos', 'Consultando pedidos pendientes de hoy, próximos y atrasados.');
    const providerOrders = await listOrders(session);
    const selection = selectFalabellaManifestOrders(providerOrders, requested);
    result.providerOrders = providerOrders.length;
    result.eligibleOrders = selection.eligible.length;
    result.alreadyManifestedOrders = selection.alreadyManifested.length;
    result.notReadyOrders = selection.notReady.length;
    result.missingOrders = selection.missingRequested;
    result.existingManifestIds = unique(selection.alreadyManifested.map((order) => text(order.manifestId)).filter(Boolean));
    record({
      kind: 'step',
      stage: 'clasificando pedidos',
      message: `${selection.eligible.length} nuevo(s), ${selection.alreadyManifested.length} ya manifestado(s), ${selection.notReady.length} no listo(s) y ${selection.missingRequested} no encontrado(s).`,
    });
    if (!selection.eligible.length) {
      step('consultando los manifiestos existentes', 'Recuperando los datos imprimibles de los manifiestos ya detectados.');
      const existingManifests = await listManifests(session);
      const cached = matchFalabellaReadyOrderManifests(providerOrders, existingManifests, requested);
      await upsertCachedFalabellaManifests(company.id, cached);
      result.existingManifestIds = unique([
        ...result.existingManifestIds,
        ...cached.flatMap((manifest) => [manifest.id, manifest.code]).filter(Boolean),
      ]);
      step('sin pedidos nuevos por manifestar', 'Todos los pedidos solicitados ya tienen manifiesto o ya no están listos para enviar.');
      return finish();
    }

    step('consultando los manifiestos existentes', 'Tomando una fotografía lógica de los manifiestos antes de crear.');
    const before = await listManifests(session);
    step('creando los manifiestos', `Enviando ${selection.eligible.length} pedido(s) nuevo(s) a Falabella.`);
    const createResponse = await jsonRequest(session, 'v1/manifest/create', {
      method: 'POST',
      body: { orders: selection.eligible.map((order) => text(order.deliveryOrderNumber)) },
    });
    const createResponseEntries = asArray<WebManifest>(createResponse?.created);
    result.notAllowedOrders = asArray(createResponse?.notAllowed).map((value: any) => (
      text(value?.deliveryOrderNumber ?? value?.orderNumber ?? value)
    )).filter(Boolean);
    const existingOrders = asArray(createResponse?.existing).map((value: any) => (
      text(value?.deliveryOrderNumber ?? value?.orderNumber ?? value)
    )).filter(Boolean);

    let after: WebManifest[] = [];
    let created: WebManifest[] = [];
    step('verificando los manifiestos creados', 'Comprobando que los nuevos manifiestos aparezcan en Seller Center.');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      after = await listManifests(session);
      created = findNewFalabellaManifests(before, after, selection.eligible, createResponse);
      if (created.length || !createResponseEntries.length) break;
      await wait(1_000);
    }

    if (!created.length && createResponseEntries.length) {
      created = createResponseEntries.filter((manifest) => text(manifest.id));
    }
    if (!created.length && createResponseEntries.length) {
      throw new Error('Falabella confirmó la creación, pero el manifiesto todavía no aparece para descargarlo.');
    }

    result.createdManifests = created.length;
    const notCreated = new Set([...result.notAllowedOrders, ...existingOrders]);
    result.createdOrders = createResponseEntries.length
      ? selection.eligible.filter((order) => (
        !webOrderIdentifiers(order).some((identifier) => notCreated.has(identifier))
      )).length
      : 0;
    result.manifestIds = unique(created.map((manifest) => text(manifest.id)).filter(Boolean));
    result.manifestCodes = unique(created.map((manifest) => text(manifest.code)).filter(Boolean));
    const providerOrdersAfterCreate = providerOrders.map((order) => {
      if (text(order.manifestId)) return order;
      const identifiers = new Set(webOrderIdentifiers(order));
      const manifest = created.find((candidate) => asArray(candidate.orderNumbers).map(text)
        .some((orderNumber) => identifiers.has(orderNumber)))
        || (created.length === 1 && selection.eligible.includes(order) ? created[0] : null);
      return manifest ? { ...order, manifestId: text(manifest.id) || text(manifest.code) } : order;
    });
    const matchedManifests = matchFalabellaReadyOrderManifests(
      providerOrdersAfterCreate,
      [...created, ...after],
      requested,
    );
    const matchedCreated = matchFalabellaReadyOrderManifests(
      providerOrdersAfterCreate,
      created,
      requested,
    );
    const createdSummaries = created.map((manifest) => {
      const manifestId = text(manifest.id);
      const manifestCode = text(manifest.code);
      return matchedCreated.find((candidate) => (
        (manifestId && candidate.id === manifestId)
        || (manifestCode && candidate.code === manifestCode)
      )) || {
        id: manifestId,
        code: manifestCode,
        carrier: text(manifest.carrier),
        numberOfItems: Math.max(0, Number(manifest.numberOfItems) || 0),
        status: text(manifest.status),
        createdAt: text(manifest.createdAt),
        orders: [],
      };
    });
    const cachedManifests = mergeFalabellaManifestSummaries(matchedManifests, createdSummaries);
    await upsertCachedFalabellaManifests(
      company.id,
      cachedManifests,
      [...result.manifestIds, ...result.manifestCodes],
    );
    if (created.length) {
      step('descargando los manifiestos creados', 'Generando el PDF que devuelve Falabella.');
      const documents: CompanyDocument[] = [];
      for (const manifest of created) {
        const manifestId = text(manifest.id);
        if (!manifestId) {
          throw new Error('Falabella creó un manifiesto sin identificador de impresión.');
        }
        const document = await downloadManifests(session, [manifest]);
        await cacheFalabellaManifestDocument(company.id, manifestId, document);
        documents.push(document);
      }
      result.document = await combineFalabellaManifestDocuments(documents);
    }
    step('proceso completado', `${result.createdManifests} manifiesto(s) creado(s) para ${result.createdOrders} pedido(s).`);
    return finish();
  } catch (error: any) {
    const message = falabellaManifestErrorMessage(error);
    record({ kind: 'error', stage, message });
    result.ok = false;
    result.error = `${stage}: ${message}`;
    result.diagnostic = await capturePageDiagnostic(page, stage, events);
    return result;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

async function createFalabellaWebManifestsUnlocked(
  input: CreateFalabellaWebManifestsInput = {},
): Promise<CreateFalabellaWebManifestsResult> {
  const selectedOrders = Array.isArray(input.orders) ? input.orders : [];
  const validSelection = selectedOrders.length > 0 && selectedOrders.every((order) => {
    const rawCompanyId = order?.companyId;
    const companyId = typeof rawCompanyId === 'string' || typeof rawCompanyId === 'number'
      ? Number(rawCompanyId)
      : Number.NaN;
    const hasIdentity = [order?.orderId, order?.orderNumber].some((value) => (
      (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
      && text(value)
    ));
    return Number.isInteger(companyId) && companyId > 0 && hasIdentity;
  });
  if (!validSelection) {
    return {
      companies: 0, failedCompanies: 0, createdManifests: 0, createdOrders: 0,
      documentCount: 0, source: 'local_cache', syncedAt: '', results: [],
    };
  }
  const requestedByCompany = new Map<number, FalabellaManifestOrderInput[]>();
  for (const order of selectedOrders) {
    const companyId = Number(order.companyId);
    const values = requestedByCompany.get(companyId) || [];
    values.push({ ...order, companyId });
    requestedByCompany.set(companyId, values);
  }

  const companies = (await Promise.all([...requestedByCompany.keys()].map(getCompany)))
    .filter((company): company is CompanyRecord => Boolean(company));
  if (!companies.length) {
    return {
      companies: 0, failedCompanies: 0, createdManifests: 0, createdOrders: 0,
      documentCount: 0, source: 'local_cache', syncedAt: '', results: [],
    };
  }

  const cacheByCompany = new Map<number, FalabellaManifestCacheLookup>();
  const cacheLookupDurationByCompany = new Map<number, number>();
  for (const company of companies) {
    const requested = requestedByCompany.get(company.id) || [];
    const lookupStartedAt = Date.now();
    cacheByCompany.set(company.id, await readCachedFalabellaManifests(company.id, requested));
    cacheLookupDurationByCompany.set(company.id, Math.max(1, Date.now() - lookupStartedAt));
  }
  const resultByCompany = new Map<number, FalabellaManifestCompanyResult>();
  const remoteCompanies = companies.filter((company) => {
    const requested = requestedByCompany.get(company.id) || [];
    const cache = cacheByCompany.get(company.id)!;
    if (falabellaManifestNeedsRemote(requested, cache)) return true;
    const result = createResultBase(company, requested);
    result.source = 'local_cache';
    result.syncedAt = cache.syncedAt;
    result.alreadyManifestedOrders = requested.length;
    result.existingManifestIds = unique(cache.manifests
      .flatMap((manifest) => [manifest.id, manifest.code]).filter(Boolean));
    result.diagnostic = falabellaLocalCacheDiagnostic(
      requested.length,
      cacheLookupDurationByCompany.get(company.id) || 1,
    );
    resultByCompany.set(company.id, result);
    return false;
  });

  if (!remoteCompanies.length) {
    const results = companies.map((company) => resultByCompany.get(company.id)!);
    return {
      companies: results.length,
      failedCompanies: 0,
      createdManifests: 0,
      createdOrders: 0,
      documentCount: 0,
      source: resultSource(results),
      syncedAt: resultSyncedAt(results),
      results,
    };
  }

  let browser: Browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    for (const company of remoteCompanies) {
      resultByCompany.set(company.id, failedCompanyResult(
        company,
        requestedByCompany.get(company.id) || [],
        'iniciando el navegador de Falabella',
        error,
      ));
    }
    const results = companies.map((company) => resultByCompany.get(company.id)!);
    return {
      companies: results.length,
      failedCompanies: results.filter((result) => !result.ok).length,
      createdManifests: 0,
      createdOrders: 0,
      documentCount: 0,
      source: resultSource(results),
      syncedAt: resultSyncedAt(results),
      results,
    };
  }
  try {
    for (const company of remoteCompanies) {
      const allRequested = requestedByCompany.get(company.id) || [];
      const cache = cacheByCompany.get(company.id)!;
      const remote = await withFalabellaManifestCompanyLock(company.id, () => processCompany(
        browser,
        company,
        allRequested.length ? cache.missingOrders : allRequested,
      ));
      remote.requestedOrders = allRequested.length;
      remote.alreadyManifestedOrders += allRequested.length - cache.missingOrders.length;
      remote.existingManifestIds = unique([
        ...remote.existingManifestIds,
        ...cache.manifests.flatMap((manifest) => [manifest.id, manifest.code]).filter(Boolean),
      ]);
      resultByCompany.set(company.id, remote);
    }
  } finally {
    await browser.close();
  }
  const results = companies.map((company) => resultByCompany.get(company.id)!);
  return {
    companies: results.length,
    failedCompanies: results.filter((result) => !result.ok).length,
    createdManifests: results.reduce((total, result) => total + result.createdManifests, 0),
    createdOrders: results.reduce((total, result) => total + result.createdOrders, 0),
    documentCount: results.filter((result) => Boolean(result.document?.base64)).length,
    source: resultSource(results),
    syncedAt: resultSyncedAt(results),
    results,
  };
}

async function listFalabellaWebManifestsUnlocked(
  input: CreateFalabellaWebManifestsInput = {},
): Promise<ListFalabellaWebManifestsResult> {
  const requestedByCompany = new Map<number, FalabellaManifestOrderInput[]>();
  for (const order of input.orders || []) {
    const companyId = Number(order?.companyId);
    if (!Number.isInteger(companyId) || companyId <= 0) continue;
    const values = requestedByCompany.get(companyId) || [];
    values.push({ ...order, companyId });
    requestedByCompany.set(companyId, values);
  }
  if (!requestedByCompany.size) {
    return {
      companies: 0, failedCompanies: 0, manifestedOrders: 0, manifests: 0,
      source: 'local_cache', syncedAt: '', results: [],
    };
  }

  const companies = (await Promise.all([...requestedByCompany.keys()].map(getCompany)))
    .filter((company): company is CompanyRecord => Boolean(company));
  const results: FalabellaManifestListCompanyResult[] = [];
  for (const company of companies) {
    const requested = requestedByCompany.get(company.id) || [];
    const cache = await readCachedFalabellaManifests(company.id, requested);
    results.push({
      companyId: company.id,
      companyName: text(company.razonSocial || company.nombre),
      ok: true,
      requestedOrders: requested.length,
      providerOrders: 0,
      manifestedOrders: cache.manifests.reduce((total, manifest) => total + manifest.orders.length, 0),
      manifests: cache.manifests,
      source: 'local_cache',
      syncedAt: cache.syncedAt,
    });
  }
  return {
    companies: results.length,
    failedCompanies: 0,
    manifestedOrders: results.reduce((total, result) => total + result.manifestedOrders, 0),
    manifests: results.reduce((total, result) => total + result.manifests.length, 0),
    source: 'local_cache',
    syncedAt: resultSyncedAt(results),
    results,
  };
}

function manifestDocumentKey(companyId: number, manifestId: string): string {
  return `${companyId}:${manifestId}`;
}

async function downloadAndCacheMissingManifestDocuments(
  resolved: ResolvedFalabellaManifestDocumentRequest[],
  documents: Map<string, CompanyDocument>,
): Promise<void> {
  // Revisa la caché nuevamente dentro del lock: otro worker pudo completar la
  // descarga mientras esta solicitud esperaba.
  const missing: ResolvedFalabellaManifestDocumentRequest[] = [];
  for (const entry of resolved) {
    const key = manifestDocumentKey(entry.companyId, entry.manifest.id);
    const cached = await readCachedFalabellaManifestDocument(entry.companyId, entry.manifest.id);
    if (cached) documents.set(key, cached);
    else missing.push(entry);
  }
  if (!missing.length) return;

  const grouped = new Map<number, ResolvedFalabellaManifestDocumentRequest[]>();
  for (const entry of missing) {
    const values = grouped.get(entry.companyId) || [];
    values.push(entry);
    grouped.set(entry.companyId, values);
  }
  const companies = new Map<number, CompanyRecord>();
  for (const companyId of grouped.keys()) {
    const company = await getCompany(companyId);
    if (!company) throw new Error(`No se encontró la tienda ${companyId}.`);
    companies.set(companyId, company);
  }

  const browsers: Browser[] = [];
  try {
    for (const [companyId, entries] of grouped) {
      const company = companies.get(companyId)!;
      await withFalabellaManifestCompanyLock(companyId, async () => {
        const uncached: ResolvedFalabellaManifestDocumentRequest[] = [];
        for (const entry of entries) {
          const key = manifestDocumentKey(companyId, entry.manifest.id);
          const cached = await readCachedFalabellaManifestDocument(companyId, entry.manifest.id);
          if (cached) documents.set(key, cached);
          else uncached.push(entry);
        }
        if (!uncached.length) return;

        if (!browsers[0]) browsers.push(await launchBrowser());
        const context = await browsers[0].createBrowserContext();
        let stage = 'iniciando sesión en Falabella';
        try {
          const page = await context.newPage();
          await login(page, company, (nextStage) => { stage = nextStage; });
          stage = 'abriendo la bandeja de pedidos';
          const session = await createSession(page, () => undefined);
          for (const entry of uncached) {
            stage = `descargando el manifiesto ${entry.manifest.code || entry.manifest.id}`;
            const document = await downloadManifests(session, [entry.manifest]);
            await cacheFalabellaManifestDocument(companyId, entry.manifest.id, document);
            documents.set(manifestDocumentKey(companyId, entry.manifest.id), document);
          }
        } catch (error: any) {
          throw new Error(
            `${text(company.razonSocial || company.nombre)}: ${stage}: ${falabellaManifestErrorMessage(error)}`,
          );
        } finally {
          await context.close().catch(() => undefined);
        }
      });
    }
  } finally {
    await Promise.all(browsers.map((browser) => browser.close().catch(() => undefined)));
  }
}

export async function withManifestRunLock<T>(operation: () => Promise<T>): Promise<T> {
  const previousRun = manifestRunTail;
  let release!: () => void;
  manifestRunTail = new Promise<void>((resolve) => { release = resolve; });
  await previousRun.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function createFalabellaWebManifests(
  input: CreateFalabellaWebManifestsInput = {},
): Promise<CreateFalabellaWebManifestsResult> {
  return withManifestRunLock(() => createFalabellaWebManifestsUnlocked(input));
}

export async function listFalabellaWebManifests(
  input: CreateFalabellaWebManifestsInput = {},
): Promise<ListFalabellaWebManifestsResult> {
  return listFalabellaWebManifestsUnlocked(input);
}

export async function getFalabellaWebManifestDocument(input: {
  companyId: number;
  manifestId: string;
}): Promise<CompanyDocument & { companyId: number; companyName: string }> {
  const result = await getFalabellaWebManifestDocuments([input]);
  const document = result.documents[0];
  if (!document) throw new Error('No se pudo abrir el manifiesto solicitado.');
  return document;
}

export async function getFalabellaWebManifestDocuments(
  requests: FalabellaManifestDocumentRequest[],
): Promise<FalabellaManifestDocumentsResult> {
  const resolved = await resolveCachedFalabellaManifestDocumentRequests(requests);
  const documentsByKey = new Map<string, CompanyDocument>();
  for (const entry of resolved) {
    const cached = await readCachedFalabellaManifestDocument(entry.companyId, entry.manifest.id);
    if (cached) {
      documentsByKey.set(manifestDocumentKey(entry.companyId, entry.manifest.id), cached);
    }
  }
  if (documentsByKey.size < resolved.length) {
    await withManifestRunLock(() => downloadAndCacheMissingManifestDocuments(resolved, documentsByKey));
  }

  const companies = new Map<number, CompanyRecord>();
  for (const companyId of unique(resolved.map((entry) => entry.companyId))) {
    const company = await getCompany(companyId);
    if (!company) throw new Error(`No se encontró la tienda ${companyId}.`);
    companies.set(companyId, company);
  }
  const documents: FalabellaManifestDocumentsResult['documents'] = [];
  for (const entry of resolved) {
    const key = manifestDocumentKey(entry.companyId, entry.manifest.id);
    const document = documentsByKey.get(key);
    if (!document) {
      throw new Error(`No se pudo obtener el PDF del manifiesto ${entry.manifest.code || entry.manifest.id}.`);
    }
    const company = companies.get(entry.companyId)!;
    documents.push({
      ...document,
      companyId: entry.companyId,
      companyName: text(company.razonSocial || company.nombre),
    });
  }
  // Sólo cuenta una impresión cuando el conjunto completo quedó disponible;
  // nunca se omiten manifiestos silenciosamente.
  for (const entry of resolved) {
    await recordCachedFalabellaManifestDownload(entry.companyId, entry.manifest.id);
  }
  return {
    requested: requests.length,
    downloaded: resolved.length,
    companies: companies.size,
    documents,
  };
}
