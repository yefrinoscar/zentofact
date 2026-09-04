// ZentoFact API — capa HTTP delgada que expone @zentofact/core.
// El core no sabe que lo llama HTTP; aquí solo mapeamos rutas -> funciones del core.
// Omitido en web: paths/FS, diálogos nativos y scraper Falabella local.
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '../../..');
// Carga el .env de la raíz ANTES de importar el core (core/db lee la conexión al importarse).
config({ path: resolve(appRoot, '.env') });
process.env.PUPPETEER_CACHE_DIR ||= resolve(appRoot, '.cache', 'puppeteer');

const { serve } = await import('@hono/node-server');
const { Hono } = await import('hono');
const { cors } = await import('hono/cors');
const { stream } = await import('hono/streaming');
const core = await import('@zentofact/core');
await core.runMigrations(core.pool);

// PR previews de Railway nacen con Postgres vacío: auth + datos demo antes del resto.
const { shouldSeedPreview, isRailwayPrPreview } = await import('./preview-env.js');
const bootstrapEmailEarly = String(process.env.ADMIN_EMAIL || process.env.AUTH_SUPERADMIN_EMAIL || '').trim();
const bootstrapPasswordEarly = String(process.env.ADMIN_PASSWORD || process.env.SEED_USER_PASSWORD || '').trim();
// Solo si vamos a sembrar: permitir signup del admin bootstrap.
if (shouldSeedPreview() && bootstrapEmailEarly && bootstrapPasswordEarly) {
  process.env.AUTH_ALLOW_SIGNUP = 'true';
}

const { auth, requireAuth, requireCsrf, requirePermission, requireAnyPermission, requireAdmin, requireSuperadmin, csrfTokenForSession } = await import('./auth.js');
const { localWebOrigins } = await import('./local-web-origins.js');
const users = await import('./users.js');
const { PERMISSIONS, ROLE_PRESETS, userHasPermission } = await import('./permissions.js');
const insumos = await import('./insumos.js');
await insumos.ensureTables();
if (shouldSeedPreview()) {
  const { bootstrapPreviewIfNeeded } = await import('./seed-preview.js');
  await bootstrapPreviewIfNeeded();
} else if (isRailwayPrPreview()) {
  // Skip explícito: no migrar auth, no admin, no datos demo.
  console.log('[SEED] Preview seed omitido (SEED_PREVIEW=false o SKIP_PREVIEW_SEED=true); no se crea nada');
} else {
  await users.ensureUserColumns();
  await users.ensureBootstrapAdmin();
}
const autoEmit = await import('./auto-emission.js');
await autoEmit.ensureTables();
const stockJobs = await import('./catalog/stock-jobs.js');
await stockJobs.ensureStockJobTables();
const stockAssociations = await import('./catalog/stock-associations.js');
const systemConfig = await import('./system-config.js');
await systemConfig.ensureSystemConfigTable();
const { shouldListenStockOrder } = await import('./catalog/stock-commitment.js');
const listenReset = await import('./catalog/stock-listen-reset.js');
await listenReset.resetInventoryListenHistory();
const falabellaSync = await import('./falabella-sync.js');
const ordersInbox = await import('./orders-inbox.js');
const logisticsInbox = await import('./logistics-inbox.js');
const orderManagement = await import('./order-management.js');
const ownFleetConfig = await import('./own-fleet-config.js');
const orderSync = await import('./order-sync.js');
const productService = await import('./catalog/product-service.js');
const listingService = await import('./catalog/listing-service.js');
const associationCandidateService = await import('./catalog/association-candidate-service.js');
const inventoryService = await import('./catalog/inventory-service.js');
const skuResolver = await import('./catalog/sku-resolver.js');
const catalogImport = await import('./catalog/catalog-import.js');
const ripleyCatalogImport = await import('./catalog/ripley-catalog-import.js');
const catalogOperations = await import('./catalog/catalog-operations.js');
const catalogSales = await import('./catalog/catalog-sales.js');
const listingSnapshotService = await import('./catalog/listing-snapshot-service.js');
const ripleyCatalog = await import('./ripley-catalog.js');
const ripleyOrders = await import('./ripley-orders.js');
const ripleyLogistics = await import('./ripley-logistics.js');
const marketplacePublication = await import('./catalog/marketplace-publication.js');
const dashboard = await import('./dashboard.js');
const pagos = await import('./pagos.js');
const invoiceReports = await import('./pagos-invoice.js');
const shippingLabelSheet = await import('./shipping-label-sheet.js');
const pickingScanner = await import('./picking-scanner.js');
const readyToShipOperation = await import('./falabella-ready-to-ship-operation.js');
const { operationalErrorBody } = await import('./error-log.js');
const {
  normalizeFalabellaManifestDocumentRequests,
  normalizeFalabellaManifestOrders,
} = await import('./falabella-manifest-request.js');
const { combineFalabellaManifestPdfDocuments } = await import('./falabella-manifest-pdf.js');
// Cola persistente: el request HTTP sólo encola y el worker procesa fuera del ciclo de respuesta.
const manifestJobs = await import('./falabella-manifest-jobs.js');

const app = new Hono();

// CORS con credenciales (cookies de sesión) para el front web.
const railwayOrigin = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '';
const webOrigins = Array.from(new Set([
  ...(process.env.WEB_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  railwayOrigin,
  'http://localhost:3011',
  'http://127.0.0.1:3011',
  'http://localhost:3000',
  ...localWebOrigins(),
].filter(Boolean)));
app.use('*', cors({ origin: webOrigins, credentials: true }));

// Log de todas las requests (para diagnóstico).
app.use('*', async (c, next) => {
  const t = Date.now();
  await next();
  console.log(`[REQ] ${c.req.method} ${c.req.path} → ${c.res.status} (${Date.now() - t}ms)`);
});

// Better Auth: /api/auth/* (login, logout, sesión). Público (antes del guard).
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// Webhook de Falabella. Público (sin cookie de sesión).
// Auth: secreto ÚNICO por empresa en DB (auto_emission_config.webhook_secret).
// Preferido: POST /webhooks/falabella/:companyId/:token  (token en path; Falabella solo soporta URL).
// Legacy:     POST /webhooks/falabella/:companyId?secret=... o header x-webhook-secret
// Fail-closed: sin secret en DB o token incorrecto → 401. GET → 405.
async function handleFalabellaWebhook(c, companyId, token) {
  const id = Number(companyId);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'unauthorized' }, 401);
  const provided = String(token || c.req.query('secret') || c.req.header('x-webhook-secret') || '').trim();
  if (!(await autoEmit.verifyCompanyWebhookAuth(id, provided))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let payload = {};
  try { payload = await c.req.json(); } catch { payload = {}; }
  try {
    const r = await autoEmit.handleWebhook(id, payload);
    return c.json({ ok: true, ...r });
  } catch (e) {
    console.error('[WEBHOOK ERROR]', (e && e.stack) || e);
    // 200 para que Falabella no reintente en bucle por errores nuestros; el evento ya puede estar en DB.
    return c.json({ ok: false, error: String((e && e.message) || e) }, 200);
  }
}

app.post('/webhooks/falabella/:companyId/:token', (c) =>
  handleFalabellaWebhook(c, c.req.param('companyId'), c.req.param('token')));
app.post('/webhooks/falabella/:companyId', (c) =>
  handleFalabellaWebhook(c, c.req.param('companyId'), ''));
app.on(['GET'], '/webhooks/falabella/*', (c) => c.json({ error: 'method not allowed' }, 405));
// Guard: exige sesión solo en las rutas protegidas del API (login/estáticos quedan públicos).
app.use('*', requireAuth());
app.use('*', requireCsrf());

// Permisos por módulo (menú). /me y /health no aplican.
const moduleGuards = [
  ['/dashboard', 'dashboard'],
  ['/pagos', 'pagos'],
  ['/orders-inbox', 'orders_inbox'],
  ['/facturas', 'facturas'],
  ['/workflow', 'falabella_sellers'],
  ['/auto-emit', 'auto_emision'],
  ['/insumos', 'insumos'],
];
for (const [prefix, perm] of moduleGuards) {
  const permissionGuard = requirePermission(perm);
  app.use(prefix, permissionGuard);
  app.use(`${prefix}/*`, permissionGuard);
}
const orderManagementGuard = requireAnyPermission(['order_management', 'salesperson']);
app.use('/order-management', orderManagementGuard);
app.use('/order-management/*', orderManagementGuard);
const logisticsInboxGuard = requireAnyPermission(['orders_inbox', 'order_management']);
app.use('/logistics-inbox', logisticsInboxGuard);
app.use('/logistics-inbox/*', logisticsInboxGuard);

const catalogGuard = (c, next) => {
  const path = c.req.path;
  if (
    path === '/catalog/sales/today'
    || path === '/catalog/sales/today/refresh'
    || path === '/catalog/image'
  ) {
    const keys = path === '/catalog/image'
      ? ['productos', 'order_management', 'salesperson']
      : ['productos', 'order_management'];
    return requireAnyPermission(keys)(c, next);
  }
  if (c.req.method === 'GET' && path === '/products') {
    return requireAnyPermission(['productos', 'salesperson'])(c, next);
  }
  return requirePermission('productos')(c, next);
};
for (const prefix of ['/products', '/product-listings', '/inventory', '/catalog']) {
  app.use(prefix, catalogGuard);
  app.use(`${prefix}/*`, catalogGuard);
}

const boletasAccessGuard = (c, next) => (
  c.req.method === 'GET' && c.req.path === '/boletas'
    ? requireAnyPermission(['boletas', 'credit_notes_bulk'])(c, next)
    : requirePermission('boletas')(c, next)
);
app.use('/boletas', boletasAccessGuard);
app.use('/boletas/*', boletasAccessGuard);

// /falabella contiene tanto el gestor de sellers como acciones usadas desde
// Recepción de pedidos y el escáner. Se protege cada familia por su función.
const falabellaAccessGuard = (c, next) => {
  const path = c.req.path;
  if (path.startsWith('/falabella/picking/')) {
    return requirePermission('orders_scanner')(c, next);
  }
  if (/^\/falabella\/[^/]+\/products(?:\/|$)/.test(path)) {
    return requirePermission('productos')(c, next);
  }
  if (/^\/falabella\/[^/]+\/feeds(?:\/|$)/.test(path)) {
    return requireAnyPermission(['productos', 'falabella_sellers'])(c, next);
  }
  const sharedWithInbox = path === '/falabella/shipping-labels/a4'
    || path === '/falabella/manifests'
    || path.startsWith('/falabella/manifests/')
    || /^\/falabella\/[^/]+\/orders\/[^/]+\/(items|ready-to-ship|shipping-label)$/.test(path);
  if (sharedWithInbox) {
    return requireAnyPermission(
      ['orders_inbox', 'falabella_sellers'],
      {
        readOnly: path === '/falabella/shipping-labels/a4'
          || path === '/falabella/manifests/list'
          || path === '/falabella/manifests/document'
          || path === '/falabella/manifests/documents',
      },
    )(c, next);
  }
  return requirePermission('falabella_sellers')(c, next);
};
app.use('/falabella', falabellaAccessGuard);
app.use('/falabella/*', falabellaAccessGuard);

const ok = (c, data, status = 200) => c.json(data, status);
const fail = (c, e, status = 500) => c.json(operationalErrorBody(e, {
  operation: 'api',
  context: { method: c.req.method, path: c.req.path, status },
}), status);

function salespersonOnlyUserId(c) {
  const user = c.get('user');
  if (!user?.id) return null;
  if (userHasPermission(user, 'salesperson') && !userHasPermission(user, 'order_management')) {
    return String(user.id);
  }
  return null;
}

function scopedOrderFilters(c, filters = {}) {
  const createdBy = salespersonOnlyUserId(c);
  return createdBy ? { ...filters, createdBy } : filters;
}

function publicFalabellaManifestJob(job) {
  if (!job) return null;
  const { fingerprint: _fingerprint, orders: _orders, ...publicJob } = job;
  return publicJob;
}

app.get('/health', (c) => ok(c, { ok: true, service: 'zentofact-api', ts: new Date().toISOString() }));

// ── Sesión / catálogo de permisos ──
app.get('/me', async (c) => {
  try {
    const sessionUser = c.get('user');
    const full = sessionUser?.id ? await users.getUserById(sessionUser.id) : null;
    return ok(c, {
      user: full || sessionUser,
      permissions: PERMISSIONS,
      roles: ROLE_PRESETS,
      csrfToken: csrfTokenForSession(c.get('session')),
    });
  } catch (e) { return fail(c, e); }
});
// Logout total: revoca TODAS las sesiones del usuario (otros tabs/dispositivos) y
// fuerza nuevo login. El cliente limpia cookies + localStorage después.
app.post('/me/logout', async (c) => {
  try {
    const user = c.get('user');
    if (!user?.id) return c.json({ error: 'No autenticado' }, 401);
    const result = await users.revokeAllSessionsForUser(user.id);
    return ok(c, { success: true, ...result });
  } catch (e) { return fail(c, e); }
});

// ── Dashboard consolidado ──
app.get('/dashboard', async (c) => {
  try {
    const data = await dashboard.getDashboard(c.req.query());
    c.header('Cache-Control', 'private, no-store');
    return ok(c, data);
  } catch (e) { return fail(c, e, 400); }
});
app.post('/dashboard/refresh', async (c) => {
  try {
    const refresh = await dashboard.refreshDashboard();
    return ok(c, refresh);
  } catch (e) { return fail(c, e); }
});

app.get('/pagos/imports', async (c) => {
  try { return ok(c, await pagos.listSettlementImports(c.req.query())); }
  catch (e) { return fail(c, e, e.status || 400); }
});
app.get('/pagos/lines', async (c) => {
  try { return ok(c, await pagos.listSettlementLines(c.req.query())); }
  catch (e) { return fail(c, e, e.status || 400); }
});
app.get('/pagos/sales', async (c) => {
  try { return ok(c, await pagos.listSettlementSales(c.req.query())); }
  catch (e) { return fail(c, e, e.status || 400); }
});
app.post('/pagos/imports', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await pagos.importSettlementCsv({
      ...body,
      importedBy: c.get('user')?.id || null,
    });
    dashboard.clearDashboardResponseCache();
    return ok(c, result, result.reused || result.replaced ? 200 : 201);
  } catch (e) { return fail(c, e, e.status || 400); }
});
app.get('/pagos/invoices', async (c) => {
  try { return ok(c, await invoiceReports.listInvoiceDocuments(c.req.query())); }
  catch (e) { return fail(c, e, e.status || 400); }
});
app.get('/pagos/invoices/:id', async (c) => {
  try { return ok(c, await invoiceReports.getInvoiceDocument(c.req.param('id'))); }
  catch (e) { return fail(c, e, e.status || 400); }
});
app.post('/pagos/invoices', async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      const error = new Error('No se pudo leer el archivo.');
      error.status = 400;
      throw error;
    }
    const result = await invoiceReports.importInvoiceReportCsv({
      ...body,
      importedBy: c.get('user')?.id || null,
    });
    return ok(c, result, result.reused || result.replaced ? 200 : 201);
  } catch (e) { return fail(c, e, e.status || 400); }
});

// ── Bandeja general de pedidos ──
app.get('/orders-inbox', async (c) => {
  try { return ok(c, await ordersInbox.listOrdersInbox(c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/orders-inbox/companies', async (c) => {
  try { return ok(c, await ordersInbox.listFalabellaInboxCompanies()); }
  catch (e) { return fail(c, e); }
});
app.post('/orders-inbox/sync', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const date = String(body?.date || '').trim();
    const result = await ordersInbox.syncAllOrdersInbox({
      syncOptions: date ? { mode: 'day', date } : {},
    });
    dashboard.clearDashboardResponseCache();
    return ok(c, result);
  }
  catch (e) { return fail(c, e, 400); }
});

app.get('/logistics-inbox', async (c) => {
  try { return ok(c, await logisticsInbox.listLogisticsInbox(c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/logistics-inbox/print', async (c) => {
  try {
    const body = await c.req.json();
    const user = c.get('user');
    return ok(c, await logisticsInbox.printLogisticsPackWithDefaults({
      ...body,
      printedBy: user?.email || user?.name || null,
    }));
  }
  catch (e) { return fail(c, e, 400); }
});

app.get('/order-management/geo/maps-key', async (c) => {
  try {
    const key = String(process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
    return ok(c, { key });
  } catch (e) { return fail(c, e); }
});
app.get('/order-management/own-fleet', async (c) => {
  try { return ok(c, await ownFleetConfig.loadOwnFleetConfig()); }
  catch (e) { return fail(c, e, 400); }
});
app.put('/order-management/own-fleet', requireAdmin(), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return ok(c, await ownFleetConfig.saveOwnFleetConfig(null, body, c.get('user')?.id));
  } catch (e) { return fail(c, e, 400); }
});

// ── Pedidos multicanal (backend nuevo; no reemplaza la bandeja actual) ──
app.get('/order-management/channels', async (c) => {
  try { return ok(c, await orderManagement.listOrderChannels()); }
  catch (e) { return fail(c, e); }
});
app.post('/order-management/channels', requirePermission('companies'), async (c) => {
  try { return ok(c, await orderManagement.createOrderChannel(await c.req.json()), 201); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/order-management/accounts', async (c) => {
  try { return ok(c, await orderManagement.listOrderChannelAccounts(c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/order-management/sync-status', requirePermission('order_management'), async (c) => {
  try { return ok(c, await orderSync.listOrderSyncStatuses(c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/order-management/accounts', requirePermission('companies'), async (c) => {
  try { return ok(c, await orderManagement.configureOrderChannelAccount(await c.req.json()), 201); }
  catch (e) { return fail(c, e, 400); }
});
app.patch('/order-management/accounts/:id', requirePermission('companies'), async (c) => {
  try {
    return ok(c, await orderManagement.updateOrderChannelAccount(
      Number(c.req.param('id')),
      await c.req.json(),
    ));
  } catch (e) { return fail(c, e, 400); }
});
app.get('/order-management/orders', async (c) => {
  try { return ok(c, await orderManagement.listOrders(scopedOrderFilters(c, c.req.query()))); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/order-management/canceled-orders', async (c) => {
  try { return ok(c, await orderManagement.listCanceledOrders(scopedOrderFilters(c, c.req.query()))); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/order-management/canceled-orders/:id/approve-return', requirePermission('return_stock_approve'), async (c) => {
  try {
    return ok(c, await orderManagement.approveReturnStock(c.req.param('id'), c.get('user')?.id));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/order-management/sales-pulse', requirePermission('order_management'), async (c) => {
  try { return ok(c, await orderManagement.getSalesPulse(c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/order-management/my-sales', requirePermission('salesperson'), async (c) => {
  try {
    const sessionUser = c.get('user');
    const full = sessionUser?.id ? await users.getUserById(sessionUser.id) : null;
    const createdBy = salespersonOnlyUserId(c) || sessionUser?.id;
    return ok(c, await orderManagement.getSalespersonHome({
      ...c.req.query(),
      userId: createdBy,
      commissionPercent: full?.commissionPercent ?? 0,
    }));
  } catch (e) { return fail(c, e, 400); }
});
app.post('/order-management/sync', requirePermission('order_management'), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return ok(c, await orderSync.syncOrders(body));
  } catch (e) { return fail(c, e, 400); }
});
app.get('/ripley/:companyId/logistics/labels', requirePermission('order_management'), async (c) => {
  try { return ok(c, await ripleyLogistics.listRipleySvcLabels(c.req.param('companyId'), c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/ripley/:companyId/logistics/manifest-labels', requirePermission('order_management'), async (c) => {
  try { return ok(c, await ripleyLogistics.listRipleySvcEligibleLabels(c.req.param('companyId'), c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/ripley/:companyId/logistics/manifests', requirePermission('order_management'), async (c) => {
  try { return ok(c, await ripleyLogistics.listRipleySvcManifests(c.req.param('companyId'), c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/ripley/:companyId/logistics/packages', requirePermission('order_management'), async (c) => {
  try { return ok(c, await ripleyLogistics.editRipleySvcPackages(c.req.param('companyId'), await c.req.json())); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/ripley/:companyId/logistics/labels/download', requirePermission('order_management'), async (c) => {
  try { return ok(c, await ripleyLogistics.downloadRipleySvcLabels(c.req.param('companyId'), await c.req.json())); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/ripley/:companyId/logistics/manifests', requirePermission('order_management'), async (c) => {
  try { return ok(c, await ripleyLogistics.scheduleRipleySvcManifest(c.req.param('companyId'), await c.req.json())); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/ripley/:companyId/logistics/manifests/:manifestId', requirePermission('order_management'), async (c) => {
  try { return ok(c, await ripleyLogistics.getRipleySvcManifest(c.req.param('companyId'), c.req.param('manifestId'), c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/ripley/:companyId/logistics/manifests/:manifestId/download', requirePermission('order_management'), async (c) => {
  try { return ok(c, await ripleyLogistics.downloadRipleySvcManifest(c.req.param('companyId'), c.req.param('manifestId'), c.req.query())); }
  catch (e) { return fail(c, e, 400); }
});
app.patch('/ripley/:companyId/logistics/manifests/:manifestId/labels', requirePermission('order_management'), async (c) => {
  try { return ok(c, await ripleyLogistics.detachRipleySvcManifestLabels(c.req.param('companyId'), c.req.param('manifestId'), await c.req.json())); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/order-management/orders/ingest', requirePermission('order_management'), async (c) => {
  try {
    const body = await c.req.json();
    const idempotencyKey = String(
      c.req.header('idempotency-key') || body.idempotencyKey || '',
    ).trim();
    if (!idempotencyKey) {
      return c.json({ error: 'Idempotency-Key es obligatorio para ingresar pedidos.' }, 400);
    }
    return ok(c, await orderManagement.ingestOrder({
      ...body,
      source: 'api',
      automatic: false,
      actorUserId: c.get('user')?.id,
      idempotencyKey,
      rawPayload: body.rawPayload ?? body,
    }), 201);
  } catch (e) { return fail(c, e, 400); }
});
app.post('/order-management/orders/manual', async (c) => {
  try {
    const body = await c.req.json();
    const idempotencyKey = String(
      c.req.header('idempotency-key') || body.idempotencyKey || '',
    ).trim();
    if (!idempotencyKey) {
      return c.json({ error: 'Idempotency-Key es obligatorio para registrar la venta.' }, 400);
    }
    const result = await orderManagement.ingestOrder({
      ...body,
      source: 'manual',
      automatic: false,
      actorUserId: c.get('user')?.id,
      idempotencyKey,
      rawPayload: body.rawPayload ?? body,
    });
    if (result?.order?.companyId && shouldListenStockOrder({
      status: result.order.fulfillmentStatus,
      orderedAt: result.order.orderedAt,
    })) {
      try {
        await stockJobs.enqueueStockJob({
          orderId: result.order.id,
          companyId: result.order.companyId,
          externalOrderId: result.order.externalOrderId,
          orderNumber: result.order.externalOrderNumber,
          source: 'manual',
        });
      } catch (queueError) {
        console.error(JSON.stringify({
          event: 'orders.manual.stock_job_enqueue_failed',
          orderId: result.order.id,
          error: queueError?.message,
        }));
      }
    }
    return ok(c, result, 201);
  } catch (e) { return fail(c, e, 400); }
});
app.get('/order-management/orders/:id', async (c) => {
  try {
    const order = await orderManagement.getOrder(Number(c.req.param('id')));
    const ownerId = salespersonOnlyUserId(c);
    if (ownerId && order?.createdBy !== ownerId) return c.json({ error: 'Pedido no encontrado.' }, 404);
    return order ? ok(c, order) : c.json({ error: 'Pedido no encontrado.' }, 404);
  } catch (e) { return fail(c, e, 400); }
});
app.patch('/order-management/orders/:id/payment', async (c) => {
  try {
    const current = await orderManagement.getOrder(Number(c.req.param('id')));
    const ownerId = salespersonOnlyUserId(c);
    if (!current || (ownerId && current.createdBy !== ownerId)) {
      return c.json({ error: 'Pedido no encontrado.' }, 404);
    }
    const body = await c.req.json();
    const order = await orderManagement.updateOrderPayment(Number(c.req.param('id')), {
      ...body,
      actorUserId: c.get('user')?.id,
    });
    return order ? ok(c, order) : c.json({ error: 'Pedido no encontrado.' }, 404);
  } catch (e) { return fail(c, e, 400); }
});

// ── Catálogo canónico e inventario compartido ──
app.get('/products', async (c) => {
  try { return ok(c, await productService.listProducts(c.req.query())); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/products/summary', async (c) => {
  try { return ok(c, await productService.getCatalogSummary(c.req.query())); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/products/profit-owners', async (c) => {
  try { return ok(c, await productService.listProfitOwners()); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/products', async (c) => {
  try { return ok(c, await productService.createProduct(await c.req.json(), c.get('user')?.id), 201); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/products/:id', async (c) => {
  try {
    const product = await productService.getProduct(Number(c.req.param('id')));
    return product ? ok(c, product) : c.json({ error: 'Producto no encontrado.' }, 404);
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/products/:id/activity', async (c) => {
  const startedAt = performance.now();
  try {
    const body = await c.req.json().catch(() => ({}));
    const kind = String(body.kind || 'sales').trim().toLowerCase();
    if (!['sales', 'returns'].includes(kind)) throw new Error('kind inválido.');
    const hydration = await catalogSales.hydrateProductActivity(c.req.param('id'), { ...body, kind });
    const activity = kind === 'returns'
      ? await productService.getProductReturns(c.req.param('id'), body)
      : await productService.getProductSales(c.req.param('id'), body);
    return ok(c, {
      kind,
      ...activity,
      hydration,
      durationMs: Math.round(performance.now() - startedAt),
      source: hydration.coverage.liveVerified ? 'falabella_live' : 'local_fallback',
    });
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.patch('/products/:id', async (c) => {
  try { return ok(c, await productService.updateProduct(c.req.param('id'), await c.req.json(), c.get('user')?.id)); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/products/:id/archive', async (c) => {
  try { return ok(c, await productService.archiveProduct(c.req.param('id'), c.get('user')?.id)); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/products/:id/listings', async (c) => {
  try { return ok(c, await listingService.listProductListings(c.req.param('id'))); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/products/:id/listings', async (c) => {
  try { return ok(c, await listingService.createListing(c.req.param('id'), await c.req.json()), 201); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/product-listings/association-candidates', async (c) => {
  try { return ok(c, await associationCandidateService.listLiveAssociationCandidates(c.req.query())); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.patch('/product-listings/:id', async (c) => {
  try { return ok(c, await listingService.updateListing(c.req.param('id'), await c.req.json())); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/product-listings/:id/unlink', async (c) => {
  try { return ok(c, await listingService.unlinkListing(c.req.param('id'))); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/product-listings/link', async (c) => {
  try { return ok(c, await listingService.linkListing(await c.req.json()), 201); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/product-listings/link-batch', async (c) => {
  try { return ok(c, await listingService.linkListingsBatch(await c.req.json()), 201); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/product-listings/:id/apply-stock-to-open-orders', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return ok(c, await catalogOperations.applyStockToOpenOrders(c.req.param('id'), {
      ...body,
      actorUserId: c.get('user')?.id,
    }));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/catalog/inventory/apply-ready-orders', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const queued = await stockJobs.enqueueStockJobsForOperationalDate({
      date: body.date,
      source: body.source || 'catchup',
    });
    if (body.dryRun === true) return ok(c, { ...queued, dryRun: true });
    const drained = await stockJobs.drainStockQueue();
    return ok(c, { ...queued, dryRun: false, drained });
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/products/:id/inventory', async (c) => {
  try { return ok(c, await inventoryService.getInventory(c.req.param('id'))); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/products/:id/movements', async (c) => {
  try { return ok(c, await inventoryService.listMovements(c.req.param('id'), c.req.query())); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/products/:id/inventory/adjust', async (c) => {
  try {
    const body = await c.req.json();
    return ok(c, await inventoryService.adjustInventory(c.req.param('id'), {
      ...body,
      idempotencyKey: c.req.header('idempotency-key') || body.idempotencyKey,
    }, c.get('user')?.id));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/inventory/resolve-sku', async (c) => {
  try { return ok(c, await skuResolver.previewResolveSku(await c.req.json())); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/catalog/import/falabella', async (c) => {
  try { return ok(c, await catalogImport.importFalabellaCatalog(await c.req.json(), c.get('user')?.id)); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/catalog/sync/falabella', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return ok(c, await catalogImport.syncAllFalabellaCatalog(body, c.get('user')?.id));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/catalog/sync/ripley', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return ok(c, await ripleyCatalogImport.syncRipleyCatalog(body, c.get('user')?.id));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/catalog/refresh-listing-snapshots', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return ok(c, await listingSnapshotService.refreshMarketplaceListingSnapshots(body));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/ripley/:companyId/products', requirePermission('productos'), async (c) => {
  try {
    return ok(c, await ripleyCatalog.listRipleyProducts(c.req.param('companyId'), c.req.query(), {
      getCompany: core.getCompany,
    }));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/catalog/unmapped-skus', async (c) => {
  try { return ok(c, await catalogOperations.listUnmappedSkus(c.req.query())); }
  catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/catalog/image', async (c) => {
  try {
    const imageUrl = new URL(c.req.query('url') || '');
    if (imageUrl.protocol !== 'https:' || !/(^|\.)falabella\.com$/i.test(imageUrl.hostname)) {
      return c.json({ error: 'La imagen solicitada no pertenece a Falabella.' }, 400);
    }
    const response = await fetch(imageUrl, {
      headers: { accept: 'image/png,image/jpeg,image/webp;q=0.9,*/*;q=0.1' },
      redirect: 'follow',
    });
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
      return c.json({ error: 'La fotografía no está disponible.' }, 404);
    }
    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'private, max-age=86400');
    return c.body(await response.arrayBuffer());
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.get('/catalog/sales/today', async (c) => {
  const startedAt = performance.now();
  try {
    const query = c.req.query();
    const hydration = await catalogSales.hydrateRecentSalesActivity(query);
    const sales = await productService.listTodayProductSales(query);
    return ok(c, {
      ...sales,
      hydration,
      durationMs: Math.round(performance.now() - startedAt),
      source: hydration.coverage.liveVerified ? 'falabella_live' : 'local_fallback',
    });
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/catalog/sales/today/refresh', async (c) => {
  const startedAt = performance.now();
  try {
    const body = await c.req.json().catch(() => ({}));
    const hydration = await catalogSales.hydrateRecentSalesActivity(body);
    const sales = await productService.listTodayProductSales(body);
    return ok(c, {
      ...sales,
      hydration,
      durationMs: Math.round(performance.now() - startedAt),
      source: hydration.coverage.liveVerified ? 'falabella_live' : 'local_fallback',
    });
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});

// ── Cola de descuentos de stock (productos) ──
app.get('/catalog/stock-jobs/config', async (c) => {
  try { return ok(c, await stockJobs.getConfig()); } catch (e) { return fail(c, e); }
});
app.post('/catalog/stock-jobs/pause', async (c) => {
  try {
    const { paused } = await c.req.json();
    return ok(c, await stockJobs.setPaused(paused));
  } catch (e) { return fail(c, e, 400); }
});
app.get('/catalog/stock-jobs/jobs', async (c) => {
  try { return ok(c, await stockJobs.recentJobs(Number(c.req.query('limit') || 60))); } catch (e) { return fail(c, e); }
});
app.get('/catalog/stock-jobs/jobs/:id/order-preview', async (c) => {
  try { return ok(c, await stockJobs.jobOrderPreview(Number(c.req.param('id')))); } catch (e) { return fail(c, e); }
});
app.post('/catalog/stock-jobs/jobs/:id/retry', async (c) => {
  try { return ok(c, await stockJobs.retryJob(Number(c.req.param('id')))); } catch (e) { return fail(c, e, 400); }
});
app.post('/catalog/stock-jobs/run', async (c) => {
  try {
    const stats = await stockJobs.processStockQueue({ limit: Number(c.req.query('limit') || 8) });
    return ok(c, stats);
  } catch (e) { return fail(c, e); }
});
app.get('/catalog/stock-jobs/unmatched', async (c) => {
  try { return ok(c, await stockAssociations.listUnmatchedStockItems()); }
  catch (e) { return fail(c, e); }
});
app.post('/catalog/stock-jobs/unmatched/:orderItemId/assign', async (c) => {
  try {
    return ok(c, await stockAssociations.assignUnmatchedStockItem({
      orderItemId: Number(c.req.param('orderItemId')),
      productId: (await c.req.json()).productId,
    }));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});

// ── Usuarios (solo admin / permiso users) ──
app.get('/users', requirePermission('users'), async (c) => {
  try { return ok(c, await users.listUsers()); } catch (e) { return fail(c, e); }
});
app.post('/users', requirePermission('users'), async (c) => {
  try { return ok(c, await users.createUser(await c.req.json(), c.get('user')?.id), 201); } catch (e) { return fail(c, e, 400); }
});
app.patch('/users/:id', requirePermission('users'), async (c) => {
  try { return ok(c, await users.updateUser(c.req.param('id'), await c.req.json(), c.get('user')?.id)); } catch (e) { return fail(c, e, 400); }
});
app.delete('/users/:id', requirePermission('users'), async (c) => {
  try {
    const actor = c.get('user');
    return ok(c, await users.deleteUser(c.req.param('id'), actor?.id));
  } catch (e) { return fail(c, e, 400); }
});
app.get('/users/meta/catalog', requirePermission('users'), async (c) => {
  try { return ok(c, { permissions: PERMISSIONS, roles: ROLE_PRESETS }); } catch (e) { return fail(c, e); }
});

// ── Configuración del sistema (solo superadmin) ──
app.get('/system/config', requireSuperadmin(), async (c) => {
  try { return ok(c, await systemConfig.getSystemConfig()); } catch (e) { return fail(c, e); }
});
app.put('/system/config/:key', requireSuperadmin(), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const flag = await systemConfig.setSystemFlag(
      c.req.param('key'),
      body,
      c.get('user')?.id,
    );
    return ok(c, { flag });
  } catch (e) {
    const status = Number(e?.status || 400);
    if (e?.readiness) {
      return c.json({
        error: String(e?.message || e),
        code: e.code,
        readiness: e.readiness,
      }, status);
    }
    return fail(c, e, status);
  }
});

app.get('/insumos', async (c) => {
  try {
    return ok(c, await insumos.listInsumos({
      search: c.req.query('search'),
      stock: c.req.query('stock'),
      sortBy: c.req.query('sortBy'),
      sortDir: c.req.query('sortDir'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    }));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/insumos/movements', async (c) => {
  try {
    return ok(c, await insumos.listInsumoMovements({
      insumoId: c.req.query('insumoId'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    }));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/insumos', async (c) => {
  try { return ok(c, await insumos.createInsumo(await c.req.json(), c.get('user')), 201); } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.patch('/insumos/:id', async (c) => {
  try { return ok(c, await insumos.updateInsumo(c.req.param('id'), await c.req.json(), c.get('user'))); } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.post('/insumos/:id/adjust', async (c) => {
  try { return ok(c, await insumos.adjustInsumo(c.req.param('id'), await c.req.json(), c.get('user'))); } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});

// ── Empresas (DTO público: nunca expone secretos; solo flags has*) ──
app.get('/companies', async (c) => { try { return ok(c, await core.listPublicCompanies()); } catch (e) { return fail(c, e); } });
app.get('/companies/:id', requirePermission('companies'), async (c) => {
  try {
    const company = await core.getPublicCompany(Number(c.req.param('id')));
    if (!company) return c.json({ error: 'Empresa no encontrada' }, 404);
    return ok(c, company);
  } catch (e) { return fail(c, e); }
});
app.post('/companies', requirePermission('companies'), async (c) => { try { return ok(c, await core.createCompany(await c.req.json()), 201); } catch (e) { return fail(c, e, 400); } });
app.patch('/companies/:id', requirePermission('companies'), async (c) => {
  try {
    const company = await core.updateCompany(Number(c.req.param('id')), await c.req.json());
    if (!company) return c.json({ error: 'Empresa no encontrada' }, 404);
    return ok(c, company);
  } catch (e) { return fail(c, e, 400); }
});
app.delete('/companies/:id', requirePermission('companies'), async (c) => { try { return ok(c, await core.deleteCompany(Number(c.req.param('id')))); } catch (e) { return fail(c, e, 400); } });
app.post('/companies/:id/test-sunat', requirePermission('companies'), async (c) => {
  try { const { environment } = await c.req.json(); return ok(c, await core.testSunatConnection(Number(c.req.param('id')), environment)); }
  catch (e) { return fail(c, e); }
});

// ── Sucursales ──
app.get('/companies/:id/branches', requireAnyPermission(['boletas', 'facturas', 'companies']), async (c) => { try { return ok(c, await core.listBranches(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/branches', requirePermission('companies'), async (c) => { try { return ok(c, await core.createBranch(await c.req.json()), 201); } catch (e) { return fail(c, e, 400); } });
app.patch('/branches/:id', requirePermission('companies'), async (c) => { try { return ok(c, await core.updateBranch(Number(c.req.param('id')), await c.req.json())); } catch (e) { return fail(c, e, 400); } });

// ── Listados (filtros por query) ──
const parseFilter = (c) => {
  const q = c.req.query();
  return {
    ...q,
    companyId: q.companyId ? Number(q.companyId) : undefined,
    branchId: q.branchId ? Number(q.branchId) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
  };
};
app.get('/boletas', async (c) => { try { return ok(c, await core.listBoletas(parseFilter(c))); } catch (e) { return fail(c, e); } });
app.get('/facturas', async (c) => { try { return ok(c, await core.listFacturas(parseFilter(c))); } catch (e) { return fail(c, e); } });
// Conteos e importes consolidados, globales y por empresa.
const documentStatsHandler = async (c) => {
  try {
    const q = c.req.query();
    return ok(c, await core.getDocumentStats({
      fechaDesde: q.fechaDesde || undefined,
      fechaHasta: q.fechaHasta || undefined,
    }));
  } catch (e) { return fail(c, e); }
};
app.get('/documentos/stats', requireAnyPermission(['boletas', 'facturas', 'credit_notes_manage']), documentStatsHandler);
app.get('/boletas/stats', documentStatsHandler);
app.post('/facturas', async (c) => {
  try { const { input } = await c.req.json(); return ok(c, await core.createFactura(input), 201); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/facturas/:id/send', async (c) => {
  try { return ok(c, await core.sendFacturaToSunat(Number(c.req.param('id')))); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/facturas/:id/reemit', async (c) => {
  try { return ok(c, await core.reEmitFactura(Number(c.req.param('id')))); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/boletas', async (c) => {
  try { const { input } = await c.req.json(); return ok(c, await core.createBoleta(input), 201); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/boletas/:id/send', async (c) => {
  try { return ok(c, await core.sendBoletaToSunat(Number(c.req.param('id')))); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/boletas/:id/reemit', async (c) => {
  try { return ok(c, await core.reEmitBoleta(Number(c.req.param('id')))); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/facturas/:id/pdf', async (c) => {
  try { const b64 = await core.generateAcceptedFacturaPdfBase64(Number(c.req.param('id'))); return ok(c, { base64: b64 }); }
  catch (e) { return fail(c, e); }
});
app.get('/facturas/:id/xml', async (c) => {
  try { const base64 = await core.getFacturaXmlBase64(Number(c.req.param('id'))); return ok(c, { base64 }); }
  catch (e) { return fail(c, e); }
});
app.get('/facturas/:id/preview', async (c) => { try { return ok(c, await core.generateAcceptedFacturaPreviewHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/facturas/preview', async (c) => {
  try { const { companyId, venta } = await c.req.json(); return ok(c, await core.generatePreviewFacturaHtmlForVenta(companyId, venta)); }
  catch (e) { return fail(c, e); }
});
app.get('/credit-notes', requirePermission('credit_notes_manage'), async (c) => { try { return ok(c, await core.listCreditNotes(parseFilter(c))); } catch (e) { return fail(c, e); } });
app.post('/boletas/:id/refresh-status', async (c) => { try { return ok(c, await core.refreshBoletaStatus(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/facturas/:id/refresh-status', async (c) => { try { return ok(c, await core.refreshFacturaStatus(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });

// ── Correlativos ──
app.get('/branches/:id/correlatives', requireAnyPermission(['boletas', 'facturas', 'companies']), async (c) => { try { return ok(c, await core.getCorrelatives(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });

// ── PDFs (en memoria, base64 — sin disco) ──
app.get('/boletas/:id/pdf', async (c) => {
  try { const b64 = await core.generateAcceptedBoletaPdfBase64(Number(c.req.param('id'))); return ok(c, { base64: b64 }); }
  catch (e) { return fail(c, e); }
});
app.get('/boletas/:id/xml', async (c) => {
  try { const base64 = await core.getBoletaXmlBase64(Number(c.req.param('id'))); return ok(c, { base64 }); }
  catch (e) { return fail(c, e); }
});
// Los generadores del core devuelven un objeto { html, numeroCompleto, ... } → JSON, no c.html.
app.get('/boletas/:id/preview', async (c) => { try { return ok(c, await core.generateAcceptedBoletaPreviewHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.get('/credit-notes/:id/preview', requirePermission('credit_notes_manage'), async (c) => { try { return ok(c, await core.generatePreviewCreditNoteHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/boletas/preview', async (c) => {
  try { const { companyId, venta } = await c.req.json(); return ok(c, await core.generatePreviewBoletaHtmlForVenta(companyId, venta)); }
  catch (e) { return fail(c, e); }
});

// ── Notas de crédito (emitir) ──
app.post('/credit-notes', requirePermission('credit_notes_manage'), async (c) => {
  try {
    const { boletaId, facturaId, options } = await c.req.json();
    const parsedBoletaId = Number.isInteger(Number(boletaId)) && Number(boletaId) > 0 ? Number(boletaId) : null;
    const parsedFacturaId = Number.isInteger(Number(facturaId)) && Number(facturaId) > 0 ? Number(facturaId) : null;
    if (Number(parsedBoletaId !== null) + Number(parsedFacturaId !== null) !== 1) {
      throw new Error('Indica una boleta o una factura válida, no ambas');
    }
    const actor = c.get('user');
    const auditedOptions = {
      ...(options && typeof options === 'object' ? options : {}),
      usuarioCreacion: actor?.email || actor?.id || 'sistema:nota-credito',
    };
    const result = parsedFacturaId !== null
      ? await core.createAndSendCreditNoteFromFactura(parsedFacturaId, auditedOptions)
      : await core.createAndSendCreditNoteFromBoleta(parsedBoletaId, auditedOptions);
    return ok(c, result, 201);
  }
  catch (e) {
    const message = String((e && e.message) || e);
    return fail(c, e, /ya tiene nota de crédito|unique/i.test(message) ? 409 : 400);
  }
});
app.post('/credit-notes/batch', requirePermission('credit_notes_bulk'), async (c) => {
  try { const { boletaIds, options } = await c.req.json(); return ok(c, await core.createAndSendCreditNotesFromBoletas(boletaIds, options), 201); }
  catch (e) { return fail(c, e, 400); }
});

// ── Falabella (lógica compartida en core) ──
app.get('/falabella/picking/image', async (c) => {
  try {
    const imageUrl = new URL(c.req.query('url') || '');
    if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'media.falabella.com') {
      return c.json({ error: 'La imagen solicitada no pertenece a Falabella.' }, 400);
    }
    const response = await fetch(imageUrl, {
      headers: { accept: 'image/png,image/jpeg;q=0.9,*/*;q=0.1' },
      redirect: 'follow',
    });
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
      return c.json({ error: 'La fotografía no está disponible.' }, 404);
    }
    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'private, max-age=86400');
    return c.body(await response.arrayBuffer());
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.get('/falabella/picking/scan', async (c) => {
  try {
    return ok(c, await pickingScanner.lookupPickingScan({
      db: core.pool,
      getOrderItems: core.falabellaGetOrderItems,
      getShippingLabel: core.falabellaGetShippingLabel,
      input: c.req.query('code') || '',
    }));
  } catch (e) {
    return fail(c, e, Number(e?.status || 500));
  }
});
app.get('/falabella/:companyId/orders', async (c) => {
  try {
    const companyId = Number(c.req.param('companyId'));
    const filters = JSON.parse(c.req.query('filters') || '{}');
    if (c.req.query('source') === 'postgres') return ok(c, await falabellaSync.listLocalFalabellaOrders(companyId, filters));
    return ok(c, await core.falabellaGetOrders({ companyId, filters }));
  }
  catch (e) { return fail(c, e); }
});
app.get('/falabella/:companyId/orders/sync-status', async (c) => {
  try { return ok(c, await falabellaSync.getFalabellaSyncStatus(Number(c.req.param('companyId')))); }
  catch (e) { return fail(c, e); }
});
app.post('/falabella/:companyId/orders/sync', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return ok(c, await falabellaSync.syncFalabellaOrders(Number(c.req.param('companyId')), body));
  } catch (e) { return fail(c, e, 400); }
});
app.get('/falabella/:companyId/products', requirePermission('productos'), async (c) => {
  try { const filters = JSON.parse(c.req.query('filters') || '{}'); return ok(c, await core.falabellaGetProducts({ companyId: Number(c.req.param('companyId')), filters })); }
  catch (e) { return fail(c, e); }
});
app.post('/falabella/:companyId/products', requirePermission('productos'), async (c) => {
  try {
    const product = await c.req.json();
    return ok(c, await marketplacePublication.createMarketplaceProduct(
      core.falabellaCreateProduct,
      { companyId: Number(c.req.param('companyId')), product },
    ));
  } catch (e) { return fail(c, e, Number(e?.status || 400)); }
});
app.get('/falabella/:companyId/feeds', async (c) => {
  try { const filters = JSON.parse(c.req.query('filters') || '{}'); return ok(c, await core.falabellaGetFeeds({ companyId: Number(c.req.param('companyId')), filters })); }
  catch (e) { return fail(c, e); }
});
app.get('/falabella/:companyId/feeds/:feedId', async (c) => {
  try { return ok(c, await core.falabellaGetFeedStatus({ companyId: Number(c.req.param('companyId')), feedId: c.req.param('feedId') })); }
  catch (e) { return fail(c, e); }
});
app.get('/falabella/:companyId/orders/:orderId/items', async (c) => {
  try { return ok(c, await core.falabellaGetOrderItems({ companyId: Number(c.req.param('companyId')), orderId: c.req.param('orderId') })); }
  catch (e) { return fail(c, e); }
});
app.post('/falabella/:companyId/orders/:orderId/ready-to-ship', async (c) => {
  try {
    const companyId = Number(c.req.param('companyId'));
    const orderId = c.req.param('orderId');
    const outcome = await readyToShipOperation.markFalabellaOrderReadyToShip({
      pool: core.pool,
      companyId,
      orderId,
      setReadyToShip: core.falabellaSetStatusToReadyToShip,
      reconcile: core.falabellaCheckReadyToShipStatus,
      signal: c.req.raw.signal,
    });
    if (outcome.kind !== 'success') {
      return c.json(operationalErrorBody(outcome.error, {
        operation: 'falabella.ready-to-ship',
        context: { companyId, orderId, status: outcome.status },
      }), outcome.status);
    }
    dashboard.clearDashboardResponseCache();
    return ok(c, outcome.result);
  } catch (e) {
    return fail(c, e);
  }
});
app.get('/falabella/:companyId/orders/:orderId/shipping-label', async (c) => {
  try {
    const companyId = Number(c.req.param('companyId'));
    const orderId = c.req.param('orderId');
    const order = (await core.pool.query(
      'select status from falabella_orders where company_id=$1 and order_id=$2',
      [companyId, orderId],
    )).rows[0];
    if (!order || !core.canPrintFalabellaShippingLabel(order.status)) {
      return c.json({ error: 'Solo se pueden imprimir etiquetas de pedidos pendientes o listos para enviar.' }, 409);
    }
    const result = await core.falabellaGetShippingLabel({ companyId, orderId });
    if (result?.error) {
      const providerStatus = Number(result.status || 0);
      const status = providerStatus === 401 || providerStatus === 429 || providerStatus >= 500 ? 502 : providerStatus >= 400 ? providerStatus : 400;
      return c.json(operationalErrorBody(result.error, {
        operation: 'falabella.shipping-label',
        context: { companyId, orderId, status },
      }), status);
    }
    c.header('Cache-Control', 'private, no-store');
    return ok(c, result);
  } catch (e) { return fail(c, e); }
});
app.post('/falabella/shipping-labels/a4', async (c) => {
  try {
    const { orders } = await c.req.json();
    if (!Array.isArray(orders) || !orders.length) {
      return c.json({ error: 'Selecciona al menos una etiqueta para imprimir.' }, 400);
    }
    if (orders.length > 500) {
      return c.json({ error: 'Puedes imprimir hasta 500 etiquetas por vez.' }, 400);
    }
    const params = [];
    const tuples = [];
    for (const order of orders) {
      const companyId = Number(order?.companyId);
      const orderId = String(order?.orderId || '').trim();
      if (!Number.isInteger(companyId) || companyId <= 0 || !orderId) {
        return c.json({ error: 'La selección contiene un pedido inválido.' }, 400);
      }
      params.push(companyId, orderId);
      tuples.push(`($${params.length - 1}::int,$${params.length}::text)`);
    }
    const printable = await core.pool.query(
      `select fo.company_id, fo.order_id, fo.order_number, fo.status,
         fo.falabella_created_at, fo.raw_data,
         coalesce(nullif(c.nombre, ''), nullif(c.nombre_comercial, ''), c.razon_social, 'Tienda') as company_name
       from falabella_orders fo
       join companies c on c.id=fo.company_id
       where (fo.company_id, fo.order_id) in (${tuples.join(',')})`,
      params,
    );
    const printableByOrder = new Map(printable.rows.map((order) => [
      `${order.company_id}:${order.order_id}`,
      core.canPrintFalabellaShippingLabel(order.status),
    ]));
    const invalidOrder = orders.find((order) => !printableByOrder.get(`${Number(order.companyId)}:${String(order.orderId).trim()}`));
    if (invalidOrder) {
      return c.json({ error: `La orden ${invalidOrder.orderNumber || invalidOrder.orderId} ya fue enviada o todavía no está lista para imprimir.` }, 409);
    }
    const orderDetailsByKey = new Map(printable.rows.map((order) => [
      `${order.company_id}:${order.order_id}`,
      order,
    ]));
    const ordersGroupedBySeller = orders.map((order) => {
      const stored = orderDetailsByKey.get(`${Number(order.companyId)}:${String(order.orderId).trim()}`) || {};
      const raw = stored.raw_data || {};
      let warehouse = raw.Warehouse || {};
      if (typeof warehouse === 'string') {
        try { warehouse = JSON.parse(warehouse); } catch { warehouse = {}; }
      }
      const sellerKey = String(
        warehouse?.FacilityId
        || warehouse?.SellerWarehouseId
        || raw.SellerId
        || raw.SellerName
        || `company:${Number(order.companyId)}`,
      ).trim();
      return { ...order, sellerKey, status: stored.status };
    });
    const result = await shippingLabelSheet.buildA4ShippingLabelSheet(
      ordersGroupedBySeller,
      ({ companyId, orderId }) => core.falabellaGetShippingLabel({
        companyId,
        orderId,
        recordPrint: false,
      }),
      async ({ companyId, orderId, orderNumber }) => {
        const stored = orderDetailsByKey.get(`${companyId}:${orderId}`) || {};
        const raw = stored.raw_data || {};
        const inventory = await core.falabellaGetOrderItems({ companyId, orderId });
        return {
          ...inventory,
          orderNumber: stored.order_number || orderNumber,
          companyName: stored.company_name || '',
          customerName: [raw.CustomerFirstName, raw.CustomerLastName, raw.CustomerLastName2]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(' '),
          orderedAt: stored.falabella_created_at || null,
          shippingType: String(raw.ShippingType || '').trim(),
          orderDescription: String(raw.OrderDescription || raw.Description || raw.Remarks || raw.Notes || '').trim(),
        };
      },
      {
        onOrderLoaded: async ({ order, label, inventory }) => {
          const pending = String(order.status || '').toLowerCase().includes('pending');
          let trackingCodes = [];
          try {
            trackingCodes = await shippingLabelSheet.extractShippingLabelTrackingCodes(label);
          } catch (error) {
            if (pending) throw error;
            console.warn('[SHIPPING LABEL TRACKING]', error?.message || error);
          }
          if (pending && !trackingCodes.some(Boolean)) {
            throw new Error(`No se pudo leer el tracking de la etiqueta pendiente ${order.orderNumber}.`);
          }
          const trackedInventory = pickingScanner.attachShippingLabelTrackingCodes(inventory, trackingCodes);
          await pickingScanner.saveFalabellaTicketSnapshot(core.pool, order, trackedInventory);
        },
      },
    );
    const prints = await Promise.all(result.printedLabels.map(async (entry) => ({
      companyId: entry.companyId,
      orderId: entry.orderId,
      prints: await core.recordFalabellaLabelPrintIndexes(
        entry.companyId,
        entry.orderId,
        entry.labelIndexes,
      ),
    })));
    c.header('Cache-Control', 'private, no-store');
    return ok(c, { ...result, prints });
  } catch (e) {
    const providerStatus = Number(e?.providerStatus || 0);
    const status = providerStatus === 401 || providerStatus === 429 || providerStatus >= 500 ? 502 : 400;
    return fail(c, e, status);
  }
});
async function persistFalabellaManifestRuns(results) {
  for (const company of results || []) {
    const diagnostic = company?.diagnostic || {};
    const status = !company?.ok
      ? 'error'
      : Number(company?.createdManifests || 0) > 0
        ? 'created'
        : 'skipped';
    await core.pool.query(
      `INSERT INTO falabella_manifest_runs (
        company_id, company_name, operation, status, requested_orders, provider_orders,
        eligible_orders, already_manifested_orders, created_manifests, created_orders,
        stage, error, events, page_url, page_title, page_text,
        screenshot_mime_type, screenshot_base64
      ) VALUES (
        $1, $2, 'create', $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12::jsonb, $13, $14, $15, $16, $17
      )`,
      [
        Number(company?.companyId),
        String(company?.companyName || ''),
        status,
        Number(company?.requestedOrders || 0),
        Number(company?.providerOrders || 0),
        Number(company?.eligibleOrders || 0),
        Number(company?.alreadyManifestedOrders || 0),
        Number(company?.createdManifests || 0),
        Number(company?.createdOrders || 0),
        String(diagnostic?.stage || ''),
        company?.error ? String(company.error) : null,
        JSON.stringify(Array.isArray(diagnostic?.events) ? diagnostic.events : []),
        diagnostic?.pageUrl ? String(diagnostic.pageUrl) : null,
        diagnostic?.pageTitle ? String(diagnostic.pageTitle) : null,
        diagnostic?.pageText ? String(diagnostic.pageText) : null,
        diagnostic?.screenshotMimeType ? String(diagnostic.screenshotMimeType) : null,
        diagnostic?.screenshotBase64 ? String(diagnostic.screenshotBase64) : null,
      ],
    );
  }
}

const FALABELLA_MANIFEST_JOB_STALE_MS = 20 * 60 * 1000;
const FALABELLA_MANIFEST_JOB_HEARTBEAT_MS = 15 * 1000;
let falabellaManifestJobPumpPromise = null;

function falabellaManifestJobFailureMessage(result) {
  const failures = (result?.results || [])
    .filter((company) => !company?.ok)
    .map((company) => `${company.companyName || `Tienda ${company.companyId}`}: ${company.error || 'falló'}`);
  if (failures.length) return failures.join(' | ');
  if (!Number(result?.companies || 0)) return 'No se encontró ninguna tienda válida para procesar.';
  return 'No se pudieron crear todos los manifiestos solicitados.';
}

async function processFalabellaManifestJob(job) {
  const heartbeat = setInterval(() => {
    manifestJobs.heartbeatFalabellaManifestJob(job, 'procesando pedidos en Falabella', core.pool)
      .catch((error) => console.warn('[FALABELLA MANIFEST JOB HEARTBEAT]', error?.message || error));
  }, FALABELLA_MANIFEST_JOB_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    await manifestJobs.heartbeatFalabellaManifestJob(
      job,
      'procesando pedidos en Falabella',
      core.pool,
    );
    const result = await core.createFalabellaWebManifests({ orders: job.orders });
    await persistFalabellaManifestRuns(result.results).catch((error) => {
      console.warn('[FALABELLA MANIFEST ACTIVITY]', error?.message || error);
    });
    if (Number(result.failedCompanies || 0) > 0 || !Number(result.companies || 0)) {
      await manifestJobs.failFalabellaManifestJob(
        job,
        falabellaManifestJobFailureMessage(result),
        result,
        core.pool,
      );
      return;
    }
    await manifestJobs.completeFalabellaManifestJob(job, result, core.pool);
  } catch (error) {
    await manifestJobs.failFalabellaManifestJob(job, error, null, core.pool).catch((persistError) => {
      console.error('[FALABELLA MANIFEST JOB FAIL]', persistError?.stack || persistError);
    });
  } finally {
    clearInterval(heartbeat);
  }
}

async function drainFalabellaManifestJobs() {
  if (falabellaManifestJobPumpPromise) return falabellaManifestJobPumpPromise;
  const pump = (async () => {
    while (true) {
      const [job] = await manifestJobs.claimFalabellaManifestJobs(1, core.pool);
      if (!job) break;
      await processFalabellaManifestJob(job);
    }
  })();
  falabellaManifestJobPumpPromise = pump;
  try {
    await pump;
  } finally {
    if (falabellaManifestJobPumpPromise === pump) falabellaManifestJobPumpPromise = null;
  }
}

function scheduleFalabellaManifestJobs() {
  const timer = setTimeout(() => {
    drainFalabellaManifestJobs().catch((error) => {
      console.error('[FALABELLA MANIFEST JOB WORKER]', error?.stack || error);
    });
  }, 0);
  timer.unref?.();
}

app.post('/falabella/manifests', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const selection = normalizeFalabellaManifestOrders(body?.orders);
    if (!selection.ok || !selection.orders.length) {
      return c.json({ error: selection.error || 'No hay pedidos válidos para manifestar.' }, 400);
    }

    const result = await core.createFalabellaWebManifests({ orders: selection.orders });
    await persistFalabellaManifestRuns(result.results).catch((error) => {
      console.warn('[FALABELLA MANIFEST ACTIVITY]', error?.message || error);
    });
    const documents = result.results
      .map((company) => company.document)
      .filter((document) => Boolean(document?.base64));
    const combined = documents.length
      ? await combineFalabellaManifestPdfDocuments(
        documents,
        `manifiestos-falabella-${new Date().toISOString().slice(0, 10)}.pdf`,
      )
      : { base64: '', filename: '', mimeType: 'application/pdf' };
    c.header('Cache-Control', 'private, no-store');
    return ok(c, {
      ...result,
      results: result.results.map((company) => ({
        ...company,
        diagnostic: company.diagnostic
          ? { ...company.diagnostic, screenshotBase64: undefined }
          : undefined,
        document: company.document
          ? { ...company.document, base64: undefined }
          : undefined,
      })),
      base64: combined.base64,
      filename: combined.filename,
    });
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.post('/falabella/manifests/jobs', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const selection = normalizeFalabellaManifestOrders(body?.orders);
    if (!selection.ok || !selection.orders.length) {
      return c.json({ error: selection.error || 'No hay pedidos válidos para manifestar.' }, 400);
    }
    const queued = await manifestJobs.enqueueFalabellaManifestJob(selection.orders, core.pool);
    scheduleFalabellaManifestJobs();
    c.header('Cache-Control', 'private, no-store');
    return ok(c, {
      job: publicFalabellaManifestJob(queued.job),
      reused: queued.reused,
    }, 202);
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.get('/falabella/manifests/jobs/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Trabajo de manifiestos inválido.' }, 400);
    }
    const job = await manifestJobs.getFalabellaManifestJob(id, core.pool);
    if (!job) return c.json({ error: 'Trabajo de manifiestos no encontrado.' }, 404);
    c.header('Cache-Control', 'private, no-store');
    return ok(c, { job: publicFalabellaManifestJob(job) });
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.get('/falabella/manifests/activity', async (c) => {
  try {
    const requestedLimit = Number(c.req.query('limit') || 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? requestedLimit : 20));
    const { rows } = await core.pool.query(
      `SELECT id, company_id, company_name, operation, status, requested_orders,
        provider_orders, eligible_orders, already_manifested_orders,
        created_manifests, created_orders, stage, error, events,
        page_url, page_title, page_text,
        (screenshot_base64 IS NOT NULL AND screenshot_base64 <> '') AS has_screenshot,
        created_at
      FROM falabella_manifest_runs
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
      [limit],
    );
    c.header('Cache-Control', 'private, no-store');
    return ok(c, {
      runs: rows.map((row) => {
        const events = Array.isArray(row.events) ? row.events : [];
        return {
          id: String(row.id),
          companyId: Number(row.company_id),
          companyName: row.company_name,
          operation: row.operation,
          status: row.status,
          requestedOrders: Number(row.requested_orders || 0),
          providerOrders: Number(row.provider_orders || 0),
          eligibleOrders: Number(row.eligible_orders || 0),
          alreadyManifestedOrders: Number(row.already_manifested_orders || 0),
          createdManifests: Number(row.created_manifests || 0),
          createdOrders: Number(row.created_orders || 0),
          stage: row.stage,
          error: row.error,
          events,
          durationMs: core.falabellaManifestDurationMs(events),
          pageUrl: row.page_url,
          pageTitle: row.page_title,
          pageText: row.page_text,
          hasScreenshot: Boolean(row.has_screenshot),
          createdAt: row.created_at,
        };
      }),
    });
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.get('/falabella/manifests/activity/:id/screenshot', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Registro de actividad inválido.' }, 400);
    const { rows } = await core.pool.query(
      `SELECT screenshot_mime_type, screenshot_base64
       FROM falabella_manifest_runs WHERE id=$1 LIMIT 1`,
      [id],
    );
    if (!rows[0]?.screenshot_base64) return c.json({ error: 'Este registro no tiene una captura.' }, 404);
    c.header('Cache-Control', 'private, no-store');
    return ok(c, {
      mimeType: rows[0].screenshot_mime_type || 'image/jpeg',
      base64: rows[0].screenshot_base64,
    });
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.post('/falabella/manifests/list', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const selection = normalizeFalabellaManifestOrders(body?.orders, 500, 'consultar');
    if (!selection.ok || !selection.orders.length) {
      return c.json({ error: selection.error || 'No hay pedidos válidos para consultar.' }, 400);
    }
    const result = await core.listFalabellaWebManifests({ orders: selection.orders });
    c.header('Cache-Control', 'private, no-store');
    return ok(c, result);
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.post('/falabella/manifests/document', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const companyId = Number(body?.companyId);
    const manifestId = String(body?.manifestId || '').trim();
    if (!Number.isInteger(companyId) || companyId <= 0 || !manifestId) {
      return c.json({ error: 'Selecciona un manifiesto válido.' }, 400);
    }
    const document = await core.getFalabellaWebManifestDocument({ companyId, manifestId });
    c.header('Cache-Control', 'private, no-store');
    return ok(c, document);
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.post('/falabella/manifests/documents', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const selection = normalizeFalabellaManifestDocumentRequests(body?.manifests);
    if (!selection.ok || !selection.manifests.length) {
      return c.json({ error: selection.error || 'No hay manifiestos válidos para imprimir.' }, 400);
    }
    const result = await core.getFalabellaWebManifestDocuments(selection.manifests);
    const combined = await combineFalabellaManifestPdfDocuments(
      result.documents,
      `manifiestos-falabella-${new Date().toISOString().slice(0, 10)}.pdf`,
    );
    c.header('Cache-Control', 'private, no-store');
    return ok(c, {
      requested: result.requested,
      downloaded: result.downloaded,
      companies: result.companies,
      documents: result.documents.map((document) => ({
        companyId: document.companyId,
        companyName: document.companyName,
        manifestIds: document.manifestIds,
        manifestCodes: document.manifestCodes,
      })),
      ...combined,
    });
  } catch (e) {
    return fail(c, e, 400);
  }
});
app.post('/falabella/:companyId/build-boleta-venta', async (c) => {
  try { const { order } = await c.req.json(); return ok(c, await core.falabellaBuildBoletaVenta({ companyId: Number(c.req.param('companyId')), order })); }
  catch (e) { return fail(c, e); }
});
app.post('/falabella/:companyId/build-factura-venta', async (c) => {
  try { const { order } = await c.req.json(); return ok(c, await core.falabellaBuildFacturaVenta({ companyId: Number(c.req.param('companyId')), order })); }
  catch (e) { return fail(c, e); }
});
app.post('/falabella/:companyId/resolve-order-ids', async (c) => {
  try { const { entries } = await c.req.json(); return ok(c, await core.falabellaResolveOrderIds({ companyId: Number(c.req.param('companyId')), entries })); }
  catch (e) { return fail(c, e); }
});
app.get('/falabella/:companyId/resolve-document', async (c) => {
  try { return ok(c, await core.falabellaResolveDocument({ companyId: Number(c.req.param('companyId')), orderNumber: c.req.query('orderNumber') || '' })); }
  catch (e) { return fail(c, e); }
});
app.get('/falabella/:companyId/month-summary', async (c) => {
  try { return ok(c, await core.falabellaMonthSummary({ companyId: Number(c.req.param('companyId')), month: c.req.query('month') || '' })); }
  catch (e) { return fail(c, e); }
});
app.post('/falabella/upload-invoice-pdf', async (c) => { try { return ok(c, await core.falabellaUploadInvoicePdf(await c.req.json())); } catch (e) { return fail(c, e); } });
app.post('/falabella/upload-boleta-pdf', async (c) => { try { return ok(c, await core.falabellaUploadBoletaPdf(await c.req.json())); } catch (e) { return fail(c, e); } });

// ── Workflow (emisión en lote) ──
app.post('/workflow/validate-config', async (c) => { try { return ok(c, { errors: core.validateConfig(await c.req.json()) }); } catch (e) { return fail(c, e, 400); } });
app.post('/workflow/validate-ventas', async (c) => { try { return ok(c, { errors: core.validateVentas(await c.req.json()) }); } catch (e) { return fail(c, e, 400); } });
// Streaming NDJSON: cada línea es un evento {type:'progress'|'result'|'error'}.
// El front (apiHttp) lee el stream y dispara onProgress con cada 'progress'.
app.post('/workflow/process', async (c) => {
  const { config: rawCfg, ventas } = await c.req.json();
  // Solo datos operativos del cliente. Secretos (cert/SOL) se cargan por companyId en el servidor.
  // El modo SUNAT lo define el ambiente (SUNAT_FORCE_ENV), no el cliente ni la empresa.
  const cfg = {
    companyId: rawCfg?.companyId,
    branchId: rawCfg?.branchId,
    branchCodigo: rawCfg?.branchCodigo,
    serieBoleta: rawCfg?.serieBoleta,
    outputDir: rawCfg?.outputDir || 'storage',
  };
  console.log('[WORKFLOW] companyId=%s ventas=%s sunatEnv=%s',
    cfg?.companyId, Array.isArray(ventas) ? ventas.length : '?', process.env.SUNAT_FORCE_ENV || '(auto)');
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('X-Accel-Buffering', 'no'); // evita buffering de proxies (Railway/nginx)
  return stream(c, async (s) => {
    const write = (obj) => s.write(JSON.stringify(obj) + '\n');
    const onProgress = (current, total, status) => {
      try { write({ type: 'progress', current, total, status }); } catch {}
    };
    try {
      const result = await core.processWorkflow(cfg, ventas, onProgress);
      console.log('[WORKFLOW RESULT]', JSON.stringify({ success: result?.success, error: result?.error, exitosas: result?.exitosas, rechazadas: result?.rechazadas, boletas: (result?.boletas || []).map((b) => ({ estado: b.estadoSunat, msg: b.mensajeSunat || b.error })) }).slice(0, 800));
      await write({ type: 'result', result });
    } catch (e) {
      console.error('[API ERROR] POST /workflow/process →', (e && e.stack) || e);
      await write({ type: 'error', error: String((e && e.message) || e) });
    }
  });
});

// ── Emisión automática: panel de control (config + logs) ──
app.get('/auto-emit/config', async (c) => {
  try { return ok(c, await autoEmit.getConfig()); }
  catch (e) { return fail(c, e); }
});
app.post('/auto-emit/config/:companyId', async (c) => {
  try { const { enabled } = await c.req.json(); return ok(c, await autoEmit.setCompanyEnabled(Number(c.req.param('companyId')), enabled)); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/auto-emit/pause', async (c) => { try { const { paused } = await c.req.json(); return ok(c, await autoEmit.setPaused(paused)); } catch (e) { return fail(c, e, 400); } });
app.post('/auto-emit/cron', async (c) => { try { return ok(c, await autoEmit.setCron(await c.req.json())); } catch (e) { return fail(c, e, 400); } });
app.post('/auto-emit/alert-emails', async (c) => {
  try {
    const body = await c.req.json();
    return ok(c, await autoEmit.setAlertEmails(body.emails ?? body.alertEmails ?? ''));
  } catch (e) { return fail(c, e, 400); }
});
app.post('/auto-emit/dry-run', async (c) => { try { const { dryRun } = await c.req.json(); return ok(c, await autoEmit.setDryRun(dryRun)); } catch (e) { return fail(c, e, 400); } });
app.post('/auto-emit/jobs/:id/retry', async (c) => { try { return ok(c, await autoEmit.retryJob(Number(c.req.param('id')))); } catch (e) { return fail(c, e, 400); } });
app.get('/auto-emit/jobs/:id/order-preview', async (c) => { try { return ok(c, await autoEmit.jobOrderPreview(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.get('/auto-emit/jobs', async (c) => { try { return ok(c, await autoEmit.recentJobs(Number(c.req.query('limit') || 50))); } catch (e) { return fail(c, e); } });
app.get('/auto-emit/events', async (c) => { try { return ok(c, await autoEmit.recentEvents(Number(c.req.query('limit') || 50))); } catch (e) { return fail(c, e); } });
app.post('/auto-emit/run', async (c) => { try { const n = await autoEmit.processQueue(Number(c.req.query('limit') || 5)); return ok(c, { processed: n }); } catch (e) { return fail(c, e); } });
app.get('/auto-emit/webhooks/:companyId', async (c) => {
  try {
    const companyId = Number(c.req.param('companyId'));
    const ids = (c.req.query('ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
    const data = await core.falabellaGetWebhooks({ companyId, webhookIds: ids });
    // Nunca devolver la URL completa con token al browser (Falabella la devuelve en CallbackUrl).
    if (Array.isArray(data?.webhooks)) {
      data.webhooks = data.webhooks.map((w) => ({
        ...w,
        callbackUrl: autoEmit.redactWebhookUrl(w.callbackUrl),
        raw: undefined,
      }));
    }
    const meta = await autoEmit.getCompanyWebhookMeta(companyId);
    return ok(c, { ...data, ...meta });
  } catch (e) { return fail(c, e); }
});
// Genera (si falta) o rota el secret de webhook de UNA empresa. No devuelve el valor en claro.
app.post('/auto-emit/webhooks/:companyId/rotate-secret', async (c) => {
  try {
    const companyId = Number(c.req.param('companyId'));
    return ok(c, await autoEmit.rotateCompanyWebhookSecret(companyId));
  } catch (e) { return fail(c, e, 400); }
});
app.post('/auto-emit/webhooks/:companyId', async (c) => {
  try {
    const companyId = Number(c.req.param('companyId'));
    const body = await c.req.json().catch(() => ({}));
    const events = body?.events;
    // Ignorar callbackUrl del cliente (DR-006): solo URL interna con secret por empresa.
    const secret = await autoEmit.ensureCompanyWebhookSecret(companyId);
    const targetUrl = autoEmit.buildWebhookCallbackUrl(companyId, secret);
    const result = await core.falabellaCreateWebhook({ companyId, callbackUrl: targetUrl, events });
    // No filtrar el secret en la respuesta al browser.
    return ok(c, {
      ...result,
      callbackUrl: autoEmit.redactWebhookUrl(targetUrl),
      hasWebhookSecret: true,
    });
  } catch (e) { return fail(c, e, 400); }
});
app.delete('/auto-emit/webhooks/:companyId/:webhookId', async (c) => {
  try { return ok(c, await core.falabellaDeleteWebhook({ companyId: Number(c.req.param('companyId')), webhookId: c.req.param('webhookId') })); }
  catch (e) { return fail(c, e, 400); }
});

const serveWeb = process.env.SERVE_WEB === 'true';

// ── Front web estático (opt-in) ──
// En desarrollo el front corre separado con Vite (3011) y usa proxy al API (3010).
// Para un deploy monolítico se puede activar SERVE_WEB=true.
if (serveWeb) {
  const { serveStatic } = await import('@hono/node-server/serve-static');
  const WEB_ROOT = process.env.WEB_ROOT || './packages/web/dist';
  app.use('/assets/*', serveStatic({ root: WEB_ROOT }));
  app.get('*', serveStatic({ root: WEB_ROOT }));
  app.get('*', serveStatic({ path: `${WEB_ROOT}/index.html` }));
}

const recoveredManifestJobs = await manifestJobs.recoverStaleFalabellaManifestJobs(
  FALABELLA_MANIFEST_JOB_STALE_MS,
  core.pool,
).catch((error) => {
  console.error('[FALABELLA MANIFEST JOB RECOVERY]', error?.stack || error);
  return [];
});
if (recoveredManifestJobs.length) {
  console.warn(`[FALABELLA MANIFEST JOB RECOVERY] ${recoveredManifestJobs.length} trabajo(s) recuperado(s).`);
}
scheduleFalabellaManifestJobs();
const falabellaManifestJobPoll = setInterval(scheduleFalabellaManifestJobs, 3_000);
falabellaManifestJobPoll.unref?.();
const falabellaManifestJobRecoveryPoll = setInterval(() => {
  manifestJobs.recoverStaleFalabellaManifestJobs(FALABELLA_MANIFEST_JOB_STALE_MS, core.pool)
    .then((jobs) => {
      if (jobs.length) scheduleFalabellaManifestJobs();
    })
    .catch((error) => console.error('[FALABELLA MANIFEST JOB RECOVERY]', error?.stack || error));
}, 60_000);
falabellaManifestJobRecoveryPoll.unref?.();

const port = Number(process.env.PORT || 3010);
serve({ fetch: app.fetch, port }, (info) => {
  const sunatForced = String(process.env.SUNAT_FORCE_ENV || '').trim().toLowerCase();
  const sunatEnv = sunatForced.startsWith('prod')
    ? 'PRODUCCIÓN (real)'
    : sunatForced === 'beta'
      ? 'BETA (pruebas)'
      : (process.env.RAILWAY_PUBLIC_DOMAIN || process.env.NODE_ENV === 'production')
        ? 'PRODUCCIÓN (auto)'
        : 'BETA (auto)';
  console.log(`ZentoFact en http://localhost:${info.port} (${serveWeb ? 'API + front estático' : 'solo API'})`);
  console.log(`[SUNAT] Ambiente de emisión: ${sunatEnv}  (SUNAT_FORCE_ENV=${process.env.SUNAT_FORCE_ENV || '(no seteado)'})`);
  autoEmit.startAutoEmission();
  falabellaSync.startFalabellaSyncScheduler();
  orderSync.startOrderSyncScheduler();
  stockJobs.startStockReconciliationCron();
  stockJobs.startStockJobWorker();
});
