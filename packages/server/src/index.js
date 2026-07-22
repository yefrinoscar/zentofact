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
const { auth, requireAuth, requireCsrf, requirePermission, requireAnyPermission, csrfTokenForSession } = await import('./auth.js');
const users = await import('./users.js');
const { PERMISSIONS, ROLE_PRESETS } = await import('./permissions.js');
await users.ensureUserColumns();
const autoEmit = await import('./auto-emission.js');
await autoEmit.ensureTables();
const falabellaSync = await import('./falabella-sync.js');
const ordersInbox = await import('./orders-inbox.js');
const dashboard = await import('./dashboard.js');
const shippingLabelSheet = await import('./shipping-label-sheet.js');

const app = new Hono();

// CORS con credenciales (cookies de sesión) para el front web.
const railwayOrigin = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '';
const webOrigins = Array.from(new Set([
  ...(process.env.WEB_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  railwayOrigin,
  'http://localhost:3011',
  'http://127.0.0.1:3011',
  'http://localhost:3000',
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
  ['/orders-inbox', 'falabella'],
  ['/facturas', 'documentos'],
  ['/documentos', 'documentos'],
  ['/falabella', 'falabella'],
  ['/workflow', 'falabella'],
  ['/auto-emit', 'auto_emision'],
];
for (const [prefix, perm] of moduleGuards) {
  const permissionGuard = requirePermission(perm);
  const readOnlyPostGuard = requirePermission(perm, { readOnly: true });
  const guard = (c, next) => (
    c.req.path === '/falabella/shipping-labels/a4'
      ? readOnlyPostGuard(c, next)
      : permissionGuard(c, next)
  );
  app.use(prefix, guard);
  app.use(`${prefix}/*`, guard);
}

const requireDocumentsOrCreditNotes = requireAnyPermission(['documentos', 'credit_notes']);

const ok = (c, data, status = 200) => c.json(data, status);
const fail = (c, e, status = 500) => {
  console.error('[API ERROR]', c.req.method, c.req.path, '→', (e && e.stack) || e);
  return c.json({ error: String((e && e.message) || e) }, status);
};

function canPrintFalabellaShippingLabel(status) {
  const value = String(status || '').toLowerCase();
  return /(^|\|)ready_to_ship(\||$)/.test(value)
    && !/(^|\|)(pending|shipped)(\||$)/.test(value);
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
    c.header('Cache-Control', 'private, max-age=60, stale-while-revalidate=240');
    return ok(c, data);
  } catch (e) { return fail(c, e, 400); }
});
app.post('/dashboard/refresh', async (c) => {
  try {
    const refresh = await dashboard.refreshDashboard();
    return ok(c, refresh);
  } catch (e) { return fail(c, e); }
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
    const result = await ordersInbox.syncAllOrdersInbox();
    dashboard.clearDashboardResponseCache();
    return ok(c, result);
  }
  catch (e) { return fail(c, e, 400); }
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
app.get('/companies/:id/branches', requireAnyPermission(['documentos', 'companies']), async (c) => { try { return ok(c, await core.listBranches(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
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
app.get('/boletas', requireDocumentsOrCreditNotes, async (c) => { try { return ok(c, await core.listBoletas(parseFilter(c))); } catch (e) { return fail(c, e); } });
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
app.get('/documentos/stats', documentStatsHandler);
app.get('/boletas/stats', requirePermission('documentos'), documentStatsHandler);
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
app.post('/boletas', requirePermission('documentos'), async (c) => {
  try { const { input } = await c.req.json(); return ok(c, await core.createBoleta(input), 201); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/boletas/:id/send', requirePermission('documentos'), async (c) => {
  try { return ok(c, await core.sendBoletaToSunat(Number(c.req.param('id')))); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/boletas/:id/reemit', requirePermission('documentos'), async (c) => {
  try { return ok(c, await core.reEmitBoleta(Number(c.req.param('id')))); }
  catch (e) { return fail(c, e, 400); }
});
app.get('/facturas/:id/pdf', async (c) => {
  try { const b64 = await core.generateAcceptedFacturaPdfBase64(Number(c.req.param('id'))); return ok(c, { base64: b64 }); }
  catch (e) { return fail(c, e); }
});
app.get('/facturas/:id/preview', async (c) => { try { return ok(c, await core.generateAcceptedFacturaPreviewHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/facturas/preview', async (c) => {
  try { const { companyId, venta } = await c.req.json(); return ok(c, await core.generatePreviewFacturaHtmlForVenta(companyId, venta)); }
  catch (e) { return fail(c, e); }
});
app.get('/credit-notes', requireDocumentsOrCreditNotes, async (c) => { try { return ok(c, await core.listCreditNotes(parseFilter(c))); } catch (e) { return fail(c, e); } });
app.post('/boletas/:id/refresh-status', requirePermission('documentos'), async (c) => { try { return ok(c, await core.refreshBoletaStatus(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/facturas/:id/refresh-status', async (c) => { try { return ok(c, await core.refreshFacturaStatus(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });

// ── Correlativos ──
app.get('/branches/:id/correlatives', requireAnyPermission(['documentos', 'companies']), async (c) => { try { return ok(c, await core.getCorrelatives(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });

// ── PDFs (en memoria, base64 — sin disco) ──
app.get('/boletas/:id/pdf', requirePermission('documentos'), async (c) => {
  try { const b64 = await core.generateAcceptedBoletaPdfBase64(Number(c.req.param('id'))); return ok(c, { base64: b64 }); }
  catch (e) { return fail(c, e); }
});
// Los generadores del core devuelven un objeto { html, numeroCompleto, ... } → JSON, no c.html.
app.get('/boletas/:id/preview', requirePermission('documentos'), async (c) => { try { return ok(c, await core.generateAcceptedBoletaPreviewHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.get('/credit-notes/:id/preview', requireDocumentsOrCreditNotes, async (c) => { try { return ok(c, await core.generatePreviewCreditNoteHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/boletas/preview', requirePermission('documentos'), async (c) => {
  try { const { companyId, venta } = await c.req.json(); return ok(c, await core.generatePreviewBoletaHtmlForVenta(companyId, venta)); }
  catch (e) { return fail(c, e); }
});

// ── Notas de crédito (emitir) ──
app.post('/credit-notes', requirePermission('credit_notes'), async (c) => {
  try { const { boletaId, options } = await c.req.json(); return ok(c, await core.createAndSendCreditNoteFromBoleta(boletaId, options), 201); }
  catch (e) {
    const message = String((e && e.message) || e);
    return fail(c, e, /ya tiene nota de crédito|unique/i.test(message) ? 409 : 400);
  }
});
app.post('/credit-notes/batch', requirePermission('credit_notes'), async (c) => {
  try { const { boletaIds, options } = await c.req.json(); return ok(c, await core.createAndSendCreditNotesFromBoletas(boletaIds, options), 201); }
  catch (e) { return fail(c, e, 400); }
});

// ── Falabella (lógica compartida en core) ──
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
  try { const product = await c.req.json(); return ok(c, await core.falabellaCreateProduct({ companyId: Number(c.req.param('companyId')), product })); }
  catch (e) { return fail(c, e, 400); }
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
  const db = await core.pool.connect();
  try {
    const companyId = Number(c.req.param('companyId'));
    const orderId = c.req.param('orderId');
    await db.query('begin');
    await db.query('select pg_advisory_xact_lock($1,$2)', [0x46414c41, companyId]);
    const current = (await db.query(
      'select status from falabella_orders where company_id=$1 and order_id=$2 for update',
      [companyId, orderId],
    )).rows[0];
    if (/(^|\|)(shipped|delivered)(\||$)/i.test(String(current?.status || ''))) {
      await db.query('rollback');
      return c.json({ error: 'El pedido ya fue enviado a Falabella. Sincroniza la bandeja para ver su estado actual.' }, 409);
    }
    const result = await core.falabellaSetStatusToReadyToShip({ companyId, orderId });
    if (result?.error) {
      await db.query('rollback');
      const providerStatus = Number(result.status || 0);
      const status = providerStatus === 401 || providerStatus === 429 || providerStatus >= 500 ? 502 : providerStatus >= 400 ? providerStatus : 400;
      return c.json({ error: result.error }, status);
    }
    await db.query(
      `update falabella_orders
       set status='ready_to_ship',
           raw_data=jsonb_set(coalesce(raw_data, '{}'::jsonb), '{Statuses}', to_jsonb('ready_to_ship'::text), true),
           last_seen_at=now(), synchronized_at=now()
       where company_id=$1 and order_id=$2`,
      [companyId, orderId],
    );
    await db.query(
      `insert into falabella_order_lifecycle (
         company_id, order_id, order_number, current_status, pending_at,
         ready_to_ship_at, last_provider_update_at, first_observed_at, last_observed_at
       )
       select company_id, order_id, order_number, 'ready_to_ship',
         coalesce(falabella_created_at, first_seen_at),
         case when $3::boolean then null else now() end,
         case when $3::boolean then falabella_updated_at else now() end,
         first_seen_at, now()
       from falabella_orders where company_id=$1 and order_id=$2
       on conflict (company_id, order_id) do update set
         current_status='ready_to_ship',
         pending_at=coalesce(falabella_order_lifecycle.pending_at, excluded.pending_at),
         ready_to_ship_at=coalesce(falabella_order_lifecycle.ready_to_ship_at, excluded.ready_to_ship_at),
         last_provider_update_at=excluded.last_provider_update_at,
         last_observed_at=now()`,
      [companyId, orderId, Boolean(result.alreadyReady)],
    );
    await db.query('commit');
    dashboard.clearDashboardResponseCache();
    return ok(c, result);
  } catch (e) {
    await db.query('rollback').catch(() => {});
    return fail(c, e);
  } finally {
    db.release();
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
    if (!order || !canPrintFalabellaShippingLabel(order.status)) {
      return c.json({ error: 'Solo se pueden imprimir etiquetas de pedidos listos para enviar.' }, 409);
    }
    const result = await core.falabellaGetShippingLabel({ companyId, orderId });
    if (result?.error) {
      const providerStatus = Number(result.status || 0);
      const status = providerStatus === 401 || providerStatus === 429 || providerStatus >= 500 ? 502 : providerStatus >= 400 ? providerStatus : 400;
      return c.json({ error: result.error }, status);
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
      `select company_id, order_id, status
       from falabella_orders
       where (company_id, order_id) in (${tuples.join(',')})`,
      params,
    );
    const printableByOrder = new Map(printable.rows.map((order) => [
      `${order.company_id}:${order.order_id}`,
      canPrintFalabellaShippingLabel(order.status),
    ]));
    const invalidOrder = orders.find((order) => !printableByOrder.get(`${Number(order.companyId)}:${String(order.orderId).trim()}`));
    if (invalidOrder) {
      return c.json({ error: `La orden ${invalidOrder.orderNumber || invalidOrder.orderId} ya fue enviada o todavía no está lista para imprimir.` }, 409);
    }
    const result = await shippingLabelSheet.buildA4ShippingLabelSheet(
      orders,
      ({ companyId, orderId }) => core.falabellaGetShippingLabel({ companyId, orderId }),
    );
    c.header('Cache-Control', 'private, no-store');
    return ok(c, result);
  } catch (e) {
    const providerStatus = Number(e?.providerStatus || 0);
    const status = providerStatus === 401 || providerStatus === 429 || providerStatus >= 500 ? 502 : 400;
    return fail(c, e, status);
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
});
