import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { assertScope, authenticateApiKey } from './auth.js';
import { runIdempotent } from './idempotency.js';
import { ProblemError, problemResponse, validationProblem } from './problems.js';
import { buildPolicy } from './settings.js';
import {
  cancelStoreOrder,
  getStoreOrderResource,
  parseDocumentKey,
  upsertStoreOrder,
} from './store-orders.js';

export const BODY_LIMIT_BYTES = 256 * 1024;

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json; charset=utf-8' : 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function readJson(c) {
  const raw = await c.req.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw validationProblem([{ path: '', message: 'El cuerpo no es JSON válido.' }]);
  }
}

// ── Inventario por SKU principal ──

function encodeCursor(id) {
  return Buffer.from(String(id)).toString('base64url');
}

function decodeCursor(value) {
  if (!value) return 0;
  const id = Number(Buffer.from(String(value), 'base64url').toString('utf8'));
  if (!Number.isInteger(id) || id < 0) throw validationProblem([{ path: 'cursor', message: 'cursor inválido.' }]);
  return id;
}

export async function listInventory(db, query = {}) {
  const limitRaw = query.limit == null || query.limit === '' ? 200 : Number(query.limit);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 500) {
    throw validationProblem([{ path: 'limit', message: 'limit debe estar entre 1 y 500.' }]);
  }
  const skus = String(query.sku || '').split(',').map((sku) => sku.trim()).filter(Boolean);
  if (skus.length > 500) throw validationProblem([{ path: 'sku', message: 'Máximo 500 SKU por consulta.' }]);
  const after = decodeCursor(query.cursor);
  const values = [after, limitRaw + 1];
  let skuFilter = '';
  if (skus.length) {
    values.push(skus);
    skuFilter = `and p.main_sku = any($${values.length}::text[])`;
  }
  const rows = (await db.query(
    `select p.id, p.main_sku,
       coalesce(i.quantity_on_hand, 0) - coalesce(i.quantity_reserved, 0)
         - coalesce(i.quantity_pending_return, 0) as available,
       greatest(coalesce(i.updated_at, p.updated_at), p.updated_at) as updated_at
     from products p left join product_inventory i on i.product_id=p.id
     where p.status <> 'archived' and nullif(trim(p.main_sku), '') is not null
       and p.id > $1 ${skuFilter}
     order by p.id
     limit $2`,
    values,
  )).rows;
  const page = rows.slice(0, limitRaw);
  return {
    items: page.map((row) => ({
      sku: row.main_sku,
      available: Number(row.available),
      updatedAt: new Date(row.updated_at).toISOString(),
    })),
    nextCursor: rows.length > limitRaw ? encodeCursor(page[page.length - 1].id) : null,
  };
}

// ── PDF de un comprobante del pedido de la cuenta ──

const PDF_LINK_COLUMN = { boleta: 'boleta_id', factura: 'factura_id', credit_note: 'credit_note_id' };
const DOC_TABLE = { boleta: 'boletas', factura: 'facturas', credit_note: 'credit_notes' };

export async function documentPdf(db, account, documentId, core) {
  const parsed = parseDocumentKey(documentId);
  if (!parsed) throw new ProblemError('not_found', 'Comprobante no encontrado.');
  const owned = (await db.query(
    `select d.estado_sunat, d.numero_completo
     from order_documents od
     join orders o on o.id=od.order_id
     join ${DOC_TABLE[parsed.kind]} d on d.id=od.${PDF_LINK_COLUMN[parsed.kind]}
     where o.channel_account_id=$1 and od.${PDF_LINK_COLUMN[parsed.kind]}=$2
     limit 1`,
    [account.id, parsed.id],
  )).rows[0];
  if (!owned) throw new ProblemError('not_found', 'Comprobante no encontrado.');
  if (String(owned.estado_sunat).toUpperCase() !== 'ACEPTADO') {
    throw new ProblemError('document_not_accepted', 'El PDF está disponible cuando SUNAT acepta el comprobante.');
  }
  const base64 = parsed.kind === 'boleta'
    ? await core.generateAcceptedBoletaPdfBase64(parsed.id)
    : parsed.kind === 'factura'
      ? await core.generateAcceptedFacturaPdfBase64(parsed.id)
      : await core.generateAcceptedCreditNotePdfBase64(parsed.id);
  return { buffer: Buffer.from(base64, 'base64'), filename: `${owned.numero_completo}.pdf` };
}

/**
 * Sub-app Hono montada en /api/v1. No depende de la sesión de la web: se
 * monta fuera de PROTECTED_PATHS y autentica cada request con la llave Bearer.
 */
export function createIntegrationApp(deps = {}) {
  const app = new Hono();
  const getDb = async () => deps.db || (await loadCore()).pool;
  const getCore = async () => deps.core || await loadCore();
  const afterChange = deps.afterChange || (() => {});

  app.use('*', bodyLimit({
    maxSize: BODY_LIMIT_BYTES,
    onError: (c) => problemResponse(c, 'payload_too_large', 'El cuerpo supera 256 KB.'),
  }));

  app.use('*', async (c, next) => {
    const db = await getDb();
    const auth = await authenticateApiKey(db, c.req.header('authorization'), { env: deps.env || process.env });
    c.set('integration', auth);
    return next();
  });

  const guard = (scope, handler) => async (c) => {
    const auth = c.get('integration');
    assertScope(auth.scopes, scope);
    return handler(c, auth, await getDb());
  };

  app.get('/policy', guard('policy:read', (c, { account }) => json(buildPolicy(account))));

  app.put('/orders/:externalId', guard('orders:write', async (c, { account }, db) => {
    const body = await readJson(c);
    const result = await upsertStoreOrder(account, c.req.param('externalId'), body, db);
    afterChange({ type: 'order.upserted', accountId: account.id, externalId: result.order.externalId });
    return json(result.order, result.created ? 201 : 200);
  }));

  app.post('/orders/:externalId/cancel', guard('orders:write', async (c, { account }, db) => {
    const body = await readJson(c);
    const externalId = c.req.param('externalId');
    const result = await runIdempotent(db, {
      accountId: account.id,
      key: c.req.header('idempotency-key'),
      request: { externalId, body },
    }, async () => ({ status: 200, body: await cancelStoreOrder(account, externalId, body, db) }));
    if (!result.replayed) afterChange({ type: 'order.cancelled', accountId: account.id, externalId });
    return json(result.body, result.status);
  }));

  app.get('/orders/:externalId', guard('orders:read', async (c, { account }, db) => (
    json(await getStoreOrderResource(account, c.req.param('externalId'), db))
  )));

  app.get('/documents/:documentId/pdf', guard('documents:read', async (c, { account }, db) => {
    const { buffer, filename } = await documentPdf(db, account, c.req.param('documentId'), await getCore());
    return new Response(buffer, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '')}"`,
        'cache-control': 'no-store',
      },
    });
  }));

  app.get('/inventory', guard('inventory:read', async (c, _auth, db) => json(await listInventory(db, c.req.query()))));

  app.all('*', () => {
    throw new ProblemError('not_found', 'Ruta no encontrada.');
  });

  app.onError((error, c) => {
    if (error instanceof ProblemError) return problemResponse(c, error.code, error.detail, error.extra);
    console.error('[integracion:api]', c.req.method, c.req.path, error?.stack || error);
    return problemResponse(c, 'internal', 'Error interno. Reintenta.');
  });

  return app;
}
