import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detachRipleySvcManifestLabels,
  downloadRipleySvcLabels,
  downloadRipleySvcManifest,
  editRipleySvcPackages,
  getRipleySvcManifest,
  listAllRipleySvcOrders,
  listRipleySvcEligibleLabels,
  listRipleySvcLabels,
  listRipleySvcManifests,
  mapRipleySvcFulfillmentStatus,
  scheduleRipleySvcManifest,
} from './ripley-logistics.js';

test('permite consultar el historial sandbox vacío sin credenciales productivas SVC', async () => {
  const result = await listRipleySvcManifests(7, { sandbox: true, orderId: 'TEST-100-A' }, {
    getCompany: async () => ({ id: 7, activo: true, nombre: 'Seller de prueba' }),
  });
  assert.equal(result.sandbox, true);
  assert.equal(result.total, 0);
  assert.deepEqual(result.manifests, []);
});

test('el sandbox logístico inicia con una etiqueta elegible y sin manifiesto', async () => {
  const dependencies = {
    getCompany: async () => ({ id: 7, activo: true, nombre: 'Seller de prueba' }),
  };
  const [labels, eligible, manifests] = await Promise.all([
    listRipleySvcLabels(7, { sandbox: 'true', orderId: 'TEST-200-A' }, dependencies),
    listRipleySvcEligibleLabels(7, { sandbox: true, orderId: 'TEST-200-A' }, dependencies),
    listRipleySvcManifests(7, { sandbox: true, orderId: 'TEST-200-A' }, dependencies),
  ]);
  assert.equal(labels.labels[0]._id, eligible.labels[0]._id);
  assert.equal(manifests.total, 0);
  assert.equal(labels.environment, 'simulated');
});

test('acepta credenciales SVC guardadas en snake_case', async () => {
  const paths = [];
  const result = await listRipleySvcLabels(7, { orderId: 'R-1', limit: 25 }, {
    getCompany: async () => ({
      id: 7,
      activo: true,
      ripley_svc_base_url: 'https://sellercenter.ripley.test',
      ripley_svc_username: 'seller',
      ripley_svc_password: 'clave',
    }),
    fetchImpl: async (url) => {
      paths.push(new URL(url).pathname);
      if (String(url).includes('/auth/login/vendor')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ labels: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.deepEqual(result, { labels: [] });
  assert.ok(paths.includes('/api/current/auth/login/vendor'));
  assert.ok(paths.includes('/api/v7/label/labels'));
});

test('sin sandbox conserva el bloqueo cuando faltan credenciales SVC', async () => {
  await assert.rejects(
    () => listRipleySvcManifests(7, {}, {
      getCompany: async () => ({ id: 7, activo: true, nombre: 'Seller sin SVC' }),
    }),
    /credenciales productivas de Seller Center Ripley/,
  );
});

test('completa el ciclo sandbox de bultos, etiquetas, recojo y manifiesto', async () => {
  const companyId = 707;
  const orderId = 'FLOW-707-A';
  const dependencies = {
    getCompany: async () => ({ id: companyId, activo: true, nombre: 'Seller de prueba' }),
  };
  const initial = await listRipleySvcEligibleLabels(companyId, { sandbox: true, orderId }, dependencies);
  const labelId = initial.labels[0]._id;
  assert.equal((await listRipleySvcManifests(companyId, { sandbox: true, orderId }, dependencies)).total, 0);

  await editRipleySvcPackages(companyId, {
    sandbox: true, orderId, svcOrderId: 'svc-flow-707', packages: 2,
  }, dependencies);
  const labels = await listRipleySvcLabels(companyId, { sandbox: true, orderId }, dependencies);
  assert.equal(labels.labels[0].packages, 2);
  assert.match((await downloadRipleySvcLabels(companyId, {
    sandbox: true, orderId, documentIds: [labelId],
  }, dependencies)).labels_generated, /^[A-Za-z0-9+/]+=*$/);

  const created = await scheduleRipleySvcManifest(companyId, {
    sandbox: true,
    orderId,
    labelIds: [labelId],
    pickupDate: '2026-08-22',
    warehouseAddress: 'Av. Prueba 123',
  }, dependencies);
  assert.equal(created.manifests.length, 1);
  const manifestId = created.manifests[0]._id;
  assert.equal((await listRipleySvcEligibleLabels(companyId, { sandbox: true, orderId }, dependencies)).total, 0);
  assert.equal((await getRipleySvcManifest(companyId, manifestId, { sandbox: true }, dependencies)).packages, 2);
  assert.match((await downloadRipleySvcManifest(companyId, manifestId, { sandbox: true }, dependencies)).pdf, /^[A-Za-z0-9+/]+=*$/);

  await detachRipleySvcManifestLabels(companyId, manifestId, {
    sandbox: true, labelIds: [labelId],
  }, dependencies);
  assert.equal((await listRipleySvcEligibleLabels(companyId, { sandbox: true, orderId }, dependencies)).total, 1);
});

test('mantiene separado el estado logístico SVC y lo traduce al fulfillment canónico', () => {
  assert.equal(mapRipleySvcFulfillmentStatus('TO_PREPARE'), 'preparing');
  assert.equal(mapRipleySvcFulfillmentStatus('TO_PICKUP'), 'ready_to_ship');
  assert.equal(mapRipleySvcFulfillmentStatus('SHIPPED'), 'shipped');
  assert.equal(mapRipleySvcFulfillmentStatus('RECEIVED'), 'delivered');
  assert.equal(mapRipleySvcFulfillmentStatus('WITH_ERROR'), 'preparing');
  assert.equal(mapRipleySvcFulfillmentStatus('UNKNOWN_FUTURE_STATE'), null);
});

test('pagina la bandeja SVC hasta alcanzar el total', async () => {
  const calls = [];
  const first = Array.from({ length: 200 }, (_, index) => ({ order_id: `R-${index}` }));
  const orders = await listAllRipleySvcOrders({
    async listLogisticsOrders(options) {
      calls.push(options);
      return options.page === 1
        ? { status: 200, data: { total: 201, orders: first } }
        : { status: 200, data: { total: 201, orders: [{ order_id: 'R-200' }] } };
    },
  });
  assert.equal(orders.length, 201);
  assert.deepEqual(calls, [{ page: 1, limit: 200 }, { page: 2, limit: 200 }]);
});
