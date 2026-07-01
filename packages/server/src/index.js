// ZENTOFACTO API — capa HTTP delgada que expone @boletas/core.
// El core no sabe que lo llama HTTP; aquí solo mapeamos rutas -> funciones del core.
// Omitido en web (queda en desktop): paths/FS, diálogos nativos, scraper Falabella.
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Carga el .env de la raíz ANTES de importar el core (core/db lee la conexión al importarse).
config({ path: resolve(__dirname, '../../../.env') });

const { serve } = await import('@hono/node-server');
const { Hono } = await import('hono');
const { cors } = await import('hono/cors');
const core = await import('@boletas/core');
const { auth, requireAuth } = await import('./auth.js');

const app = new Hono();
// CORS con credenciales (cookies de sesión) para el front web.
app.use('*', cors({ origin: (process.env.WEB_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',').map((s) => s.trim()), credentials: true }));

// Better Auth: /api/auth/* (login, logout, sesión). Público (antes del guard).
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
// Guard: de aquí en adelante todo exige sesión, salvo /health.
app.use('*', requireAuth(['/health']));

const ok = (c, data, status = 200) => c.json(data, status);
const fail = (c, e, status = 500) => c.json({ error: String((e && e.message) || e) }, status);

app.get('/health', (c) => ok(c, { ok: true, service: 'zentofacto-api', ts: new Date().toISOString() }));

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
app.get('/credit-notes', async (c) => { try { return ok(c, await core.listCreditNotes(parseFilter(c))); } catch (e) { return fail(c, e); } });
app.get('/daily-summaries', async (c) => { try { return ok(c, await core.listDailySummaries(parseFilter(c))); } catch (e) { return fail(c, e); } });
app.post('/daily-summaries/:id/refresh', async (c) => { try { return ok(c, await core.refreshDailySummaryStatus(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });

// ── Correlativos ──
app.get('/branches/:id/correlatives', async (c) => { try { return ok(c, await core.getCorrelatives(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });

// ── PDFs (en memoria, base64 — sin disco) ──
app.get('/boletas/:id/pdf', async (c) => {
  try { const b64 = await core.generateAcceptedBoletaPdfBase64(Number(c.req.param('id'))); return ok(c, { base64: b64 }); }
  catch (e) { return fail(c, e); }
});
app.get('/boletas/:id/preview', async (c) => { try { return c.html(await core.generateAcceptedBoletaPreviewHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.get('/credit-notes/:id/preview', async (c) => { try { return c.html(await core.generatePreviewCreditNoteHtml(Number(c.req.param('id')))); } catch (e) { return fail(c, e); } });
app.post('/boletas/preview', async (c) => {
  try { const { companyId, venta } = await c.req.json(); return c.html(await core.generatePreviewBoletaHtmlForVenta(companyId, venta)); }
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
app.post('/workflow/process', async (c) => {
  try { const { config: cfg, ventas } = await c.req.json(); return ok(c, await core.processWorkflow(cfg, ventas)); }
  catch (e) { return fail(c, e, 400); }
});

const port = Number(process.env.PORT || 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`ZENTOFACTO API escuchando en http://localhost:${info.port}`);
});
