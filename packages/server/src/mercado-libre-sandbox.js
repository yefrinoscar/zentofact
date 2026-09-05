// Sandbox local de Mercado Libre. Mercado Libre no publica un sandbox oficial;
// este módulo imita orders / shipments / labels ME2 solo con tokens SANDBOX-*.
import { Hono } from 'hono';
import { PDFDocument, StandardFonts } from 'pdf-lib';

export const SANDBOX_TOKEN_PREFIX = 'SANDBOX-';
export const SANDBOX_SELLER_ID = '200000001';
export const SANDBOX_ACCESS_TOKEN = 'SANDBOX-LIMBO-ACCESS';
export const SANDBOX_REFRESH_TOKEN = 'SANDBOX-LIMBO-REFRESH';
export const SANDBOX_NICKNAME = 'LIMBO_SANDBOX';
export const SANDBOX_SITE_ID = 'MPE';
export const SANDBOX_ITEM_ID = 'MPE123456789';
export const SANDBOX_PENDING_ORDER_ID = '10030';
export const SANDBOX_READY_ORDER_ID = '10031';
export const SANDBOX_PENDING_SHIPMENT_ID = '900000030';
export const SANDBOX_READY_SHIPMENT_ID = '900000031';
export const SANDBOX_READY_TRACKING = '280012345678901';

const LABEL_WIDTH = 283.46;
const LABEL_HEIGHT = 425.2;

const store = {
  orders: new Map(),
  shipments: new Map(),
  items: new Map(),
  nextOrderId: 10040,
  nextShipmentId: 900000040,
};

function text(value) {
  return String(value ?? '').trim();
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mercadoLibreSandboxEnabled(env = process.env) {
  const value = text(env.MERCADO_LIBRE_SANDBOX).toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

export function isMercadoLibreSandboxToken(token) {
  return text(token).startsWith(SANDBOX_TOKEN_PREFIX);
}

function nowIso() {
  return new Date().toISOString();
}

function sellerUser() {
  return {
    id: Number(SANDBOX_SELLER_ID),
    nickname: SANDBOX_NICKNAME,
    site_id: SANDBOX_SITE_ID,
  };
}

function seedDefaultItem() {
  return {
    id: SANDBOX_ITEM_ID,
    title: 'Silla de comer evolutiva gris',
    status: 'active',
    available_quantity: 8,
    price: 249,
    permalink: 'https://articulo.mercadolibre.com.pe/MPE-123456789',
    seller_sku: 'HOG025',
    attributes: [{ id: 'SELLER_SKU', value_name: 'HOG025' }],
    pictures: [{ url: '', secure_url: '' }],
    variations: [],
  };
}

function buildOrder({
  orderId,
  shipmentId,
  buyer,
  sku = 'HOG025',
  title = 'Silla de comer evolutiva gris',
  price = 249,
  quantity = 1,
  createdAt = nowIso(),
}) {
  return {
    id: Number(orderId) || orderId,
    status: 'paid',
    date_created: createdAt,
    last_updated: createdAt,
    date_closed: null,
    currency_id: 'PEN',
    total_amount: price * quantity,
    paid_amount: price * quantity,
    pack_id: null,
    tags: [],
    shipping: { id: Number(shipmentId) || shipmentId },
    buyer: {
      first_name: buyer.firstName,
      last_name: buyer.lastName,
      nickname: buyer.nickname || `${buyer.firstName}${buyer.lastName}`.replace(/\s+/g, ''),
      email: buyer.email || '',
      doc_number: buyer.documentNumber || '',
      phone: { number: buyer.phone || '' },
    },
    order_items: [{
      quantity,
      unit_price: price,
      full_unit_price: price,
      item: {
        id: SANDBOX_ITEM_ID,
        title,
        seller_sku: sku,
        variation_id: null,
        attributes: [{ id: 'SELLER_SKU', value_name: sku }],
      },
    }],
  };
}

function buildShipment({
  shipmentId,
  orderId,
  status,
  substatus,
  trackingNumber = null,
  updatedAt = nowIso(),
}) {
  return {
    id: Number(shipmentId) || shipmentId,
    status,
    substatus,
    mode: 'me2',
    logistic_type: 'drop_off',
    tracking_number: trackingNumber,
    order_id: Number(orderId) || orderId,
    orders: [{ id: Number(orderId) || orderId }],
    last_updated: updatedAt,
    destination: {
      receiver_address: {
        address_line: 'Av. Demo 101, Lima',
        street_name: 'Av. Demo',
        street_number: '101',
        city: { name: 'Lima' },
        state: { name: 'Lima' },
      },
    },
  };
}

function putOrder(order, shipment) {
  const orderId = text(order.id);
  const shipmentId = text(shipment.id);
  store.orders.set(orderId, order);
  store.shipments.set(shipmentId, shipment);
}

export function resetMercadoLibreSandbox() {
  store.orders.clear();
  store.shipments.clear();
  store.items.clear();
  store.nextOrderId = 10040;
  store.nextShipmentId = 900000040;
  store.items.set(SANDBOX_ITEM_ID, seedDefaultItem());
  putOrder(
    buildOrder({
      orderId: SANDBOX_PENDING_ORDER_ID,
      shipmentId: SANDBOX_PENDING_SHIPMENT_ID,
      buyer: {
        firstName: 'Sofía',
        lastName: 'Preview',
        nickname: 'SOFIAPREVIEW',
        email: 'sofia@preview.zentofact.local',
        documentNumber: '99887766',
      },
    }),
    buildShipment({
      shipmentId: SANDBOX_PENDING_SHIPMENT_ID,
      orderId: SANDBOX_PENDING_ORDER_ID,
      status: 'handling',
      substatus: 'waiting_for_label_generation',
    }),
  );
  putOrder(
    buildOrder({
      orderId: SANDBOX_READY_ORDER_ID,
      shipmentId: SANDBOX_READY_SHIPMENT_ID,
      buyer: {
        firstName: 'Tomás',
        lastName: 'Preview',
        nickname: 'TOMASPREVIEW',
        email: 'tomas@preview.zentofact.local',
        documentNumber: '11220033',
      },
    }),
    buildShipment({
      shipmentId: SANDBOX_READY_SHIPMENT_ID,
      orderId: SANDBOX_READY_ORDER_ID,
      status: 'ready_to_ship',
      substatus: 'ready_to_print',
      trackingNumber: SANDBOX_READY_TRACKING,
    }),
  );
}

function ensureStore() {
  if (!store.items.size) resetMercadoLibreSandbox();
}

export function listSandboxOrders() {
  ensureStore();
  return [...store.orders.values()];
}

export function getSandboxOrder(orderId) {
  ensureStore();
  return store.orders.get(text(orderId)) || null;
}

export function getSandboxShipment(shipmentId) {
  ensureStore();
  return store.shipments.get(text(shipmentId)) || null;
}

export function pushSandboxOrder(input = {}) {
  ensureStore();
  const orderId = text(input.orderId) || String(store.nextOrderId++);
  const shipmentId = text(input.shipmentId) || String(store.nextShipmentId++);
  const shipmentStatus = text(input.shipmentStatus) || 'handling';
  const substatus = text(input.substatus)
    || (shipmentStatus === 'ready_to_ship' ? 'ready_to_print' : 'waiting_for_label_generation');
  const trackingNumber = text(input.trackingNumber)
    || (shipmentStatus === 'ready_to_ship' ? `2800${shipmentId}` : '');
  const order = buildOrder({
    orderId,
    shipmentId,
    sku: text(input.sku) || 'HOG025',
    title: text(input.title) || 'Silla de comer evolutiva gris',
    price: Number(input.price) || 249,
    quantity: Number(input.quantity) || 1,
    buyer: {
      firstName: text(input.firstName) || 'Nuria',
      lastName: text(input.lastName) || 'Sandbox',
      nickname: text(input.nickname) || 'NURIASANDBOX',
      email: text(input.email) || 'nuria.sandbox@preview.zentofact.local',
      documentNumber: text(input.documentNumber) || '33445566',
    },
  });
  const shipment = buildShipment({
    shipmentId,
    orderId,
    status: shipmentStatus,
    substatus,
    trackingNumber: trackingNumber || null,
  });
  putOrder(order, shipment);
  return { orderId, shipmentId, status: order.status, shipmentStatus, substatus };
}

export function markSandboxShipmentReady(shipmentId, input = {}) {
  ensureStore();
  const shipment = store.shipments.get(text(shipmentId));
  if (!shipment) return null;
  shipment.status = 'ready_to_ship';
  shipment.substatus = text(input.substatus) || 'ready_to_print';
  shipment.tracking_number = text(input.trackingNumber) || shipment.tracking_number || `2800${shipment.id}`;
  shipment.last_updated = nowIso();
  return shipment;
}

export async function buildSandboxLabelPdf({ shipmentId, orderId, trackingNumber }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('MERCADO ENVÍOS', { x: 18, y: 390, size: 14, font });
  page.drawText('ME2 · 10 × 15 cm', { x: 18, y: 372, size: 10, font: regular });
  page.drawText(`Envío ${shipmentId}`, { x: 18, y: 330, size: 12, font });
  page.drawText(`Pedido ${orderId}`, { x: 18, y: 312, size: 11, font: regular });
  page.drawText(trackingNumber || 'SIN-TRACKING', { x: 18, y: 260, size: 16, font });
  page.drawText('Sandbox local · no es una etiqueta real', { x: 18, y: 24, size: 8, font: regular });
  return Buffer.from(await pdf.save());
}

function authorize(headers) {
  const auth = headers.get('authorization') || headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!isMercadoLibreSandboxToken(token)) {
    return json(401, { message: 'invalid_token', error: 'invalid_token' });
  }
  return null;
}

function readBodyParams(body) {
  if (!body) return new URLSearchParams();
  if (typeof body === 'string') return new URLSearchParams(body);
  if (body instanceof URLSearchParams) return body;
  return new URLSearchParams(String(body));
}

async function handleOauthToken(body) {
  const params = readBodyParams(body);
  const refresh = text(params.get('refresh_token'));
  if (!isMercadoLibreSandboxToken(refresh)) {
    return json(400, { message: 'invalid_grant', error: 'invalid_grant' });
  }
  return json(200, {
    access_token: SANDBOX_ACCESS_TOKEN,
    refresh_token: SANDBOX_REFRESH_TOKEN,
    expires_in: 10800,
    user_id: SANDBOX_SELLER_ID,
    token_type: 'bearer',
    scope: 'offline_access read write',
  });
}

function handleSearchOrders(url) {
  const seller = text(url.searchParams.get('seller'));
  if (seller && seller !== SANDBOX_SELLER_ID) {
    return json(200, { results: [], paging: { total: 0, offset: 0, limit: 50 } });
  }
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 50);
  const all = listSandboxOrders().sort((left, right) => String(right.last_updated).localeCompare(String(left.last_updated)));
  const results = all.slice(offset, offset + limit);
  return json(200, {
    results,
    paging: { total: all.length, offset, limit },
  });
}

function handleItemsSearch(url, sellerId) {
  if (text(sellerId) !== SANDBOX_SELLER_ID) {
    return json(200, { results: [], paging: { total: 0, offset: 0, limit: 50 } });
  }
  const ids = [...store.items.keys()];
  return json(200, {
    results: ids,
    paging: { total: ids.length, offset: 0, limit: 50 },
    scroll_id: null,
  });
}

function handleItems(url) {
  const ids = text(url.searchParams.get('ids')).split(',').map(text).filter(Boolean);
  const rows = ids.map((id) => {
    const item = store.items.get(id);
    if (!item) return { code: 404, body: { message: 'Item not found' } };
    return { code: 200, body: item };
  });
  return json(200, rows);
}

async function handleShipmentLabels(url) {
  const ids = text(url.searchParams.get('shipment_ids')).split(',').map(text).filter(Boolean);
  if (!ids.length) return json(400, { message: 'shipment_ids is required' });
  const parts = [];
  for (const shipmentId of ids) {
    const shipment = getSandboxShipment(shipmentId);
    if (!shipment) return json(404, { message: 'Shipment not found', error: 'not_found' });
    const printable = shipment.status === 'ready_to_ship'
      && (shipment.substatus === 'ready_to_print' || shipment.substatus === 'printed');
    if (!printable) {
      return json(400, { message: 'not_printable_status', error: 'not_printable_status' });
    }
    parts.push(await buildSandboxLabelPdf({
      shipmentId: text(shipment.id),
      orderId: text(shipment.order_id),
      trackingNumber: shipment.tracking_number,
    }));
    if (shipment.substatus === 'ready_to_print') shipment.substatus = 'printed';
  }
  return new Response(parts[0], {
    status: 200,
    headers: { 'content-type': 'application/pdf' },
  });
}

export async function mercadoLibreSandboxFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  const method = text(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase() || 'GET';
  const headers = new Headers(init.headers || (typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined));
  return handleSandboxRequest({
    url,
    method,
    headers,
    body: init.body,
  });
}

export async function handleSandboxRequest({ url, method, headers, body }) {
  ensureStore();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (method === 'POST' && path === '/oauth/token') {
    return handleOauthToken(body);
  }
  const denied = authorize(headers);
  if (denied) return denied;

  if (method === 'GET' && path === '/users/me') return json(200, sellerUser());
  const userMatch = /^\/users\/([^/]+)$/.exec(path);
  if (method === 'GET' && userMatch) {
    if (userMatch[1] !== SANDBOX_SELLER_ID) return json(404, { message: 'User not found' });
    return json(200, sellerUser());
  }
  if (method === 'GET' && path === '/orders/search') return handleSearchOrders(url);
  const billingMatch = /^\/orders\/billing-info\/([^/]+)\/([^/]+)$/.exec(path);
  if (method === 'GET' && billingMatch) {
    const order = getSandboxOrder(billingMatch[2]);
    if (!order) return json(404, { message: 'Billing info not found' });
    return json(200, {
      site_id: billingMatch[1] || SANDBOX_SITE_ID,
      buyer: {
        billing_info: {
          name: order.buyer?.first_name,
          last_name: order.buyer?.last_name,
          identification: { type: 'DNI', number: order.buyer?.doc_number },
          attributes: { cust_type: 'CO' },
        },
      },
    });
  }
  const orderMatch = /^\/orders\/([^/]+)$/.exec(path);
  if (method === 'GET' && orderMatch) {
    const order = getSandboxOrder(orderMatch[1]);
    if (!order) return json(404, { message: 'Order not found' });
    return json(200, order);
  }
  const shipmentMatch = /^\/shipments\/([^/]+)$/.exec(path);
  if (method === 'GET' && shipmentMatch) {
    const shipment = getSandboxShipment(shipmentMatch[1]);
    if (!shipment) return json(404, { message: 'Shipment not found' });
    return json(200, shipment);
  }
  if (method === 'GET' && path === '/shipment_labels') return handleShipmentLabels(url);
  const itemsSearch = /^\/users\/([^/]+)\/items\/search$/.exec(path);
  if (method === 'GET' && itemsSearch) return handleItemsSearch(url, itemsSearch[1]);
  if (method === 'GET' && path === '/items') return handleItems(url);

  return json(404, { message: `Sandbox no implementa ${method} ${path}` });
}

async function notifySandboxResource(resource, topic) {
  const webhook = await import('./mercado-libre-webhook.js');
  return webhook.ingestMercadoLibreNotification({
    topic,
    resource,
    user_id: SANDBOX_SELLER_ID,
    sent: Date.now(),
  });
}

export function createMercadoLibreSandboxApp() {
  const app = new Hono();
  app.get('/health', (c) => c.json({
    ok: true,
    sandbox: true,
    sellerId: SANDBOX_SELLER_ID,
    orders: listSandboxOrders().length,
  }));
  app.post('/dev/push-order', async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const created = pushSandboxOrder(body);
    let ingested = null;
    if (body.notify !== false) {
      ingested = await notifySandboxResource(`/orders/${created.orderId}`, 'orders_v2');
    }
    return c.json({ ...created, ingested });
  });
  app.post('/dev/notify', async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const shipmentId = text(body.shipmentId);
    const orderId = text(body.orderId);
    if (!shipmentId && !orderId) return c.json({ error: 'Falta orderId o shipmentId.' }, 400);
    const ingested = await notifySandboxResource(
      shipmentId ? `/shipments/${shipmentId}` : `/orders/${orderId}`,
      shipmentId ? 'shipments' : 'orders_v2',
    );
    return c.json(ingested);
  });
  app.post('/dev/ready-to-ship', async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const shipmentId = text(body.shipmentId);
    const shipment = markSandboxShipmentReady(shipmentId, body);
    if (!shipment) return c.json({ error: 'Envío no encontrado.' }, 404);
    let ingested = null;
    if (body.notify !== false) {
      ingested = await notifySandboxResource(`/shipments/${shipmentId}`, 'shipments');
    }
    return c.json({
      shipmentId,
      status: shipment.status,
      substatus: shipment.substatus,
      ingested,
    });
  });
  app.all('/*', async (c) => {
    const incoming = new URL(c.req.url);
    const mapped = new URL(`${c.req.path}${incoming.search}`, 'https://api.mercadolibre.com');
    let body;
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      body = await c.req.text();
    }
    return mercadoLibreSandboxFetch(mapped, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body,
    });
  });
  return app;
}

async function clearSandboxGrantIfPresent(core, companyId) {
  const result = await core.pool.query(
    'select mercado_libre_refresh_token from companies where id = $1',
    [companyId],
  );
  const token = result.rows[0]?.mercado_libre_refresh_token;
  if (!isMercadoLibreSandboxToken(token)) return false;
  await core.clearMercadoLibreGrant(companyId);
  return true;
}

async function relinkMercadoLibreChannelAccount(db, companyId, displayName) {
  await db.query(
    `update order_channel_accounts a
        set external_account_id = $2
       from order_channels ch
      where a.channel_id = ch.id
        and a.company_id = $1
        and ch.code = 'mercado_libre'
        and a.external_account_id = 'default'`,
    [companyId, SANDBOX_SELLER_ID],
  ).catch(() => {});
  const { ensureMercadoLibreOrderAccount } = await import('./order-adapters/mercadolibre.js');
  await ensureMercadoLibreOrderAccount(db, companyId, displayName, SANDBOX_SELLER_ID);
}

export async function applyMercadoLibreSandboxCompany(company, env = process.env) {
  const core = await import('@zentofact/core');
  const companyId = Number(company?.id);
  if (!Number.isInteger(companyId) || companyId <= 0) return { applied: false };
  if (!mercadoLibreSandboxEnabled(env)) {
    const cleared = await clearSandboxGrantIfPresent(core, companyId);
    return { applied: false, cleared };
  }
  await core.setMercadoLibreGrant(companyId, {
    userId: SANDBOX_SELLER_ID,
    siteId: SANDBOX_SITE_ID,
    accessToken: SANDBOX_ACCESS_TOKEN,
    refreshToken: SANDBOX_REFRESH_TOKEN,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  const displayName = company.nombreComercial || company.nombre || company.razonSocial || 'LIMBO';
  await relinkMercadoLibreChannelAccount(core.pool, companyId, displayName);
  return { applied: true, userId: SANDBOX_SELLER_ID };
}
