// Servicio Falabella compartido entre core y server.
// Orquesta el cliente Falabella (@zentofact/falabella-api) + queries/servicios del core.
import { readFileSync } from 'fs';
import { FalabellaApiClient, getFalabellaError, normalizeGetOrdersResult, buildIsoUtcTimestamp, signParameters, canonicalizeParameters } from '@zentofact/falabella-api';
import type { GetOrdersV2Filters } from '@zentofact/falabella-api';
import type { VentaItem } from '../index';
import { getCompany } from './company.service';
import { listBoletas } from './boleta-query.service';
import { listFacturas } from './factura-query.service';
import { listCreditNotes } from './credit-note-query.service';
import { generateAcceptedBoletaPdfBase64, markBoletaFalabellaPdfUpload } from './boleta.service';
import { recordFacturaUpload, generateAcceptedFacturaPdfBase64 } from './factura.service';

async function requireCompanyWithFalabella(companyId: number) {
  const company = await getCompany(companyId);
  if (!company || !company.activo) return { error: 'Empresa no encontrada o inactiva.' as const };
  if (!company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
    return { error: 'La empresa no tiene credenciales de Falabella API configuradas.' as const };
  }
  return { company };
}

function escXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function signedFalabellaUrl(company: any, action: string, extraParams: Record<string, string> = {}) {
  const params: Record<string, string> = {
    Action: action,
    Format: 'JSON',
    Timestamp: buildIsoUtcTimestamp(),
    UserID: company.falabellaApiUserId,
    Version: process.env.FALABELLA_API_VERSION || '1.0',
    ...extraParams,
  };
  params.Signature = signParameters(params, company.falabellaApiKey);
  return `https://sellercenter-api.falabella.com/?${canonicalizeParameters(params)}`;
}

async function parseFalabellaResponse(response: Response) {
  const rawText = await response.text();
  let data: any = rawText;
  try { data = JSON.parse(rawText); } catch {}
  const error = getFalabellaError(data);
  return { ok: response.ok, status: response.status, error, data, rawText };
}

function extractWebhooks(data: any): any[] {
  const candidate =
    data?.SuccessResponse?.Body?.Webhooks?.Webhook
    || data?.SuccessResponse?.Body?.Webhook
    || data?.Webhooks?.Webhook
    || data?.Webhook
    || data?.webhooks
    || data?.data?.webhooks;
  if (Array.isArray(candidate)) return candidate;
  if (candidate && typeof candidate === 'object') return [candidate];
  return [];
}

function webhookIdOf(webhook: any): string {
  return String(webhook?.WebhookId ?? webhook?.Webhook ?? webhook?.id ?? webhook?.webhookId ?? '').trim();
}

function webhookEventsOf(webhook: any): string[] {
  const events = webhook?.Events?.Event ?? webhook?.Event ?? webhook?.events ?? webhook?.Events;
  if (Array.isArray(events)) return events.map((event) => String(event)).filter(Boolean);
  if (events == null) return [];
  return [String(events)].filter(Boolean);
}

function normalizeWebhook(webhook: any) {
  return {
    webhookId: webhookIdOf(webhook),
    callbackUrl: String(webhook?.CallbackUrl ?? webhook?.callbackUrl ?? ''),
    webhookSource: String(webhook?.WebhookSource ?? webhook?.webhookSource ?? ''),
    events: webhookEventsOf(webhook),
    raw: webhook,
  };
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

function readPath(value: any, path: string[]) {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function normalizeGetProductsResult(data: any): { totalCount: number | null; products: any[] } {
  const candidates = [
    readPath(data, ['SuccessResponse', 'Body', 'Products', 'Product']),
    readPath(data, ['SuccessResponse', 'Body', 'Product']),
    readPath(data, ['Products', 'Product']),
    readPath(data, ['Product']),
    readPath(data, ['products']),
    readPath(data, ['data', 'products']),
  ];
  const products = candidates.flatMap(asArray);
  const totalCandidates = [
    readPath(data, ['SuccessResponse', 'Head', 'TotalCount']),
    readPath(data, ['SuccessResponse', 'Body', 'TotalCount']),
    readPath(data, ['Head', 'TotalCount']),
    readPath(data, ['totalCount']),
    readPath(data, ['data', 'totalCount']),
  ];
  const totalCount = totalCandidates.map(Number).find((value) => Number.isFinite(value)) ?? null;
  return { totalCount, products };
}

function productImages(product: any): string[] {
  const raw = product?.Images?.Image ?? product?.Images ?? product?.ProductData?.Images?.Image ?? product?.ProductData?.Image ?? product?.Image;
  return [product?.MainImage, ...asArray(raw)]
    .map((image) => (typeof image === 'string' ? image : image?.Url || image?.URL || image?.url || image?.Image))
    .map((image) => String(image || '').trim())
    .filter(Boolean);
}

function productStatus(product: any): string {
  const status = product?.Status ?? product?.ProductStatus ?? product?.SellerStatus ?? product?.VariationStatus;
  if (Array.isArray(status)) return status.map((entry) => String(entry?.Status || entry || '')).filter(Boolean).join(', ');
  if (status && typeof status === 'object') return String(status.Status || status.Name || JSON.stringify(status));
  return String(status || '');
}

function normalizeProduct(product: any) {
  const productData = product?.ProductData || {};
  const businessUnits = asArray(product?.BusinessUnits?.BusinessUnit ?? product?.BusinessUnits).map((unit) => ({
    name: String(unit?.BusinessUnit ?? unit?.Name ?? '').trim(),
    operatorCode: String(unit?.OperatorCode ?? '').trim(),
    price: unit?.Price ?? null,
    specialPrice: unit?.SpecialPrice ?? null,
    stock: unit?.Stock ?? null,
    status: String(unit?.Status ?? '').trim(),
    isPublished: String(unit?.IsPublished ?? '').trim(),
    raw: unit,
  }));
  const primaryUnit = businessUnits[0] || {};
  const sellerSku = String(product?.SellerSku ?? product?.SellerSKU ?? product?.SkuSeller ?? product?.SkuSellerList ?? productData?.SellerSku ?? '').trim();
  const shopSku = String(product?.ShopSku ?? product?.ShopSKU ?? product?.Sku ?? productData?.ShopSku ?? '').trim();
  const name = String(product?.Name ?? product?.ProductName ?? productData?.Name ?? productData?.ProductName ?? sellerSku ?? '').trim();
  const quantity = product?.Quantity ?? product?.Available ?? product?.Stock ?? product?.StockAvailable ?? productData?.Quantity ?? primaryUnit.stock ?? null;
  const price = product?.Price ?? product?.ProductData?.Price ?? product?.SpecialPrice ?? primaryUnit.price ?? null;
  const salePrice = product?.SalePrice ?? product?.SpecialPrice ?? product?.ProductData?.SalePrice ?? primaryUnit.specialPrice ?? null;
  const variations = asArray(product?.Variations?.Variation ?? product?.Variations ?? product?.Variation);
  return {
    sellerSku,
    shopSku,
    name,
    brand: String(product?.Brand ?? productData?.Brand ?? '').trim(),
    primaryCategory: String(product?.PrimaryCategory ?? productData?.PrimaryCategory ?? '').trim(),
    price,
    salePrice,
    quantity,
    status: productStatus(product) || primaryUnit.status || product?.QCStatus || '',
    images: productImages(product),
    productId: String(product?.ProductId ?? product?.ProductID ?? product?.Id ?? '').trim(),
    url: String(product?.Url ?? product?.URL ?? '').trim(),
    contentScore: product?.ContentScore ?? null,
    qcStatus: String(product?.QCStatus ?? '').trim(),
    createdAt: String(product?.CreatedAt ?? product?.Created ?? '').trim(),
    updatedAt: String(product?.UpdatedAt ?? product?.Updated ?? '').trim(),
    variationsCount: variations.length,
    businessUnits,
    raw: product,
  };
}

function normalizeFeed(feed: any) {
  return {
    feedId: String(feed?.Feed ?? feed?.FeedId ?? feed?.FeedID ?? feed?.RequestId ?? feed?.id ?? '').trim(),
    action: String(feed?.Action ?? feed?.FeedAction ?? feed?.RequestAction ?? '').trim(),
    status: String(feed?.Status ?? feed?.FeedStatus ?? '').trim(),
    source: String(feed?.Source ?? '').trim(),
    totalRecords: feed?.TotalRecords ?? feed?.Total ?? null,
    processedRecords: feed?.ProcessedRecords ?? feed?.Processed ?? null,
    failedRecords: feed?.FailedRecords ?? feed?.Failed ?? null,
    createdAt: String(feed?.CreatedAt ?? feed?.CreationDate ?? feed?.Created ?? '').trim(),
    updatedAt: String(feed?.UpdatedAt ?? feed?.Updated ?? '').trim(),
    raw: feed,
  };
}

function extractFeeds(data: any): any[] {
  const candidates = [
    readPath(data, ['SuccessResponse', 'Body', 'FeedList', 'Feed']),
    readPath(data, ['SuccessResponse', 'Body', 'Feeds', 'Feed']),
    readPath(data, ['SuccessResponse', 'Body', 'Feed']),
    readPath(data, ['FeedList', 'Feed']),
    readPath(data, ['Feeds', 'Feed']),
    readPath(data, ['Feed']),
    readPath(data, ['feeds']),
  ];
  return candidates.flatMap(asArray);
}

function extractFeedStatus(data: any): any {
  return readPath(data, ['SuccessResponse', 'Body', 'FeedDetail'])
    || readPath(data, ['SuccessResponse', 'Body', 'Feed'])
    || readPath(data, ['FeedDetail'])
    || readPath(data, ['Feed'])
    || data;
}

function productCreateXml(input: any) {
  const productData = input.productData || {};
  const extraAttributes = input.extraAttributes || {};
  const productDataXml = Object.entries({
    ConditionType: input.conditionType || productData.ConditionType || 'Nuevo',
    PackageHeight: input.packageHeight || productData.PackageHeight,
    PackageWidth: input.packageWidth || productData.PackageWidth,
    PackageLength: input.packageLength || productData.PackageLength,
    PackageWeight: input.packageWeight || productData.PackageWeight,
    ...productData,
  })
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => `      <${key}>${escXml(value)}</${key}>`)
    .join('\n');
  const extraXml = Object.entries(extraAttributes)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => `    <${key}>${escXml(value)}</${key}>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${escXml(input.sellerSku)}</SellerSku>
    ${input.parentSku ? `<ParentSku>${escXml(input.parentSku)}</ParentSku>` : ''}
    <Name>${escXml(input.name)}</Name>
    <PrimaryCategory>${escXml(input.primaryCategory)}</PrimaryCategory>
    <Description><![CDATA[${String(input.description || '').replaceAll(']]>', ']]]]><![CDATA[>')}]]></Description>
    <Brand>${escXml(input.brand)}</Brand>
    ${input.productId ? `<ProductId>${escXml(input.productId)}</ProductId>` : ''}
${extraXml}
    <BusinessUnits>
      <BusinessUnit>
        <OperatorCode>${escXml(input.operatorCode || 'fape')}</OperatorCode>
        <Price>${escXml(input.price)}</Price>
        ${input.specialPrice ? `<SpecialPrice>${escXml(input.specialPrice)}</SpecialPrice>` : ''}
        ${input.specialFromDate ? `<SpecialFromDate>${escXml(input.specialFromDate)}</SpecialFromDate>` : ''}
        ${input.specialToDate ? `<SpecialToDate>${escXml(input.specialToDate)}</SpecialToDate>` : ''}
        <Stock>${escXml(input.stock)}</Stock>
        <Status>${escXml(input.status || 'active')}</Status>
      </BusinessUnit>
    </BusinessUnits>
    <ProductData>
${productDataXml}
    </ProductData>
  </Product>
</Request>`;
}

function requireProductCreateFields(input: any) {
  const required = [
    ['sellerSku', 'SKU del seller'],
    ['name', 'Nombre'],
    ['primaryCategory', 'Categoria principal'],
    ['description', 'Descripcion'],
    ['brand', 'Marca'],
    ['operatorCode', 'OperatorCode'],
    ['price', 'Precio'],
    ['stock', 'Stock'],
    ['status', 'Estado'],
    ['packageHeight', 'Alto paquete'],
    ['packageWidth', 'Ancho paquete'],
    ['packageLength', 'Largo paquete'],
    ['packageWeight', 'Peso paquete'],
  ];
  const missing = required.filter(([key]) => String(input?.[key] ?? '').trim() === '').map(([, label]) => label);
  if (missing.length) return `Faltan campos: ${missing.join(', ')}.`;
  if (String(input.description || '').trim().length < 6) return 'La descripcion debe tener al menos 6 caracteres.';
  return '';
}

export async function falabellaGetOrders(payload: { companyId: number; filters: GetOrdersV2Filters }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  if (!payload.filters?.createdAfter && !payload.filters?.updatedAfter) {
    return { error: 'Debes indicar Created After o Updated After.' };
  }
  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId!, apiKey: company.falabellaApiKey!, version: '2.0', defaultFormat: 'JSON' });
  const response = await client.getOrdersV2(payload.filters);
  const error = getFalabellaError(response.data);
  if (error) return { ok: response.ok, status: response.status, url: response.url, error };
  const normalized = normalizeGetOrdersResult(response.data);
  return { ok: response.ok, status: response.status, url: response.url, totalCount: normalized.totalCount, orders: normalized.orders };
}

export async function falabellaGetProducts(payload: {
  companyId: number;
  filters?: {
    search?: string;
    filter?: string;
    limit?: number;
    offset?: number;
    skuSellerList?: string[];
    createdAfter?: string;
    createdBefore?: string;
    updatedAfter?: string;
    updatedBefore?: string;
    globalIdentifier?: number;
    includeTotal?: boolean;
    countOnly?: boolean;
  };
}) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const filters = payload.filters || {};
  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 1000);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const skuSellerList = (filters.skuSellerList || []).map((sku) => String(sku).trim()).filter(Boolean);
  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId!, apiKey: company.falabellaApiKey!, version: '1.0', defaultFormat: 'JSON' });
  const response = await client.call({
    action: 'GetProducts',
    params: {
      Search: filters.search?.trim() || undefined,
      Filter: filters.filter || 'all',
      Limit: limit,
      Offset: offset,
      SkuSellerList: skuSellerList.length ? JSON.stringify(skuSellerList) : undefined,
      CreatedAfter: filters.createdAfter || undefined,
      CreatedBefore: filters.createdBefore || undefined,
      UpdatedAfter: filters.updatedAfter || undefined,
      UpdatedBefore: filters.updatedBefore || undefined,
      GlobalIdentifier: filters.globalIdentifier,
    },
  });
  const error = getFalabellaError(response.data);
  if (error) return { ok: response.ok, status: response.status, url: response.url, error };
  const normalized = normalizeGetProductsResult(response.data);
  let totalCount = normalized.totalCount;
  if (filters.includeTotal || filters.countOnly) {
    totalCount = 0;
    const countLimit = 1000;
    for (let countOffset = 0; countOffset < 20000; countOffset += countLimit) {
      const countResponse = await client.call({
        action: 'GetProducts',
        params: {
          Search: filters.search?.trim() || undefined,
          Filter: filters.filter || 'all',
          Limit: countLimit,
          Offset: countOffset,
          SkuSellerList: skuSellerList.length ? JSON.stringify(skuSellerList) : undefined,
          CreatedAfter: filters.createdAfter || undefined,
          CreatedBefore: filters.createdBefore || undefined,
          UpdatedAfter: filters.updatedAfter || undefined,
          UpdatedBefore: filters.updatedBefore || undefined,
          GlobalIdentifier: filters.globalIdentifier,
        },
      });
      const countError = getFalabellaError(countResponse.data);
      if (countError) break;
      const countNormalized = normalizeGetProductsResult(countResponse.data);
      totalCount += countNormalized.products.length;
      if (countNormalized.products.length < countLimit) break;
    }
  }
  if (filters.countOnly) {
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      totalCount,
      products: [],
    };
  }
  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    totalCount,
    products: normalized.products.map(normalizeProduct),
  };
}

export async function falabellaCreateProduct(payload: { companyId: number; product: any }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const product = payload.product || {};
  const validationError = requireProductCreateFields(product);
  if (validationError) return { ok: false, error: validationError };
  const body = productCreateXml(product);
  const response = await fetch(signedFalabellaUrl(company, 'ProductCreate'), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/xml' },
    body,
  });
  const result = await parseFalabellaResponse(response);
  const requestId = result.data?.SuccessResponse?.Head?.RequestId || result.data?.Head?.RequestId || '';
  return { ...result, requestId, xml: body };
}

export async function falabellaGetFeeds(payload: { companyId: number; filters?: { action?: string; status?: string; limit?: number; offset?: number } }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const filters = payload.filters || {};
  const response = await fetch(signedFalabellaUrl(company, 'FeedList', {
    ActionFilter: filters.action || '',
    Status: filters.status || '',
    Limit: String(Math.min(Math.max(Number(filters.limit || 50), 1), 1000)),
    Offset: String(Math.max(Number(filters.offset || 0), 0)),
  }), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  const result = await parseFalabellaResponse(response);
  return { ...result, feeds: extractFeeds(result.data).map(normalizeFeed) };
}

export async function falabellaGetFeedStatus(payload: { companyId: number; feedId: string }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const feedId = String(payload.feedId || '').trim();
  if (!feedId) return { ok: false, error: 'Falta FeedID.' };
  const response = await fetch(signedFalabellaUrl(company, 'FeedStatus', { FeedID: feedId }), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  const result = await parseFalabellaResponse(response);
  return { ...result, feed: normalizeFeed(extractFeedStatus(result.data)) };
}

export async function falabellaGetWebhooks(payload: { companyId: number; webhookIds?: string[] }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const webhookIds = (payload.webhookIds || []).map((id) => String(id).trim()).filter(Boolean);
  const extraParams: Record<string, string> = webhookIds.length ? { WebhookIds: `[${webhookIds.join(',')}]` } : {};
  const response = await fetch(signedFalabellaUrl(company, 'GetWebhooks', extraParams), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  const result = await parseFalabellaResponse(response);
  return { ...result, webhooks: extractWebhooks(result.data).map(normalizeWebhook) };
}

export async function falabellaCreateWebhook(payload: { companyId: number; callbackUrl: string; events: string[] }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const callbackUrl = String(payload.callbackUrl || '').trim();
  const events = Array.from(new Set((payload.events || []).map((event) => String(event).trim()).filter(Boolean)));
  if (!callbackUrl) return { ok: false, error: 'Falta la URL del webhook.' };
  if (!events.length) return { ok: false, error: 'Selecciona al menos un evento de Falabella.' };
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Webhook>
    <CallbackUrl>${escXml(callbackUrl)}</CallbackUrl>
    <Events>
${events.map((event) => `      <Event>${escXml(event)}</Event>`).join('\n')}
    </Events>
  </Webhook>
</Request>`;
  const response = await fetch(signedFalabellaUrl(company, 'CreateWebhook'), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/xml' },
    body,
  });
  return parseFalabellaResponse(response);
}

export async function falabellaDeleteWebhook(payload: { companyId: number; webhookId: string }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const webhookId = String(payload.webhookId || '').trim();
  if (!webhookId) return { ok: false, error: 'Falta el ID del webhook.' };
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Webhook>${escXml(webhookId)}</Webhook>
</Request>`;
  const response = await fetch(signedFalabellaUrl(company, 'DeleteWebhook'), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/xml' },
    body,
  });
  return parseFalabellaResponse(response);
}

export async function falabellaGetOrderItems(payload: { companyId: number; orderId: string | number }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId!, apiKey: company.falabellaApiKey!, version: '1.0', defaultFormat: 'JSON' });
  const response = await client.call({ action: 'GetOrderItems', params: { OrderId: payload.orderId }, accept: 'application/json' });
  const error = getFalabellaError(response.data);
  if (error) return { ok: response.ok, status: response.status, url: response.url, error };
  const orderItems = extractOrderItems(response.data);
  return { ok: response.ok, status: response.status, url: response.url, orderItems, orderItemIds: normalizeOrderItemIds(orderItems.map(getOrderItemId)) };
}

export async function falabellaBuildBoletaVenta(payload: { companyId: number; order: any }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const order = payload.order?.Order && typeof payload.order.Order === 'object' ? payload.order.Order : payload.order;
  const orderId = order?.OrderId;
  const orderNumber = String(order?.OrderNumber || '').trim();
  if (!orderId || !orderNumber) return { error: 'La orden no tiene OrderId u OrderNumber.' };
  if (isInvoiceRequiredForBoletaBuilder(order?.InvoiceRequired)) {
    return { error: 'Esta orden está marcada como factura en Falabella. No se puede emitir boleta.' };
  }
  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId!, apiKey: company.falabellaApiKey!, version: '1.0', defaultFormat: 'JSON' });
  const itemsResponse = await client.call({ action: 'GetOrderItems', params: { OrderId: orderId }, accept: 'application/json' });
  const error = getFalabellaError(itemsResponse.data);
  if (error) return { ok: itemsResponse.ok, status: itemsResponse.status, url: itemsResponse.url, error };
  const orderItems = extractOrderItems(itemsResponse.data);
  const total = orderTotalForBoletaBuilder(order);
  const warnings: string[] = [];
  const clientDocNumber = getOrderCustomerDocument(order);
  const clientName = getOrderCustomerName(order);
  if (!clientDocNumber) warnings.push('La orden no trae documento del cliente. Se usará documento no domiciliado/sin documento.');
  if (!clientName) warnings.push('La orden no trae nombre del cliente. Se usará el número de orden como razón social.');
  if (!orderItems.length) warnings.push('Falabella no devolvió items. Se emitirá una línea consolidada por el total.');
  const venta: VentaItem = {
    orderNumber,
    fechaEmision: normalizeIssueDateForBoletaBuilder(order?.CreatedAt) || new Date().toISOString().slice(0, 10),
    moneda: 'PEN',
    total,
    client: {
      tipoDocumento: inferDocTypeForBoletaBuilder(clientDocNumber),
      numeroDocumento: clientDocNumber || '00000000',
      razonSocial: clientName || `Cliente Falabella ${orderNumber}`,
    },
    detalles: buildVentaDetallesFromOrderItems(orderItems, total, orderNumber, warnings),
  };
  return {
    ok: true,
    orderItems,
    orderItemIds: normalizeOrderItemIds(orderItems.map(getOrderItemId)),
    warnings,
    venta,
  };
}

export async function falabellaBuildFacturaVenta(payload: { companyId: number; order: any }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const order = payload.order?.Order && typeof payload.order.Order === 'object' ? payload.order.Order : payload.order;
  const orderId = order?.OrderId;
  const orderNumber = String(order?.OrderNumber || '').trim();
  if (!orderId || !orderNumber) return { error: 'La orden no tiene OrderId u OrderNumber.' };
  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId!, apiKey: company.falabellaApiKey!, version: '1.0', defaultFormat: 'JSON' });
  const itemsResponse = await client.call({ action: 'GetOrderItems', params: { OrderId: orderId }, accept: 'application/json' });
  const error = getFalabellaError(itemsResponse.data);
  if (error) return { ok: itemsResponse.ok, status: itemsResponse.status, url: itemsResponse.url, error };
  const orderItems = extractOrderItems(itemsResponse.data);
  const total = orderTotalForBoletaBuilder(order);
  const warnings: string[] = [];
  const billing = getOrderBillingDataForFactura(order);
  if (!billing.ruc) {
    return { error: `La orden ${orderNumber} requiere factura, pero Falabella no envió un RUC válido en ExtraBillingAttributes.LegalId.` };
  }
  if (!billing.razonSocial) {
    return { error: `La orden ${orderNumber} requiere factura, pero Falabella no envió razón social en ExtraBillingAttributes.ReceiverLegalName.` };
  }
  if (!orderItems.length) warnings.push('Falabella no devolvió items. Se emitirá una línea consolidada por el total.');
  const venta: VentaItem = {
    orderNumber,
    serie: 'F001',
    fechaEmision: normalizeIssueDateForBoletaBuilder(order?.CreatedAt) || new Date().toISOString().slice(0, 10),
    moneda: 'PEN',
    total,
    client: {
      tipoDocumento: '6',
      numeroDocumento: billing.ruc,
      razonSocial: billing.razonSocial,
      direccion: billing.direccion || undefined,
    },
    detalles: buildVentaDetallesFromOrderItems(orderItems, total, orderNumber, warnings),
  };
  return {
    ok: true,
    orderItems,
    orderItemIds: normalizeOrderItemIds(orderItems.map(getOrderItemId)),
    warnings,
    venta,
  };
}

export async function falabellaResolveOrderIds(payload: { companyId: number; entries: Array<{ orderNumber: string; invoiceDate: string }> }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId!, apiKey: company.falabellaApiKey!, version: '2.0', defaultFormat: 'JSON' });
  const resolved = await client.resolveOrderIds(payload.entries || []);
  return {
    ...resolved,
    debug: {
      company: { id: payload.companyId, nombre: company.nombre, ruc: company.ruc, razonSocial: company.razonSocial, falabellaApiUserId: company.falabellaApiUserId },
      searchedDates: Object.keys(resolved.debug.searchesByDate),
      searchesByDate: resolved.debug.searchesByDate,
      totalOrdersFound: resolved.debug.totalOrdersFound,
    },
  };
}

// Una factura está "subida a Falabella" si guardó la respuesta del upload (respuestaFalabella).
function facturaFalabellaUploadedAt(factura: any): string {
  if (!factura?.respuestaFalabella) return '';
  const raw = factura.updatedAt || factura.createdAt;
  const ms = raw ? Number(raw) * (Number(raw) < 1e12 ? 1000 : 1) : Date.now();
  try { return new Date(ms).toISOString(); } catch { return new Date().toISOString(); }
}

function localDocumentUploadReadiness(document: any): { canUploadPdf: boolean; uploadBlockedReason: string } {
  const accepted = String(document?.estadoSunat || '').toUpperCase() === 'ACEPTADO';
  if (!accepted) return { canUploadPdf: false, uploadBlockedReason: 'El documento debe estar ACEPTADO por SUNAT para subirlo.' };
  if (document?.xmlPath || document?.cdrPath) return { canUploadPdf: true, uploadBlockedReason: '' };
  return {
    canUploadPdf: false,
    uploadBlockedReason: 'Documento registrado localmente sin XML ni CDR; no se puede subir a Falabella.',
  };
}

export async function falabellaResolveDocument(payload: { companyId: number; orderNumber: string }) {
  const boletasResult = await listBoletas({ companyId: payload.companyId, orderNumber: payload.orderNumber, limit: 20 });
  const facturasResult = await listFacturas({ companyId: payload.companyId, orderNumber: payload.orderNumber, limit: 20 });
  const creditNotesResult = await listCreditNotes({ companyId: payload.companyId, orderNumber: payload.orderNumber, limit: 20 });
  const boleta = boletasResult.boletas.find((row: any) => row.orderNumber === payload.orderNumber) || boletasResult.boletas[0] || null;
  const factura = facturasResult.facturas.find((row: any) => row.orderNumber === payload.orderNumber) || facturasResult.facturas[0] || null;
  const creditNote = creditNotesResult.creditNotes.find((row: any) => row.affectedOrderNumber === payload.orderNumber) || creditNotesResult.creditNotes[0] || null;

  const options: Array<any> = [];
  if (boleta) {
    const falabellaPdfUpload = getBoletaFalabellaPdfUpload(boleta);
    const readiness = localDocumentUploadReadiness(boleta);
    options.push({ kind: 'BOLETA', source: 'local_boleta', boletaId: boleta.id, invoiceNumber: boleta.numeroCompleto, invoiceDate: boleta.fechaEmision, invoiceType: 'BOLETA', pdfPath: boleta.pdfPath || null, xmlPath: boleta.xmlPath || null, cdrPath: boleta.cdrPath || null, estadoSunat: boleta.estadoSunat, respuestaSunat: boleta.respuestaSunat || '', falabellaPdfUploadedAt: falabellaPdfUpload?.uploadedAt || '', ...readiness });
  }
  if (factura) {
    // local_factura → el server puede auto-generar el PDF desde la factura local aceptada (igual que boleta).
    const facturaAceptada = String(factura.estadoSunat || '').toUpperCase() === 'ACEPTADO';
    const readiness = localDocumentUploadReadiness(factura);
    options.push({ kind: 'FACTURA', source: facturaAceptada ? 'local_factura' : 'manual', facturaId: factura.id, invoiceNumber: factura.numeroCompleto, invoiceDate: factura.fechaEmision, invoiceType: 'FACTURA', pdfPath: factura.pdfPath || null, xmlPath: factura.xmlPath || null, cdrPath: factura.cdrPath || null, estadoSunat: factura.estadoSunat || '', respuestaSunat: factura.respuestaSunat || '', falabellaPdfUploadedAt: facturaFalabellaUploadedAt(factura), ...readiness });
  }
  if (creditNote) {
    const readiness = localDocumentUploadReadiness(creditNote);
    options.push({ kind: 'NOTA_DE_CREDITO', source: 'local_credit_note', creditNoteId: creditNote.id, invoiceNumber: creditNote.numeroCompleto, invoiceDate: creditNote.fechaEmision, invoiceType: 'NOTA_DE_CREDITO', pdfPath: creditNote.pdfPath || null, xmlPath: creditNote.xmlPath || null, cdrPath: creditNote.cdrPath || null, estadoSunat: creditNote.estadoSunat, respuestaSunat: creditNote.respuestaSunat || '', ...readiness });
  }
  if (!factura) {
    options.push({ kind: 'FACTURA', source: 'manual', invoiceNumber: '', invoiceDate: '', invoiceType: 'FACTURA', pdfPath: null, xmlPath: null, cdrPath: null, estadoSunat: '' });
  }

  return {
    orderNumber: payload.orderNumber,
    boleta: boleta ? { id: boleta.id, numeroCompleto: boleta.numeroCompleto, fechaEmision: boleta.fechaEmision, pdfPath: boleta.pdfPath || null, estadoSunat: boleta.estadoSunat, respuestaSunat: boleta.respuestaSunat || '', falabellaPdfUploadedAt: getBoletaFalabellaPdfUpload(boleta)?.uploadedAt || '', total: boleta.mtoImpVenta || '', cliente: boleta.clientRazonSocial || '', clienteDocumento: boleta.clientNumeroDocumento || '', codigoHash: boleta.codigoHash || '', xmlPath: boleta.xmlPath || null, cdrPath: boleta.cdrPath || null, ...localDocumentUploadReadiness(boleta) } : null,
    factura: factura ? { id: factura.id, numeroCompleto: factura.numeroCompleto, fechaEmision: factura.fechaEmision, pdfPath: factura.pdfPath || null, estado: factura.estadoSunat || '', estadoSunat: factura.estadoSunat || '', respuestaSunat: factura.respuestaSunat || '', total: factura.mtoImpVenta || '', cliente: factura.clientRazonSocial || '', clienteDocumento: factura.clientNumeroDocumento || '', codigoHash: factura.codigoHash || '', xmlPath: factura.xmlPath || null, cdrPath: factura.cdrPath || null, falabellaPdfUploadedAt: facturaFalabellaUploadedAt(factura), ...localDocumentUploadReadiness(factura) } : null,
    creditNote: creditNote ? { id: creditNote.id, numeroCompleto: creditNote.numeroCompleto, fechaEmision: creditNote.fechaEmision, pdfPath: creditNote.pdfPath || '', estadoSunat: creditNote.estadoSunat, respuestaSunat: creditNote.respuestaSunat || '' } : null,
    options,
    defaultKind: boleta ? 'BOLETA' : factura ? 'FACTURA' : creditNote ? 'NOTA_DE_CREDITO' : 'FACTURA',
  };
}

export async function falabellaUploadInvoicePdf(payload: {
  companyId: number; orderNumber: string; orderItemIds: string[]; invoiceNumber: string; invoiceDate: string;
  invoiceType: 'BOLETA' | 'FACTURA' | 'NOTA_DE_CREDITO'; source?: 'local_boleta' | 'local_factura' | 'local_credit_note' | 'manual'; boletaId?: number; facturaId?: number; pdfPath?: string; pdfBase64?: string;
}) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  return uploadInvoicePdfForCompany(found.company, payload);
}

export async function falabellaUploadBoletaPdf(payload: {
  companyId: number; boletaId: number; orderNumber: string; orderId?: string | number; invoiceNumber: string; invoiceDate: string; pdfPath?: string;
}) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  if (!payload.orderNumber?.trim()) return { ok: false, skipped: true, error: 'La boleta no tiene orderNumber asociado.' };

  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId!, apiKey: company.falabellaApiKey!, version: '2.0', defaultFormat: 'JSON' });
  const order = payload.orderId
    ? { OrderId: payload.orderId, OrderNumber: payload.orderNumber, InvoiceRequired: false }
    : await client.findOrderByOrderNumber(payload.orderNumber, payload.invoiceDate);
  if (!order) return { ok: false, skipped: true, error: `No se encontró la orden ${payload.orderNumber} en Falabella para resolver su OrderId.` };
  if ((order as any).InvoiceRequired) return { ok: false, skipped: true, error: `La orden ${payload.orderNumber} requiere FACTURA en Falabella.`, orderId: (order as any).OrderId };

  const itemsClient = new FalabellaApiClient({ userId: company.falabellaApiUserId!, apiKey: company.falabellaApiKey!, version: '1.0', defaultFormat: 'JSON' });
  const itemsResponse = await itemsClient.call({ action: 'GetOrderItems', params: { OrderId: (order as any).OrderId }, accept: 'application/json' });
  const itemsError = getFalabellaError(itemsResponse.data);
  if (itemsError) return { ok: itemsResponse.ok, status: itemsResponse.status, orderId: (order as any).OrderId, error: itemsError };

  const orderItems = extractOrderItems(itemsResponse.data);
  const orderItemIds = normalizeOrderItemIds(orderItems.map(getOrderItemId));
  if (!orderItemIds.length) return { ok: false, orderId: (order as any).OrderId, error: 'Falabella no devolvió OrderItemIds para esta orden.' };

  const upload = await uploadInvoicePdfForCompany(company, {
    companyId: payload.companyId, orderNumber: payload.orderNumber, orderItemIds, invoiceNumber: payload.invoiceNumber,
    invoiceDate: payload.invoiceDate, invoiceType: 'BOLETA', source: 'local_boleta', boletaId: payload.boletaId, pdfPath: payload.pdfPath,
  });
  const falabellaPdfUpload = (upload as any)?.ok && !(upload as any)?.error
    ? await markBoletaFalabellaPdfUpload(payload.boletaId, { status: (upload as any).status, data: (upload as any).data, rawText: (upload as any).rawText, orderId: (order as any).OrderId, orderItemIds })
    : null;
  return { ...upload, boletaId: payload.boletaId, orderNumber: payload.orderNumber, orderId: (order as any).OrderId, orderItemIds, falabellaPdfUpload };
}

// Reconciliación Falabella ↔ sistema, cruzando por número de orden.
export async function falabellaMonthSummary(payload: { companyId: number; month: string }) {
  const found = await requireCompanyWithFalabella(payload.companyId);
  if ('error' in found) return { error: found.error };
  const { company } = found;
  const match = String(payload.month || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return { error: 'Mes inválido (esperado YYYY-MM).' };
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const monthEnd = `${payload.month}-${String(lastDay).padStart(2, '0')}`;
  const startDate = new Date(Date.UTC(year, monthIndex, 1));
  startDate.setUTCDate(startDate.getUTCDate() - 31);
  const createdAfter = `${startDate.toISOString().slice(0, 10)}T00:00:00+00:00`;
  const createdBefore = `${monthEnd}T23:59:59+00:00`;

  const client = new FalabellaApiClient({ userId: company.falabellaApiUserId!, apiKey: company.falabellaApiKey!, version: '2.0', defaultFormat: 'JSON' });
  const isFactura = (v: unknown) => v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1';
  const orderTotalOf = (o: any) => { const total = parseFloat(String(o?.GrandTotal ?? o?.Price ?? '0').replace(/,/g, '')); return Number.isFinite(total) ? total : 0; };
  const dateOf = (o: any) => (String(o?.CreatedAt ?? '').match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  const statusText = (statuses: any): string => {
    if (!statuses) return '';
    if (typeof statuses === 'string') return statuses;
    const status = statuses.Status || statuses.status || statuses;
    if (Array.isArray(status)) return status.map(statusText).filter(Boolean).join('|');
    if (status && typeof status === 'object') return String(status.Name || status.name || JSON.stringify(status));
    return String(status || '');
  };
  const isPendingOrder = (order: any) => String(statusText(order?.Statuses)).toLowerCase().includes('pending');

  const ordersByNumber = new Map<string, any>();
  const limit = 100;
  for (let offset = 0; offset < 100000; offset += limit) {
    const response = await client.getOrdersV2({ createdAfter, createdBefore, limit, offset });
    const error = getFalabellaError(response.data);
    if (error) return { error: error.Head?.ErrorMessage || error.Head?.ErrorCode || 'Error consultando Falabella.' };
    const normalized = normalizeGetOrdersResult(response.data);
    let added = 0;
    for (const order of normalized.orders) {
      const orderNumber = String((order as any)?.OrderNumber || '').trim();
      if (orderNumber && !ordersByNumber.has(orderNumber)) { ordersByNumber.set(orderNumber, order); added++; }
    }
    if (normalized.orders.length < limit || added === 0) break;
  }

  const sys = await listBoletas({ companyId: payload.companyId, fechaDesde: `${payload.month}-01`, fechaHasta: monthEnd, limit: 5000 });
  const boletaOrderNumbers = Array.from(ordersByNumber.entries())
    .filter(([, order]) => dateOf(order).startsWith(payload.month) && !isFactura(order.InvoiceRequired))
    .map(([orderNumber]) => orderNumber);
  const boletasByOrderEntries = await Promise.all(boletaOrderNumbers.map(async (orderNumber) => {
    const result = await listBoletas({ companyId: payload.companyId, orderNumber, limit: 20 });
    const exact = (result.boletas || []).find((boleta: any) => String(boleta.orderNumber || '').trim() === orderNumber) || null;
    return [orderNumber, exact] as [string, any | null];
  }));

  let ventasBoletaMes = 0, ventasBoletaTotal = 0, emitidas = 0, emitidasTotal = 0, registradasPendientes = 0, registradasPendientesTotal = 0;
  let pendientes = 0, pendientesTotal = 0, porEmitir = 0, porEmitirTotal = 0, pendientesFalabella = 0, pendientesFalabellaTotal = 0, ventasFacturaMes = 0;
  const rows: any[] = [];
  const sysByOrder = new Map(boletasByOrderEntries.filter(([, boleta]) => Boolean(boleta)));
  for (const [num, order] of ordersByNumber) {
    if (!dateOf(order).startsWith(payload.month)) continue;
    if (isFactura(order.InvoiceRequired)) { ventasFacturaMes++; continue; }
    const price = orderTotalOf(order);
    const boleta = sysByOrder.get(num) as any;
    const hasBoleta = Boolean(boleta);
    const hasAcceptedBoleta = String(boleta?.estadoSunat || '').toUpperCase() === 'ACEPTADO';
    const shouldHaveBoleta = !isPendingOrder(order);
    const bucket = hasAcceptedBoleta ? 'con_boleta' : hasBoleta ? 'registrada_pendiente' : shouldHaveBoleta ? 'por_emitir' : 'pendiente_falabella';
    ventasBoletaMes++; ventasBoletaTotal += price;
    if (hasAcceptedBoleta) { emitidas++; emitidasTotal += price; }
    else if (hasBoleta) { registradasPendientes++; registradasPendientesTotal += price; }
    else { pendientes++; pendientesTotal += price; if (shouldHaveBoleta) { porEmitir++; porEmitirTotal += price; } else { pendientesFalabella++; pendientesFalabellaTotal += price; } }
    rows.push({ orderNumber: num, orderId: String(order.OrderId || ''), createdAt: String(order.CreatedAt || ''), updatedAt: String(order.UpdatedAt || ''), status: statusText(order.Statuses), price, hasBoleta, hasAcceptedBoleta, shouldHaveBoleta, bucket, boletaNumero: boleta?.numeroCompleto, boletaFecha: boleta?.fechaEmision, boletaEstado: boleta?.estadoSunat });
  }

  let boletasDelMes = 0, boletasDelMesTotal = 0, boletasMesAnterior = 0, boletasMesAnteriorTotal = 0, boletasSinOrden = 0, boletasSinOrdenTotal = 0;
  const boletasDetalle: any[] = [];
  for (const b of sys.boletas) {
    const order = ordersByNumber.get(String(b.orderNumber || '').trim());
    const total = parseFloat(String(b.mtoImpVenta || '0')) || 0;
    const fechaOrden = order ? dateOf(order) : '';
    let origen: 'mes' | 'anterior' | 'sin_orden';
    if (!order) { boletasSinOrden++; boletasSinOrdenTotal += total; origen = 'sin_orden'; }
    else if (fechaOrden.startsWith(payload.month)) { boletasDelMes++; boletasDelMesTotal += total; origen = 'mes'; }
    else { boletasMesAnterior++; boletasMesAnteriorTotal += total; origen = 'anterior'; }
    boletasDetalle.push({ id: b.id, numeroCompleto: b.numeroCompleto, fechaEmision: b.fechaEmision, total, orderNumber: String(b.orderNumber || ''), cliente: String(b.clientRazonSocial || ''), documento: String(b.clientNumeroDocumento || ''), fechaOrden, origen });
  }

  return {
    month: payload.month,
    falabella: { ventasBoletaMes, ventasBoletaTotal, emitidas, emitidasTotal, registradasPendientes, registradasPendientesTotal, pendientes, pendientesTotal, porEmitir, porEmitirTotal, pendientesFalabella, pendientesFalabellaTotal, ventasFacturaMes, rows, pendientesSample: rows.filter((row) => !row.hasBoleta).slice(0, 50) },
    sistema: { total: sys.boletas.length, boletasDelMes, boletasDelMesTotal, boletasMesAnterior, boletasMesAnteriorTotal, boletasSinOrden, boletasSinOrdenTotal, boletasDetalle },
  };
}

// ── helpers (puros) ──

function getBoletaFalabellaPdfUpload(boleta: any) {
  const data = boleta?.datosAdicionales;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const upload = (data as any).falabellaPdfUpload;
  return upload && typeof upload === 'object' ? upload : null;
}

function extractOrderItems(document: any): any[] {
  const candidate = document?.SuccessResponse?.Body?.OrderItems?.OrderItem || document?.OrderItems?.OrderItem || document?.OrderItems || document?.data?.orderItems || document?.data?.OrderItems || document?.orderItems;
  if (Array.isArray(candidate)) return candidate;
  if (candidate && typeof candidate === 'object') return [candidate];
  return [];
}

function normalizeOrderItemIds(values: unknown): string[] {
  const raw = Array.isArray(values) ? values : values == null ? [] : [values];
  return Array.from(new Set(raw.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function getOrderItemId(item: any): string {
  return String(item?.OrderItemId ?? item?.OrderItemID ?? item?.orderItemId ?? item?.id ?? item?.Id ?? '').trim();
}

function normalizeInvoiceDate(value: unknown): string {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : String(value || '').trim();
}

function normalizePdfBase64(value: string): string {
  return String(value || '')
    .replace(/^data:application\/pdf;base64,/i, '')
    .replace(/\s+/g, '')
    .trim();
}

function isPdfBase64(value: string): boolean {
  try {
    return Buffer.from(value.slice(0, 16), 'base64').subarray(0, 4).toString('utf8') === '%PDF';
  } catch {
    return false;
  }
}

function falabellaErrorText(error: any): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error?.Head?.ErrorMessage || error?.Head?.ErrorCode || error?.message || error?.Message || error?.ErrorMessage || '');
}

function isInvalidRequestFormat(error: any, rawText: string): boolean {
  return /invalid request format/i.test(`${falabellaErrorText(error)} ${rawText || ''}`);
}

// Falabella responde 409 INVOICE_ALREADY_EXISTS cuando el documento YA está subido.
// No es un fallo: el estado deseado (documento en Falabella) ya se cumplió → idempotente.
function isInvoiceAlreadyExists(data: any, rawText: string): boolean {
  const errs = data?.ErrorResponse?.Body?.errors ?? data?.Body?.errors;
  if (Array.isArray(errs) && errs.some((e: any) => e?.message === 'INVOICE_ALREADY_EXISTS' || String(e?.code) === 'Conflict')) return true;
  return /INVOICE_ALREADY_EXISTS|ya existe/i.test(String(rawText || ''));
}

function parseMoneyForBoletaBuilder(value: unknown): number {
  if (value && typeof value === 'object') {
    const amount = (value as any).amount ?? (value as any).Amount ?? (value as any).value ?? (value as any).Value;
    if (amount != null) return parseMoneyForBoletaBuilder(amount);
    const centAmount = (value as any).centAmount ?? (value as any).CentAmount;
    if (centAmount != null) { const parsedCents = Number(String(centAmount).replace(/,/g, '')); return Number.isFinite(parsedCents) ? parsedCents / 100 : 0; }
  }
  const parsed = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function roundMoneyForBoletaBuilder(value: number): number { return Math.round(value * 100) / 100; }
function roundValueForBoletaBuilder(value: number, decimals: number): number { const factor = 10 ** decimals; return Math.round(value * factor) / factor; }
function splitIgvForBoletaBuilder(total: number, percent = 18) { const factor = 1 + percent / 100; const base = roundMoneyForBoletaBuilder(total / factor); return { base, igv: roundMoneyForBoletaBuilder(total - base) }; }
function distributeGrossTotalsForBoletaBuilder(total: number, quantities: number[]): number[] {
  const safeQuantities = quantities.map(quantity => Math.max(1, Math.round(Number(quantity) || 1)));
  const units = safeQuantities.reduce((sum, quantity) => sum + quantity, 0);
  if (!units) return safeQuantities.map(() => 0);
  const totalCents = Math.round(total * 100);
  const baseUnitCents = Math.floor(totalCents / units);
  let remainder = totalCents - baseUnitCents * units;
  return safeQuantities.map((quantity) => { const extra = Math.min(remainder, quantity); remainder -= extra; return (quantity * baseUnitCents + extra) / 100; });
}
function orderTotalForBoletaBuilder(order: any): number { return parseMoneyForBoletaBuilder(order?.GrandTotal ?? order?.Price ?? order?.Total ?? 0); }
function normalizeIssueDateForBoletaBuilder(value: unknown): string { const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/); return match ? match[1] : ''; }
function compactTextForBoletaBuilder(value: unknown): string { return String(value || '').replace(/\s+/g, ' ').trim(); }
function pickFirstTextForBoletaBuilder(source: any, keys: string[]): string { for (const key of keys) { const value = source?.[key]; if (value != null && compactTextForBoletaBuilder(value)) return compactTextForBoletaBuilder(value); } return ''; }
function getOrderCustomerDocument(order: any): string {
  const doc = pickFirstTextForBoletaBuilder(order, ['NationalRegistrationNumber', 'CustomerNationalRegistrationNumber', 'CustomerDocumentNumber', 'DocumentNumber', 'TaxDocument', 'DNI', 'RUC']);
  return doc.replace(/[^\dA-Za-z]/g, '');
}
function getOrderCustomerName(order: any): string {
  const full = pickFirstTextForBoletaBuilder(order, ['CustomerName', 'Name', 'BuyerName']);
  if (full) return full;
  return compactTextForBoletaBuilder([order?.CustomerFirstName, order?.CustomerLastName, order?.CustomerLastName2].filter(Boolean).join(' '));
}
function getOrderBillingDataForFactura(order: any): { ruc: string; razonSocial: string; direccion: string; email: string; phone: string } {
  const attrs = normalizeExtraBillingAttributes(order?.ExtraBillingAttributes);
  const rawRuc = pickFirstTextForBoletaBuilder(attrs, ['LegalId', 'ReceiverLegalId', 'TaxId', 'RUC', 'DocumentNumber']);
  const ruc = rawRuc.replace(/\D/g, '');
  const fallbackDoc = getOrderCustomerDocument(order).replace(/\D/g, '');
  const legalName = pickFirstTextForBoletaBuilder(attrs, ['ReceiverLegalName', 'LegalName', 'BusinessName', 'CompanyName', 'RazonSocial']);
  const fallbackName = getOrderCustomerName(order);
  return {
    ruc: ruc.length === 11 ? ruc : fallbackDoc.length === 11 ? fallbackDoc : '',
    razonSocial: legalName || (fallbackDoc.length === 11 ? fallbackName : ''),
    direccion: pickFirstTextForBoletaBuilder(attrs, ['ReceiverAddress', 'Address', 'Direccion']),
    email: pickFirstTextForBoletaBuilder(attrs, ['ReceiverEmail', 'Email']),
    phone: pickFirstTextForBoletaBuilder(attrs, ['ReceiverPhone', 'Phone']),
  };
}
function normalizeExtraBillingAttributes(value: any): Record<string, unknown> {
  if (!value) return {};
  if (Array.isArray(value)) return normalizeKeyValueArray(value);
  if (typeof value !== 'object') return {};
  const nested = value.ExtraBillingAttribute || value.ExtraBillingAttributes || value.Attribute || value.Attributes;
  if (Array.isArray(nested)) return normalizeKeyValueArray(nested);
  if (nested && typeof nested === 'object' && nested !== value) return normalizeExtraBillingAttributes(nested);
  return value;
}
function normalizeKeyValueArray(values: any[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of values) {
    if (!item || typeof item !== 'object') continue;
    const key = item.Name ?? item.name ?? item.Key ?? item.key ?? item.Code ?? item.code;
    const val = item.Value ?? item.value ?? item.Text ?? item.text;
    if (key != null) result[String(key)] = val;
  }
  return result;
}
function inferDocTypeForBoletaBuilder(docNumber: string): '1' | '4' | '6' | '7' | '0' {
  const digits = String(docNumber || '').replace(/\D/g, '');
  if (digits.length === 8) return '1';
  if (digits.length === 11) return '6';
  if (digits.length === 9) return '4';
  return '0';
}
function isInvoiceRequiredForBoletaBuilder(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  return false;
}
function getItemQuantityForBoletaBuilder(item: any): number { return Math.max(1, Number(item?.Quantity ?? item?.quantity ?? item?.Qty ?? item?.qty ?? 1) || 1); }
function getItemSkuForBoletaBuilder(item: any, fallback: string): string { return pickFirstTextForBoletaBuilder(item, ['SellerSku', 'sellerSku', 'ShopSku', 'Sku', 'SKU', 'sku', 'ProductId', 'OrderItemId']) || fallback; }
function getItemNameForBoletaBuilder(item: any, fallback: string): string { return pickFirstTextForBoletaBuilder(item, ['Name', 'name', 'ProductName', 'productName', 'Product', 'product', 'ItemName', 'Description']) || fallback; }
function getItemGrossUnitForBoletaBuilder(item: any): number {
  return parseMoneyForBoletaBuilder(item?.PaidPrice ?? item?.paidPrice ?? item?.ItemPrice ?? item?.itemPrice ?? item?.UnitPrice ?? item?.unitPrice ?? item?.Price ?? item?.price ?? item?.TotalPrice ?? item?.totalPrice ?? 0);
}
function buildVentaDetallesFromOrderItems(orderItems: any[], total: number, orderNumber: string, warnings: string[]): VentaItem['detalles'] {
  if (!orderItems.length) {
    const { base } = splitIgvForBoletaBuilder(total, 18);
    return [{ codigo: orderNumber, descripcion: `Venta Falabella ${orderNumber}`, unidad: 'NIU', cantidad: 1, mtoValorUnitario: base, mtoBruto: total, porcentajeIgv: 18, tipAfeIgv: '10' }];
  }
  const normalized = orderItems.map((item, index) => ({ item, quantity: getItemQuantityForBoletaBuilder(item), sku: getItemSkuForBoletaBuilder(item, `${orderNumber}-${index + 1}`), name: getItemNameForBoletaBuilder(item, `Producto Falabella ${index + 1}`), grossUnit: getItemGrossUnitForBoletaBuilder(item) }));
  const itemGrossTotal = roundMoneyForBoletaBuilder(normalized.reduce((sum, item) => sum + item.grossUnit * item.quantity, 0));
  const shouldRedistribute = total > 0 && Math.abs(itemGrossTotal - total) >= 0.01;
  if (shouldRedistribute) warnings.push(`La suma de items (${itemGrossTotal.toFixed(2)}) no cuadra con el total (${total.toFixed(2)}). Se redistribuyó el total por cantidad.`);
  const redistributedTotals = shouldRedistribute ? distributeGrossTotalsForBoletaBuilder(total, normalized.map(item => item.quantity)) : [];
  return normalized.map((item, index) => {
    const grossLineTotal = shouldRedistribute ? redistributedTotals[index] : roundMoneyForBoletaBuilder(item.grossUnit * item.quantity);
    const { base } = splitIgvForBoletaBuilder(grossLineTotal, 18);
    return { codigo: item.sku, descripcion: item.name, unidad: 'NIU', cantidad: item.quantity, mtoValorUnitario: roundValueForBoletaBuilder(base / item.quantity, 8), mtoBruto: grossLineTotal, porcentajeIgv: 18, tipAfeIgv: '10' };
  });
}

async function fetchFalabellaInvoicePdf(
  authParameters: Record<string, string>,
  signature: string,
  body: {
    orderItemIds: string[];
    invoiceNumber: string;
    invoiceDate: string;
    invoiceType: string;
    operatorCode: string;
    invoiceDocumentFormat: string;
    invoiceDocument: string;
  },
  mode: 'json' | 'form',
) {
  const headers: Record<string, string> = {
    UserID: authParameters.UserID,
    Version: authParameters.Version,
    Timestamp: authParameters.Timestamp,
    Signature: signature,
    Action: authParameters.Action,
    Format: authParameters.Format,
    Service: authParameters.Service,
  };

  let requestBody: string;
  if (mode === 'form') {
    const form = new URLSearchParams();
    for (const orderItemId of body.orderItemIds) form.append('orderItemIds', orderItemId);
    form.set('invoiceNumber', body.invoiceNumber);
    form.set('invoiceDate', body.invoiceDate);
    form.set('invoiceType', body.invoiceType);
    form.set('operatorCode', body.operatorCode);
    form.set('invoiceDocumentFormat', body.invoiceDocumentFormat);
    form.set('invoiceDocument', body.invoiceDocument);
    headers['content-type'] = 'application/x-www-form-urlencoded';
    requestBody = form.toString();
  } else {
    headers['content-type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await fetch('https://sellercenter-api.falabella.com/v1/marketplace-sellers/invoice/pdf', {
    method: 'POST',
    headers,
    body: requestBody,
  });
  const rawText = await response.text();
  let data: any = rawText;
  try { data = JSON.parse(rawText); } catch {}
  const error = getFalabellaError(data);
  return { response, rawText, data, error };
}

async function uploadInvoicePdfForCompany(company: any, payload: {
  companyId: number; orderNumber: string; orderItemIds: string[]; invoiceNumber: string; invoiceDate: string;
  invoiceType: 'BOLETA' | 'FACTURA' | 'NOTA_DE_CREDITO'; source?: 'local_boleta' | 'local_factura' | 'local_credit_note' | 'manual'; boletaId?: number; facturaId?: number; pdfPath?: string; pdfBase64?: string;
}) {
  if (payload.source === 'local_factura' && payload.facturaId) {
    const facturasResult = await listFacturas({ companyId: payload.companyId, numeroCompleto: payload.invoiceNumber, limit: 20 });
    const factura = (facturasResult.facturas || []).find((row: any) => row.id === payload.facturaId);
    const readiness = localDocumentUploadReadiness(factura);
    if (!readiness.canUploadPdf) return { ok: false, error: readiness.uploadBlockedReason };
  }

  let pdfBase64 = payload.pdfBase64 || '';
  if (!pdfBase64 && payload.source === 'local_boleta' && payload.boletaId) pdfBase64 = await generateAcceptedBoletaPdfBase64(payload.boletaId, 'A4');
  if (!pdfBase64 && payload.source === 'local_factura' && payload.facturaId) pdfBase64 = await generateAcceptedFacturaPdfBase64(payload.facturaId, 'A4');
  if (!pdfBase64 && payload.pdfPath) pdfBase64 = readFileSync(payload.pdfPath, { encoding: 'base64' });
  pdfBase64 = normalizePdfBase64(pdfBase64);
  if (!pdfBase64) return { error: 'No se encontró un PDF para subir. Selecciona un archivo PDF o usa un documento local aceptado.' };
  if (!isPdfBase64(pdfBase64)) return { ok: false, error: 'El archivo generado/seleccionado no parece ser un PDF válido.' };

  const orderItemIds = normalizeOrderItemIds(payload.orderItemIds);
  if (!orderItemIds.length) return { ok: false, error: 'La orden no tiene OrderItemIds válidos para subir el PDF a Falabella.' };

  const invoiceNumber = String(payload.invoiceNumber || '').trim();
  const invoiceDate = normalizeInvoiceDate(payload.invoiceDate);
  if (!invoiceNumber) return { ok: false, error: 'Falta el número del documento para subir el PDF a Falabella.' };
  if (!invoiceDate) return { ok: false, error: 'Falta la fecha del documento para subir el PDF a Falabella.' };

  const timestamp = buildIsoUtcTimestamp();
  const authParameters = { Action: 'SetInvoicePDF', Format: 'JSON', Service: 'Invoice', Timestamp: timestamp, UserID: company.falabellaApiUserId, Version: process.env.FALABELLA_API_VERSION || '1.0' };
  const signature = signParameters(authParameters, company.falabellaApiKey);
  const requestBody = {
    orderItemIds,
    invoiceNumber,
    invoiceDate,
    invoiceType: payload.invoiceType,
    operatorCode: 'FAPE',
    invoiceDocumentFormat: 'pdf',
    invoiceDocument: pdfBase64,
  };

  let uploadResponse = await fetchFalabellaInvoicePdf(authParameters, signature, requestBody, 'json');
  let transport: 'json' | 'form' = 'json';
  if (isInvalidRequestFormat(uploadResponse.error, uploadResponse.rawText)) {
    uploadResponse = await fetchFalabellaInvoicePdf(authParameters, signature, requestBody, 'form');
    transport = 'form';
  }

  const { response, rawText, data, error } = uploadResponse;
  // 409 "ya existe" = éxito idempotente: el documento ya está en Falabella.
  const alreadyExists = isInvoiceAlreadyExists(data, rawText);
  const ok = response.ok || alreadyExists;
  const result = { ok, status: response.status, error: alreadyExists ? null : error, alreadyExists, data, rawText, transport };
  if (ok && payload.invoiceType === 'FACTURA') {
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    if (pdfBuffer) {
      await recordFacturaUpload({ companyId: payload.companyId, orderNumber: payload.orderNumber, numeroCompleto: invoiceNumber, fechaEmision: invoiceDate, pdfBuffer, source: payload.source || 'manual', orderItemIds, respuestaFalabella: data });
    }
  }
  return result;
}
