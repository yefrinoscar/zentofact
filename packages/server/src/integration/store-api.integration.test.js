// Integración con PostgreSQL real: API v1 de tiendas de punta a punta.
// Ejecuta con INTEGRATION_TEST_DATABASE_URL=postgresql://... (crea y borra un schema propio).
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const baseUrl = process.env.INTEGRATION_TEST_DATABASE_URL;
const schema = `store_api_test_${process.pid}_${Date.now()}`;

function sampleOrder(overrides = {}) {
  return {
    orderNumber: 'L-DHZ2A7',
    orderedAt: '2026-11-28T15:00:00Z',
    updatedAt: '2026-11-28T15:00:05Z',
    currency: 'PEN',
    payment: { status: 'paid', paidAt: '2026-11-28T15:00:00Z', method: 'card', provider: 'mercado_pago', reference: '123' },
    customer: { name: 'Ana Pérez', email: 'ana@example.com', phone: '999999999' },
    document: null,
    fulfillment: {
      type: 'delivery',
      zone: 'provincia',
      address: { recipient: 'Ana Pérez', line1: 'Av. Sol 123', district: 'Wanchaq', department: 'cusco', phone: '988888888' },
    },
    items: [
      { id: 'ordli_1', sku: 'ABC-1', description: 'Producto X - Rojo', quantity: 2, unitPrice: 59.9, discount: 10, total: 109.8 },
      { id: 'ordli_2', sku: 'NO-EXISTE', description: 'Producto sin catálogo', quantity: 1, unitPrice: 20, total: 20 },
    ],
    shipping: { description: 'Envío Provincia', total: 15 },
    discountTotal: 10,
    total: 144.8,
    ...overrides,
  };
}

test('PostgreSQL real: API v1 de tienda (PUT, cancel, eventos, webhooks, Bandeja)', {
  skip: !baseUrl && 'define INTEGRATION_TEST_DATABASE_URL para ejecutar la integración',
  timeout: 120_000,
}, async (t) => {
  const admin = new pg.Pool({ connectionString: baseUrl, max: 2 });
  await admin.query(`create schema ${schema}`);
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL_POSTGRES = url.toString();
  process.env.INTEGRATION_ENCRYPTION_KEY = 'clave-de-prueba-para-integracion-123';
  process.env.NODE_ENV = 'test';
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  delete process.env.RAILWAY_ENVIRONMENT;

  const core = await import('@zentofact/core');
  const db = core.pool;
  try {
    await core.runMigrations(db);
    const { ensureSystemConfigTable, invalidateSystemConfigCache } = await import('../system-config.js');
    await ensureSystemConfigTable(db);
    // getOrder cruza con la tabla de usuarios de Better Auth.
    await db.query('create table if not exists "user" (id text primary key, name text, role text, commission_percent numeric)');
    await db.query(`insert into system_settings (key, value) values ('catalog_inventory', '{"enabled": true}')
      on conflict (key) do update set value='{"enabled": true}'`);
    invalidateSystemConfigCache();

    const { provisionIntegration } = await import('./provision.js');
    const { createIntegrationApp } = await import('./app.js');
    const { processDeliveries } = await import('./deliveries.js');
    const { flushInventoryChanges, reconcileIntegrationDocuments } = await import('./events.js');
    const { processCreditNoteCommand, processDocumentCommands } = await import('./document-jobs.js');
    const { markStoreOrderStep } = await import('./store-fulfillment.js');
    const { updateExternalOrderBilling } = await import('./store-orders.js');
    const { actOnOrderDocument, prepareOrderEmission } = await import('../order-documents.js');
    const { getOrder } = await import('../order-management.js');
    const { verifyWebhookSignature } = await import('./crypto.js');

    const company = (await db.query(
      `insert into companies (nombre, ruc, razon_social) values ('LIMBO', '20100070970', 'LIMBO SAC') returning id`,
    )).rows[0];
    const otherCompany = (await db.query(
      `insert into companies (nombre, ruc, razon_social) values ('OTRA', '20100070970', 'OTRA SAC') returning id`,
    )).rows[0];
    const product = (await db.query(
      `insert into products (main_sku, name) values ('ABC-1', 'Producto X') returning id`,
    )).rows[0];
    await db.query(`insert into product_inventory (product_id, quantity_on_hand) values ($1, 1)`, [product.id]);

    const provisioned = await provisionIntegration(db, {
      companyId: company.id, createAccount: true, webhookUrl: 'https://limbo.example/hooks/zentofact',
      scopes: ['orders:write', 'orders:read', 'documents:read', 'inventory:read', 'policy:read'],
    });
    assert.match(provisioned.apiKey, /^zf_test_/);
    assert.match(provisioned.webhookSecret, /^whsec_/);
    const accountId = provisioned.accountId;
    const account = (await db.query('select * from order_channel_accounts where id=$1', [accountId])).rows[0];
    assert.equal(account.settings.integration, true);
    assert.equal(account.settings.issuanceMode, 'on_request');
    assert.equal(account.document_requirement, 'optional');
    const stored = (await db.query('select secret_hash, scopes from integration_keys where channel_account_id=$1', [accountId])).rows[0];
    assert.doesNotMatch(provisioned.apiKey, new RegExp(stored.secret_hash));
    const endpoint = (await db.query('select secret_encrypted from integration_endpoints where channel_account_id=$1', [accountId])).rows[0];
    assert.doesNotMatch(endpoint.secret_encrypted, /whsec_/);

    const readOnly = await provisionIntegration(db, { accountId, scopes: ['orders:read'] });

    const app = createIntegrationApp({ db, env: { NODE_ENV: 'development' } });
    const call = (method, path, body, { key = provisioned.apiKey, headers = {} } = {}) => app.request(`/api/v1${path}`.replace('/api/v1', ''), {
      method,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });

    await t.test('auth: sin llave, scope insuficiente y env distinto', async () => {
      const noKey = await app.request('/policy');
      assert.equal(noKey.status, 401);
      assert.equal(noKey.headers.get('content-type'), 'application/problem+json; charset=utf-8');
      assert.equal((await noKey.json()).code, 'unauthorized');
      const forbidden = await call('PUT', '/orders/order_x', sampleOrder(), { key: readOnly.apiKey });
      assert.equal(forbidden.status, 403);
      assert.equal((await forbidden.json()).code, 'forbidden_scope');
      const prodApp = createIntegrationApp({ db, env: { NODE_ENV: 'production' } });
      const mismatch = await prodApp.request('/policy', { headers: { authorization: `Bearer ${provisioned.apiKey}` } });
      assert.equal(mismatch.status, 401);
      const policy = await call('GET', '/policy');
      assert.equal(policy.status, 200);
      assert.equal((await policy.json()).issuance.mode, 'on_request');
      const missing = await call('GET', '/nada');
      assert.equal((await missing.json()).code, 'not_found');
    });

    await t.test('body > 256 KB → 413', async () => {
      const response = await call('PUT', '/orders/order_big', JSON.stringify({ pad: 'x'.repeat(270 * 1024) }));
      assert.equal(response.status, 413);
    });

    let orderId;
    await t.test('PUT crea (201), reserva stock negativo y marca SKU desconocido', async () => {
      const response = await call('PUT', '/orders/order_01', sampleOrder());
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.externalId, 'order_01');
      assert.equal(body.orderNumber, 'L-DHZ2A7');
      assert.equal(body.fulfillment.status, 'pending');
      assert.deepEqual(body.documents, []);
      orderId = body.zentofactId;
      const order = (await db.query('select * from orders where id=$1', [orderId])).rows[0];
      assert.equal(order.company_id, company.id);
      assert.equal(order.items_status, 'complete');
      assert.equal(order.payment_status, 'paid');
      assert.equal(order.document_status, 'not_requested');
      assert.equal(order.shipping.type, 'envio');
      assert.equal(order.shipping.carrier, undefined);
      assert.equal(Number(order.shipping_amount), 15);
      assert.equal(order.metadata.paymentMethod, 'tarjeta');
      const items = (await db.query('select sku, product_id, stock_state, stock_applied_quantity from order_items where order_id=$1 order by external_item_id', [orderId])).rows;
      assert.equal(Number(items[0].product_id), Number(product.id));
      assert.equal(items[0].stock_state, 'pending');
      assert.equal(Number(items[0].stock_applied_quantity), 2);
      assert.equal(items[1].product_id, null);
      assert.equal(items[1].stock_state, 'skipped_unmapped');
      const inventory = (await db.query('select quantity_on_hand, quantity_reserved from product_inventory where product_id=$1', [product.id])).rows[0];
      assert.equal(Number(inventory.quantity_on_hand) - Number(inventory.quantity_reserved), -1);
      const events = (await db.query('select type from integration_events where order_id=$1 order by id', [orderId])).rows;
      assert.deepEqual(events.map((event) => event.type), ['order.received']);
    });

    await t.test('PUT actualiza (200), conserva el avance de Zentofact y rechaza versiones viejas', async () => {
      await markStoreOrderStep({ orderId, step: 'confirm', markedBy: 'operador@limbo.pe' }, { db });
      const updated = await call('PUT', '/orders/order_01', sampleOrder({
        updatedAt: '2026-11-28T15:10:00Z',
        customer: { name: 'Ana P.', phone: '911111111' },
      }));
      assert.equal(updated.status, 200);
      const body = await updated.json();
      assert.equal(body.fulfillment.status, 'confirmed');
      assert.ok(body.fulfillment.confirmedAt);
      const order = (await db.query('select customer, fulfillment_status from orders where id=$1', [orderId])).rows[0];
      assert.equal(order.fulfillment_status, 'preparing');
      assert.deepEqual(order.customer, { name: 'Ana P.', email: null, phone: '911111111' });
      const stale = await call('PUT', '/orders/order_01', sampleOrder({ updatedAt: '2026-11-28T15:05:00Z' }));
      assert.equal(stale.status, 409);
      const problem = await stale.json();
      assert.equal(problem.code, 'stale_update');
      assert.equal(problem.retryable, false);
      const invalid = await call('PUT', '/orders/order_01', sampleOrder({ total: 1 }));
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).errors[0].path, 'total');
    });

    await t.test('operador carga datos fiscales y, con comprobante, el PUT no cambia ítems ni montos', async () => {
      await assert.rejects(updateExternalOrderBilling(orderId, { kind: 'factura', documentNumber: '20100070971', name: 'X', address: 'Lima' }, { db }), /RUC/);
      await updateExternalOrderBilling(orderId, { kind: 'boleta', documentType: '4', documentNumber: 'ab1234567', name: 'Ana Pérez', address: '' }, { db });
      let order = (await db.query('select customer, requested_document_type, document_status from orders where id=$1', [orderId])).rows[0];
      assert.equal(order.customer.documentType, '4');
      assert.equal(order.customer.documentNumber, 'AB1234567');
      assert.equal(order.requested_document_type, 'boleta');
      assert.equal(order.document_status, 'pending');
      // Un PUT de la tienda sin documento no borra lo que cargó el operador.
      const keep = await call('PUT', '/orders/order_01', sampleOrder({ updatedAt: '2026-11-28T15:11:00Z', customer: { name: 'Ana P.' } }));
      assert.equal(keep.status, 200);
      order = (await db.query('select customer, requested_document_type from orders where id=$1', [orderId])).rows[0];
      assert.equal(order.customer.documentNumber, 'AB1234567');
      assert.equal(order.requested_document_type, 'boleta');

      const branch = (await db.query(`insert into branches (company_id, codigo, nombre) values ($1, '0000', 'Principal') returning id`, [company.id])).rows[0];
      const client = (await db.query(
        `insert into clients (company_id, tipo_documento, numero_documento, razon_social) values ($1, '4', 'AB1234567', 'Ana Pérez') returning id`,
        [company.id],
      )).rows[0];
      const boleta = (await db.query(
        `insert into boletas (company_id, branch_id, client_id, serie, correlativo, numero_completo, fecha_emision, detalles,
           estado_sunat, mto_imp_venta, order_number)
         values ($1, $2, $3, 'B001', '1', 'B001-1', '2026-11-28', '[]', 'PENDIENTE', '144.8', 'L-DHZ2A7') returning id`,
        [company.id, branch.id, client.id],
      )).rows[0];
      // Un comprobante de OTRA empresa con el mismo número de pedido no se mezcla.
      const otherBranch = (await db.query(`insert into branches (company_id, codigo, nombre) values ($1, '0000', 'P') returning id`, [otherCompany.id])).rows[0];
      const otherClient = (await db.query(`insert into clients (company_id, tipo_documento, numero_documento, razon_social) values ($1, '1', '1', 'X') returning id`, [otherCompany.id])).rows[0];
      await db.query(
        `insert into boletas (company_id, branch_id, client_id, serie, correlativo, numero_completo, fecha_emision, detalles, estado_sunat, mto_imp_venta, order_number)
         values ($1, $2, $3, 'B001', '9', 'B001-9', '2026-11-28', '[]', 'ACEPTADO', '1', 'L-DHZ2A7')`,
        [otherCompany.id, otherBranch.id, otherClient.id],
      );

      await reconcileIntegrationDocuments({ db });
      let events = (await db.query(`select type, payload from integration_events where order_id=$1 and type like 'document.%' order by id`, [orderId])).rows;
      assert.deepEqual(events.map((event) => event.type), ['document.issued']);
      assert.equal(events[0].payload.documentId, `boleta:${boleta.id}`);
      assert.equal(events[0].payload.number, 'B001-1');
      const pendingPdf = await call('GET', `/documents/boleta:${boleta.id}/pdf`);
      assert.equal(pendingPdf.status, 409);
      assert.equal((await pendingPdf.json()).code, 'document_not_accepted');

      const blocked = await call('PUT', '/orders/order_01', sampleOrder({
        updatedAt: '2026-11-28T15:20:00Z',
        items: [{ id: 'ordli_1', sku: 'ABC-1', quantity: 3, unitPrice: 59.9, discount: 0, total: 179.7 }],
        total: 194.7,
      }));
      assert.equal(blocked.status, 409);
      assert.equal((await blocked.json()).code, 'document_already_issued');
      const contactOnly = await call('PUT', '/orders/order_01', sampleOrder({ updatedAt: '2026-11-28T15:21:00Z', customer: { name: 'Ana Pérez', phone: '900000000' } }));
      assert.equal(contactOnly.status, 200);

      await db.query(`update boletas set estado_sunat='ACEPTADO' where id=$1`, [boleta.id]);
      await reconcileIntegrationDocuments({ db });
      events = (await db.query(`select type from integration_events where order_id=$1 and type like 'document.%' order by id`, [orderId])).rows;
      assert.deepEqual(events.map((event) => event.type), ['document.issued', 'document.accepted']);
      const resource = await (await call('GET', '/orders/order_01')).json();
      assert.deepEqual(resource.documents.map((doc) => [doc.id, doc.kind, doc.status, doc.total]), [[`boleta:${boleta.id}`, 'boleta', 'accepted', 144.8]]);

      const pdfNotMine = await call('GET', '/documents/boleta:999999/pdf');
      assert.equal(pdfNotMine.status, 404);
    });

    await t.test('cancel: idempotencia, 422 con otro cuerpo, nota de crédito automática y document.voided', async () => {
      const headers = { 'idempotency-key': 'cancel-1' };
      const missingKey = await call('POST', '/orders/order_01/cancel', { reason: 'customer_request' });
      assert.equal(missingKey.status, 400);
      const first = await call('POST', '/orders/order_01/cancel', { reason: 'customer_request', note: 'Pidió anular' }, { headers });
      assert.equal(first.status, 200);
      const firstBody = await first.json();
      assert.equal(firstBody.fulfillment.status, 'cancelled');
      const replay = await call('POST', '/orders/order_01/cancel', { reason: 'customer_request', note: 'Pidió anular' }, { headers });
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), firstBody);
      const reused = await call('POST', '/orders/order_01/cancel', { reason: 'other' }, { headers });
      assert.equal(reused.status, 422);
      assert.equal((await reused.json()).code, 'idempotency_key_reused');

      const inventory = (await db.query('select quantity_reserved from product_inventory where product_id=$1', [product.id])).rows[0];
      assert.equal(Number(inventory.quantity_reserved), 0);
      const command = (await db.query(`select * from order_commands where order_id=$1 and command_type='integration.credit_note'`, [orderId])).rows[0];
      assert.equal(command.status, 'pending');
      const orderEvents = (await db.query('select type from integration_events where order_id=$1 order by id', [orderId])).rows.map((row) => row.type);
      assert.ok(orderEvents.includes('order.cancelled'));
      assert.equal(orderEvents.filter((type) => type === 'order.cancelled').length, 1);

      const boleta = (await db.query(`select * from boletas where order_number='L-DHZ2A7' and company_id=$1`, [company.id])).rows[0];
      const fakeCore = {
        async createAndSendCreditNoteFromBoleta(boletaId, options) {
          assert.equal(options.codMotivo, '01');
          const row = (await db.query(
            `insert into credit_notes (company_id, branch_id, client_id, affected_boleta_id, serie, correlativo, numero_completo,
               tipo_doc_afectado, num_doc_afectado, cod_motivo, des_motivo, fecha_emision, detalles, estado_sunat, mto_imp_venta)
             values ($1, $2, $3, $4, 'BC01', '1', 'BC01-1', '03', 'B001-1', '01', 'ANULACION DE LA OPERACION', '2026-11-28', '[]', 'ACEPTADO', '144.8')
             returning id`,
            [boleta.company_id, boleta.branch_id, boleta.client_id, boletaId],
          )).rows[0];
          return { success: true, creditNoteId: row.id };
        },
      };
      const stats = await processDocumentCommands({ db, core: fakeCore });
      assert.equal(stats.creditNotes, 1);
      const done = (await db.query('select status from order_commands where id=$1', [command.id])).rows[0];
      assert.equal(done.status, 'succeeded');
      await reconcileIntegrationDocuments({ db });
      const voided = (await db.query(`select payload from integration_events where order_id=$1 and type='document.voided'`, [orderId])).rows;
      assert.equal(voided.length, 1);
      assert.equal(voided[0].payload.documentId, `boleta:${boleta.id}`);
      assert.match(voided[0].payload.creditNoteId, /^credit_note:\d+$/);
      const resource = await (await call('GET', '/orders/order_01')).json();
      const boletaDoc = resource.documents.find((doc) => doc.kind === 'boleta');
      const creditNote = resource.documents.find((doc) => doc.kind === 'credit_note');
      assert.equal(boletaDoc.status, 'voided');
      assert.equal(creditNote.affects, boletaDoc.id);
    });

    await t.test('nota de crédito diferida mientras el comprobante no está aceptado', async () => {
      const response = await call('PUT', '/orders/order_02', sampleOrder({ orderNumber: 'L-SECOND' }));
      assert.equal(response.status, 201);
      const order = (await db.query(`select * from orders where external_order_id='order_02'`)).rows[0];
      const refs = (await db.query(`select branch_id, client_id from boletas where company_id=$1 limit 1`, [company.id])).rows[0];
      await db.query(
        `insert into boletas (company_id, branch_id, client_id, serie, correlativo, numero_completo, fecha_emision, detalles, estado_sunat, mto_imp_venta, order_number)
         values ($1, $2, $3, 'B001', '2', 'B001-2', '2026-11-28', '[]', 'ENVIANDO', '144.8', 'L-SECOND')`,
        [company.id, refs.branch_id, refs.client_id],
      );
      const cancel = await call('POST', '/orders/order_02/cancel', { reason: 'payment_issue' }, { headers: { 'idempotency-key': 'cancel-2' } });
      assert.equal(cancel.status, 200);
      const command = (await db.query(`select * from order_commands where order_id=$1`, [order.id])).rows[0];
      const outcome = await processCreditNoteCommand(command, { db, core: {} });
      assert.equal(outcome.status, 'pending');
      assert.equal(outcome.delaySeconds, 600);
      assert.match(outcome.error, /B001-2/);
    });

    await t.test('Bandeja: listo, enviado con tracking y entregado; cancel después de enviado → 409', async () => {
      const created = await call('PUT', '/orders/order_03', sampleOrder({ orderNumber: 'L-THIRD' }));
      const id = (await created.json()).zentofactId;
      await assert.rejects(markStoreOrderStep({ orderId: id, step: 'deliver' }, { db }), /enviado/);
      await markStoreOrderStep({ orderId: id, step: 'ready' }, { db });
      let items = (await db.query(`select stock_state from order_items where order_id=$1 and product_id is not null`, [id])).rows;
      assert.equal(items[0].stock_state, 'applied');
      const shipped = await markStoreOrderStep({ orderId: id, step: 'ship', carrier: 'shaloom', trackingNumber: 'SH-1', trackingUrl: 'https://shalom.pe/SH-1' }, { db });
      assert.equal(shipped.fulfillmentStatus, 'shipped');
      const again = await markStoreOrderStep({ orderId: id, step: 'ship', carrier: 'olva' }, { db });
      assert.equal(again.alreadyDone, true);
      const resource = await (await call('GET', '/orders/order_03')).json();
      assert.equal(resource.fulfillment.status, 'shipped');
      assert.equal(resource.fulfillment.carrier, 'shaloom');
      assert.equal(resource.fulfillment.trackingNumber, 'SH-1');
      assert.ok(resource.fulfillment.readyAt && resource.fulfillment.shippedAt && resource.fulfillment.confirmedAt);
      await db.query("update orders set updated_at=now()-interval '10 days' where id=$1", [id]);
      const { listLogisticsInbox } = await import('../logistics-inbox.js');
      const shippedInbox = await listLogisticsInbox({ stage: 'shipped', channel: 'manual' }, db, { ripleyEnabled: false });
      assert.ok(shippedInbox.orders.some((order) => order.id === id));
      assert.equal(shippedInbox.counts.shipped, 1);
      const cancel = await call('POST', '/orders/order_03/cancel', { reason: 'other' }, { headers: { 'idempotency-key': 'cancel-3' } });
      assert.equal(cancel.status, 409);
      assert.equal((await cancel.json()).code, 'order_already_shipped');
      const replayed = await call('POST', '/orders/order_03/cancel', { reason: 'other' }, { headers: { 'idempotency-key': 'cancel-3' } });
      assert.equal(replayed.status, 409);
      await markStoreOrderStep({ orderId: id, step: 'deliver' }, { db });
      const events = (await db.query('select type, payload from integration_events where order_id=$1 order by id', [id])).rows;
      assert.deepEqual(events.map((event) => event.type), ['order.received', 'order.confirmed', 'order.ready', 'order.shipped', 'order.delivered']);
      assert.equal(events[3].payload.trackingNumber, 'SH-1');
      const timeline = (await db.query(`select event_type from order_events where order_id=$1 and event_type like 'order.store_%' order by id`, [id])).rows;
      assert.deepEqual(timeline.map((row) => row.event_type), ['order.store_ready', 'order.store_ship', 'order.store_deliver']);
      items = (await db.query('select id from orders where id=$1 and order_status=$2', [id, 'completed'])).rows;
      assert.equal(items.length, 1);
    });

    await t.test('el trigger no publica eventos de cuentas sin integración (venta manual)', async () => {
      const { ingestOrder, ensureOrderChannelAccount } = await import('../order-management.js');
      const manualAccount = await ensureOrderChannelAccount({ companyId: company.id, channelCode: 'manual' }, db);
      const result = await ingestOrder({
        channelAccountId: manualAccount.id, companyId: company.id, externalOrderId: 'M-1', externalOrderNumber: 'M-1',
        source: 'manual', itemsComplete: true, items: [], customer: { name: 'X' }, shipping: { type: 'recojo' },
        metadata: { paymentMethod: 'yape_plin' },
      });
      const events = (await db.query('select count(*)::int as n from integration_events where order_id=$1', [result.order.id])).rows[0];
      assert.equal(events.n, 0);
    });

    await t.test('modo always: encola pagados pendientes y emite con fecha de pago (Lima) y actor sistema', async () => {
      const { enqueueAlwaysEmissions, SYSTEM_ACTOR } = await import('./document-jobs.js');
      await db.query(
        `update order_channel_accounts set settings = settings || '{"issuanceMode":"always"}'::jsonb,
           document_requirement='required' where id=$1`,
        [accountId],
      );
      const created = await call('PUT', '/orders/order_04', sampleOrder({
        orderNumber: 'L-FOURTH',
        payment: { status: 'paid', paidAt: '2026-11-28T03:00:00Z', method: 'card' },
      }));
      const id = (await created.json()).zentofactId;
      const order = (await db.query('select document_status from orders where id=$1', [id])).rows[0];
      assert.equal(order.document_status, 'pending');
      assert.ok(await enqueueAlwaysEmissions(db) >= 1);
      assert.equal(await enqueueAlwaysEmissions(db), 0);
      const calls = [];
      const stats = await processDocumentCommands({
        db,
        core: {},
        prepareOrderEmission: async () => ({ branchId: 1, kind: 'boleta', serie: 'B001' }),
        actOnOrderDocument: async (orderIdArg, action, input, actor) => {
          calls.push({ orderIdArg, action, input, actor });
          return { documentId: 1, numeroCompleto: 'B001-50' };
        },
      });
      assert.ok(stats.emissions >= 1);
      const call4 = calls.find((entry) => entry.orderIdArg === id);
      assert.equal(call4.action, 'emit');
      assert.equal(call4.actor, SYSTEM_ACTOR);
      assert.equal(call4.input.issueDate, '2026-11-27');
      assert.equal(call4.input.client.name, 'CLIENTE VARIOS');
      const command = (await db.query(`select status from order_commands where order_id=$1 and command_type='integration.emit'`, [id])).rows[0];
      assert.equal(command.status, 'succeeded');
      await db.query(
        `update order_channel_accounts set settings = settings || '{"issuanceMode":"on_request"}'::jsonb,
           document_requirement='optional' where id=$1`,
        [accountId],
      );
    });

    await t.test('cambiar el modo conserva las credenciales y pausa los comandos en cola', async () => {
      const { enqueueAlwaysEmissions } = await import('./document-jobs.js');
      const changeMode = (issuanceMode) => provisionIntegration(db, { accountId, issuanceMode, policyOnly: true });
      const credentialCount = async () => (await db.query(
        `select (select count(*)::integer from integration_keys where channel_account_id=$1) as keys,
          (select count(*)::integer from integration_endpoints where channel_account_id=$1) as endpoints`,
        [accountId],
      )).rows[0];
      const credentials = await credentialCount();
      await changeMode('always');
      assert.equal((await (await call('GET', '/policy')).json()).issuance.mode, 'always');
      const created = await call('PUT', '/orders/order_policy', sampleOrder({ orderNumber: 'L-POLICY' }));
      const { zentofactId: id } = await created.json();
      await enqueueAlwaysEmissions(db);
      await changeMode('on_request');
      assert.equal((await (await call('GET', '/policy')).json()).issuance.mode, 'on_request');
      assert.deepEqual(await credentialCount(), credentials);
      await processDocumentCommands({
        db,
        core: {},
        actOnOrderDocument: () => assert.fail('La emisión automática quedó desactivada'),
      });
      const { response_payload } = (await db.query(
        `select response_payload from order_commands where order_id=$1 and command_type='integration.emit'`,
        [id],
      )).rows[0];
      assert.equal(response_payload.skipped, 'mode_on_request');
      await changeMode('always');
      await enqueueAlwaysEmissions(db);
      const { status } = (await db.query(
        `select status from order_commands where order_id=$1 and command_type='integration.emit'`,
        [id],
      )).rows[0];
      assert.equal(status, 'pending');
      const fakeCore = {
        pool: db,
        listBranches: async () => (await db.query('select id, codigo, activo from branches where company_id=$1', [company.id])).rows,
        createBoleta() { assert.fail('El modo cambió antes de tomar el bloqueo del pedido'); },
      };
      await processDocumentCommands({
        db,
        core: fakeCore,
        async prepareOrderEmission(order) {
          const input = await prepareOrderEmission(order, fakeCore);
          await changeMode('on_request');
          return input;
        },
      });
      const afterLock = (await db.query(
        `select status, response_payload from order_commands where order_id=$1 and command_type='integration.emit'`,
        [id],
      )).rows[0];
      assert.equal(afterLock.status, 'succeeded');
      assert.equal(afterLock.response_payload.skipped, 'mode_on_request');
    });

    await t.test('aceptación en primera pasada y cola documental con cupo de un pedido', async () => {
      const created = await call('PUT', '/orders/order_first_accepted', sampleOrder({ orderNumber: 'L-ACCEPTED' }));
      const { zentofactId: id } = await created.json();
      const refs = (await db.query(`select branch_id, client_id from boletas where company_id=$1 limit 1`, [company.id])).rows[0];
      const factura = (await db.query(
        `insert into facturas (company_id, branch_id, client_id, serie, correlativo, numero_completo, fecha_emision, detalles,
           estado_sunat, mto_imp_venta, order_number)
         values ($1, $2, $3, 'F001', '9', 'F001-9', '2026-11-28', '[]', 'ACEPTADO', '144.8', 'L-ACCEPTED') returning id`,
        [company.id, refs.branch_id, refs.client_id],
      )).rows[0];
      await db.query("update orders set document_status='accepted' where id=$1", [id]);
      for (let i = 0; i < 6; i++) await reconcileIntegrationDocuments({ db, limit: 1 });
      const events = (await db.query(
        `select type from integration_events where order_id=$1 and type like 'document.%' order by id`,
        [id],
      )).rows;
      assert.deepEqual(events.map(({ type }) => type), ['document.issued', 'document.accepted']);

      const note = (await db.query(
        `insert into credit_notes (company_id, branch_id, client_id, affected_factura_id, serie, correlativo, numero_completo,
           tipo_doc_afectado, num_doc_afectado, cod_motivo, des_motivo, fecha_emision, detalles, estado_sunat, mto_imp_venta)
         values ($1, $2, $3, $4, 'FC01', '9', 'FC01-9', '01', 'F001-9', '04', 'DESCUENTO GLOBAL',
           '2026-11-28', '[]', 'ACEPTADO', '20') returning id`,
        [company.id, refs.branch_id, refs.client_id, factura.id],
      )).rows[0];
      await reconcileIntegrationDocuments({ db });
      const resource = await (await call('GET', '/orders/order_first_accepted')).json();
      assert.equal(resource.documents.find(({ kind }) => kind === 'factura').status, 'accepted');
      assert.equal(resource.documents.find(({ id }) => id === `credit_note:${note.id}`).affects, `factura:${factura.id}`);
      const canceled = await call('POST', '/orders/order_first_accepted/cancel', { reason: 'customer_request' }, {
        headers: { 'idempotency-key': 'cancel-with-partial-credit' },
      });
      assert.equal(canceled.status, 200);
      const command = (await db.query(
        "select * from order_commands where order_id=$1 and command_type='integration.credit_note'", [id],
      )).rows[0];
      const result = await processCreditNoteCommand(command, { db, core: {} });
      assert.equal(result.status, 'failed');
      assert.match(result.error, /otro motivo/);
      const voided = await db.query("select 1 from integration_events where order_id=$1 and type='document.voided'", [id]);
      assert.equal(voided.rowCount, 0);
    });

    await t.test('la emisión que espera detrás de una cancelación no crea comprobante', async () => {
      const created = await call('PUT', '/orders/order_cancel_race', sampleOrder({ orderNumber: 'L-CANCEL-RACE' }));
      const { zentofactId: id } = await created.json();
      await updateExternalOrderBilling(id, { kind: 'boleta', documentType: '1', documentNumber: '12345678', name: 'Ana' }, { db });
      const branches = async () => (await db.query('select id, codigo, activo from branches where company_id=$1', [company.id])).rows;
      const input = await prepareOrderEmission(await getOrder(id, db), { listBranches: branches });
      await assert.rejects(actOnOrderDocument(id, 'emit', input, 'test', {
        pool: db,
        async listBranches() {
          const canceled = await call('POST', '/orders/order_cancel_race/cancel', { reason: 'customer_request' }, {
            headers: { 'idempotency-key': 'cancel-racing-emission' },
          });
          assert.equal(canceled.status, 200);
          return branches();
        },
        createBoleta() { assert.fail('Se intentó emitir un pedido cancelado'); },
      }), /cancelado/);
    });

    await t.test('inventario: GET por SKU y un inventory.updated por SKU por ráfaga', async () => {
      const inventory = await (await call('GET', '/inventory?sku=ABC-1,NADA')).json();
      assert.equal(inventory.items.length, 1);
      assert.equal(inventory.items[0].sku, 'ABC-1');
      assert.equal(typeof inventory.items[0].available, 'number');
      const page = await (await call('GET', '/inventory?limit=1')).json();
      assert.equal(page.items.length, 1);
      await db.query(`update integration_inventory_changes set changed_at=now() - interval '1 minute', first_changed_at=now() - interval '1 minute'`);
      const flushed = await flushInventoryChanges({ db });
      assert.equal(flushed.products, 1);
      assert.equal(flushed.published, 1);
      const again = await flushInventoryChanges({ db });
      assert.equal(again.products, 0);
      const event = (await db.query(`select payload from integration_events where type='inventory.updated' order by id desc limit 1`)).rows[0];
      assert.equal(event.payload.sku, 'ABC-1');
    });

    await t.test('webhooks: firma verificable, reintento con backoff y 410 desactiva el endpoint', async () => {
      const sent = [];
      let mode = 'fail';
      const fetchImpl = async (url, init) => {
        sent.push({ url, init });
        return { status: mode === 'fail' ? 500 : mode === 'gone' ? 410 : 204 };
      };
      const firstRound = await processDeliveries({ db, fetchImpl, limit: 1 });
      assert.equal(firstRound[0].status, 'pending');
      assert.equal(firstRound[0].retryInSeconds, 5);
      const { headers, body } = sent[0].init;
      assert.equal(verifyWebhookSignature(provisioned.webhookSecret, {
        id: headers['webhook-id'], timestamp: headers['webhook-timestamp'], body, header: headers['webhook-signature'],
      }), true);
      const parsed = JSON.parse(body);
      assert.ok(parsed.type && parsed.timestamp && Number.isInteger(parsed.data.sequence));
      mode = 'ok';
      const ok = await processDeliveries({ db, fetchImpl, limit: 5 });
      assert.ok(ok.every((result) => result.status === 'delivered'));
      await db.query(`update integration_deliveries set next_attempt_at=now() where status='pending'`);
      mode = 'gone';
      const gone = await processDeliveries({ db, fetchImpl, limit: 1 });
      assert.equal(gone[0].status, 'disabled');
      const endpointRow = (await db.query('select active, disabled_reason from integration_endpoints where channel_account_id=$1', [accountId])).rows[0];
      assert.equal(endpointRow.active, false);
      assert.equal(endpointRow.disabled_reason, '410 Gone');
      const pending = (await db.query(`select count(*)::int as n from integration_deliveries where status='pending'`)).rows[0];
      assert.equal(pending.n, 0);
    });
  } finally {
    await db.end().catch(() => {});
    await admin.query(`drop schema ${schema} cascade`).catch(() => {});
    await admin.end();
  }
});
