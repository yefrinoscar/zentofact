// ZentoFact API — capa HTTP delgada que expone @zentofact/core.
// El core no sabe que lo llama HTTP; aquí solo mapeamos rutas -> funciones del core.
// Omitido en web (queda en desktop): paths/FS, diálogos nativos, scraper Falabella.
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
const { auth, requireAuth } = await import('./auth.js');
const autoEmit = await import('./auto-emission.js');
await autoEmit.ensureTables();

const app = new Hono();

function resolveSunatProductionMode(fallback) {
  const forced = String(process.env.SUNAT_FORCE_ENV || process.env.VITE_SUNAT_ENV || '').trim().toLowerCase();
  if (forced.startsWith('prod')) return true;
  if (['beta', 'dev', 'development', 'local'].includes(forced)) return false;
  return fallback;
}

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

// Webhook de Falabella (onOrderItemsStatusChanged). Público: lo llama Falabella, no lleva cookie.
// Se protege con secreto compartido (?secret= o header x-webhook-secret) contra AUTO_EMIT_WEBHOOK_SECRET.
app.on(['POST', 'GET'], '/webhooks/falabella/:companyId', async (c) => {
  const expected = process.env.AUTO_EMIT_WEBHOOK_SECRET || '';
  const given = c.req.query('secret') || c.req.header('x-webhook-secret') || '';
  if (expected && given !== expected) return c.json({ error: 'unauthorized' }, 401);
  const companyId = Number(c.req.param('companyId'));
  let payload = {};
  try { payload = c.req.method === 'POST' ? await c.req.json() : c.req.query(); } catch {}
  try {
    const r = await autoEmit.handleWebhook(companyId, payload);
    return c.json({ ok: true, ...r });
  } catch (e) {
    console.error('[WEBHOOK ERROR]', (e && e.stack) || e);
    // 200 igual para que Falabella no reintente en bucle por errores nuestros; ya quedó en webhook_events.
    return c.json({ ok: false, error: String((e && e.message) || e) }, 200);
  }
});
// Guard: exige sesión solo en las rutas protegidas del API (login/estáticos quedan públicos).
app.use('*', requireAuth());

const ok = (c, data, status = 200) => c.json(data, status);
const fail = (c, e, status = 500) => {
  console.error('[API ERROR]', c.req.method, c.req.path, '→', (e && e.stack) || e);
  return c.json({ error: String((e && e.message) || e) }, status);
};

app.get('/health', (c) => ok(c, { ok: true, service: 'zentofact-api', ts: new Date().toISOString() }));

// ── Empresas ──
app.get('/companies', async (c) => { try { return ok(c, await core.listCompanies()); } catch (e) { return fail(c, e); } });
app.get('/companies/:id', async (c) => { try { return ok(c, await core.getCompany(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/companies', async (c) => { try { return ok(c, await core.createCompany(await c.req.json()), 201); } catch (e) { return fail(c, e, 400); } });
app.patch('/companies/:id', async (c) => { try { return ok(c, await core.updateCompany(Number(c.req.param('id')), await c.req.json())); } catch (e) { return fail(c, e, 400); } });
app.delete('/companies/:id', async (c) => { try { return ok(c, await core.deleteCompany(Number(c.req.param('id')))); } catch (e) { return fail(c, e, 400); } });
app.post('/companies/:id/test-sunat', async (c) => {
  try { const { environment } = await c.req.json(); return ok(c, await core.testSunatConnection(Number(c.req.param('id')), environment)); }
  catch (e) { return fail(c, e); }
});

// ── Sucursales ──
app.get('/companies/:id/branches', async (c) => { try { return ok(c, await core.listBranches(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/branches', async (c) => { try { return ok(c, await core.createBranch(await c.req.json()), 201); } catch (e) { return fail(c, e, 400); } });
app.patch('/branches/:id', async (c) => { try { return ok(c, await core.updateBranch(Number(c.req.param('id')), await c.req.json())); } catch (e) { return fail(c, e, 400); } });

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
app.post('/facturas', async (c) => {
  try { const { input } = await c.req.json(); return ok(c, await core.createFactura(input), 201); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/facturas/:id/send', async (c) => {
  try { return ok(c, await core.sendFacturaToSunat(Number(c.req.param('id')))); }
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
app.get('/facturas/:id/pdf', async (c) => {
  try { const b64 = await core.generateAcceptedFacturaPdfBase64(Number(c.req.param('id'))); return ok(c, { base64: b64 }); }
  catch (e) { return fail(c, e); }
});
app.get('/facturas/:id/preview', async (c) => { try { return ok(c, await core.generateAcceptedFacturaPreviewHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/facturas/preview', async (c) => {
  try { const { companyId, venta } = await c.req.json(); return ok(c, await core.generatePreviewFacturaHtmlForVenta(companyId, venta)); }
  catch (e) { return fail(c, e); }
});
app.get('/credit-notes', async (c) => { try { return ok(c, await core.listCreditNotes(parseFilter(c))); } catch (e) { return fail(c, e); } });
app.get('/daily-summaries', async (c) => { try { return ok(c, await core.listDailySummaries(parseFilter(c))); } catch (e) { return fail(c, e); } });
app.post('/daily-summaries/:id/refresh', async (c) => { try { return ok(c, await core.refreshDailySummaryStatus(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/boletas/:id/refresh-status', async (c) => { try { return ok(c, await core.refreshBoletaStatus(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/facturas/:id/refresh-status', async (c) => { try { return ok(c, await core.refreshFacturaStatus(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });

// ── Correlativos ──
app.get('/branches/:id/correlatives', async (c) => { try { return ok(c, await core.getCorrelatives(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });

// ── PDFs (en memoria, base64 — sin disco) ──
app.get('/boletas/:id/pdf', async (c) => {
  try { const b64 = await core.generateAcceptedBoletaPdfBase64(Number(c.req.param('id'))); return ok(c, { base64: b64 }); }
  catch (e) { return fail(c, e); }
});
// Los generadores del core devuelven un objeto { html, numeroCompleto, ... } → JSON, no c.html.
app.get('/boletas/:id/preview', async (c) => { try { return ok(c, await core.generateAcceptedBoletaPreviewHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.get('/credit-notes/:id/preview', async (c) => { try { return ok(c, await core.generatePreviewCreditNoteHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/boletas/preview', async (c) => {
  try { const { companyId, venta } = await c.req.json(); return ok(c, await core.generatePreviewBoletaHtmlForVenta(companyId, venta)); }
  catch (e) { return fail(c, e); }
});

// ── Notas de crédito (emitir) ──
app.post('/credit-notes', async (c) => {
  try { const { boletaId, options } = await c.req.json(); return ok(c, await core.createAndSendCreditNoteFromBoleta(boletaId, options), 201); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/credit-notes/batch', async (c) => {
  try { const { boletaIds, options } = await c.req.json(); return ok(c, await core.createAndSendCreditNotesFromBoletas(boletaIds, options), 201); }
  catch (e) { return fail(c, e, 400); }
});

// ── Falabella (lógica compartida en core) ──
app.get('/falabella/:companyId/orders', async (c) => {
  try { const filters = JSON.parse(c.req.query('filters') || '{}'); return ok(c, await core.falabellaGetOrders({ companyId: Number(c.req.param('companyId')), filters })); }
  catch (e) { return fail(c, e); }
});
app.get('/falabella/:companyId/orders/:orderId/items', async (c) => {
  try { return ok(c, await core.falabellaGetOrderItems({ companyId: Number(c.req.param('companyId')), orderId: c.req.param('orderId') })); }
  catch (e) { return fail(c, e); }
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
  const cfg = {
    ...rawCfg,
    modoProduccion: resolveSunatProductionMode(rawCfg?.modoProduccion),
  };
  console.log('[WORKFLOW] companyId=%s ventas=%s cert=%s claveSol=%s modoProd=%s',
    cfg?.companyId, Array.isArray(ventas) ? ventas.length : '?', cfg?.certificadoBase64 ? 'sí' : 'NO', cfg?.claveSol ? 'sí' : 'NO', cfg?.modoProduccion);
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
  try {
    const cfg = await autoEmit.getConfig();
    // URL del webhook para configurar en el portal de Falabella (el secreto va en query).
    const base = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT || 3010}`;
    const secret = process.env.AUTO_EMIT_WEBHOOK_SECRET || '';
    return ok(c, { ...cfg, webhookBase: `${base}/webhooks/falabella`, webhookSecretSet: !!secret });
  } catch (e) { return fail(c, e); }
});
app.post('/auto-emit/config/:companyId', async (c) => {
  try { const { enabled } = await c.req.json(); return ok(c, await autoEmit.setCompanyEnabled(Number(c.req.param('companyId')), enabled)); }
  catch (e) { return fail(c, e, 400); }
});
app.post('/auto-emit/pause', async (c) => { try { const { paused } = await c.req.json(); return ok(c, await autoEmit.setPaused(paused)); } catch (e) { return fail(c, e, 400); } });
app.post('/auto-emit/cron', async (c) => { try { return ok(c, await autoEmit.setCron(await c.req.json())); } catch (e) { return fail(c, e, 400); } });
app.post('/auto-emit/dry-run', async (c) => { try { const { dryRun } = await c.req.json(); return ok(c, await autoEmit.setDryRun(dryRun)); } catch (e) { return fail(c, e, 400); } });
app.post('/auto-emit/jobs/:id/retry', async (c) => { try { return ok(c, await autoEmit.retryJob(Number(c.req.param('id')))); } catch (e) { return fail(c, e, 400); } });
app.get('/auto-emit/jobs', async (c) => { try { return ok(c, await autoEmit.recentJobs(Number(c.req.query('limit') || 50))); } catch (e) { return fail(c, e); } });
app.get('/auto-emit/events', async (c) => { try { return ok(c, await autoEmit.recentEvents(Number(c.req.query('limit') || 50))); } catch (e) { return fail(c, e); } });
app.post('/auto-emit/run', async (c) => { try { const n = await autoEmit.processQueue(Number(c.req.query('limit') || 5)); return ok(c, { processed: n }); } catch (e) { return fail(c, e); } });
app.get('/auto-emit/webhooks/:companyId', async (c) => {
  try {
    const ids = (c.req.query('ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
    return ok(c, await core.falabellaGetWebhooks({ companyId: Number(c.req.param('companyId')), webhookIds: ids }));
  } catch (e) { return fail(c, e); }
});
app.post('/auto-emit/webhooks/:companyId', async (c) => {
  try {
    const { events, callbackUrl } = await c.req.json();
    const base = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT || 3010}`;
    const secret = process.env.AUTO_EMIT_WEBHOOK_SECRET || '';
    const targetUrl = callbackUrl || `${base}/webhooks/falabella/${Number(c.req.param('companyId'))}${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`;
    return ok(c, await core.falabellaCreateWebhook({ companyId: Number(c.req.param('companyId')), callbackUrl: targetUrl, events }));
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
  console.log(`ZentoFact en http://localhost:${info.port} (${serveWeb ? 'API + front estático' : 'solo API'})`);
  autoEmit.startAutoEmission();
});
