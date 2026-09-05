import assert from 'node:assert/strict';
import test from 'node:test';
import { MercadoLibreApiClient } from '@zentofact/mercado-libre-api';
import {
  SANDBOX_ACCESS_TOKEN,
  SANDBOX_PENDING_SHIPMENT_ID,
  SANDBOX_READY_ORDER_ID,
  SANDBOX_READY_SHIPMENT_ID,
  SANDBOX_REFRESH_TOKEN,
  SANDBOX_SELLER_ID,
  isMercadoLibreSandboxToken,
  mercadoLibreSandboxEnabled,
  mercadoLibreSandboxFetch,
  pushSandboxOrder,
  resetMercadoLibreSandbox,
} from './mercado-libre-sandbox.js';

test('el flag sandbox solo acepta true explícito', () => {
  assert.equal(mercadoLibreSandboxEnabled({ MERCADO_LIBRE_SANDBOX: 'true' }), true);
  assert.equal(mercadoLibreSandboxEnabled({ MERCADO_LIBRE_SANDBOX: 'false' }), false);
  assert.equal(mercadoLibreSandboxEnabled({}), false);
  assert.equal(isMercadoLibreSandboxToken(SANDBOX_ACCESS_TOKEN), true);
  assert.equal(isMercadoLibreSandboxToken('APP_USR-real'), false);
});

test('el sandbox sirve órdenes, envíos y etiqueta ME2 sin salir a Mercado Libre', async () => {
  resetMercadoLibreSandbox();
  const client = new MercadoLibreApiClient({
    accessToken: SANDBOX_ACCESS_TOKEN,
    fetchImpl: mercadoLibreSandboxFetch,
  });
  const me = await client.getMe();
  assert.equal(me.userId, SANDBOX_SELLER_ID);
  const page = await client.searchOrders({ sellerId: SANDBOX_SELLER_ID });
  assert.ok(page.orders.some((order) => order.orderId === SANDBOX_READY_ORDER_ID));
  const shipment = await client.getShipment(SANDBOX_READY_SHIPMENT_ID);
  assert.equal(shipment.status, 'ready_to_ship');
  const label = await client.getShipmentLabels([SANDBOX_READY_SHIPMENT_ID]);
  assert.equal(label[0], 0x25);
  assert.equal(label[1], 0x50);
  await assert.rejects(() => client.getShipmentLabels([SANDBOX_PENDING_SHIPMENT_ID]), /not_printable|HTTP 400/);
});

test('un pedido nuevo entra al store y queda listo para el webhook', () => {
  resetMercadoLibreSandbox();
  const created = pushSandboxOrder({
    firstName: 'Nuria',
    shipmentStatus: 'ready_to_ship',
  });
  assert.match(created.orderId, /^1004\d$/);
  assert.equal(created.shipmentStatus, 'ready_to_ship');
  assert.equal(created.substatus, 'ready_to_print');
});

test('el refresh sandbox no llama a api.mercadolibre.com', async () => {
  const response = await mercadoLibreSandboxFetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: SANDBOX_REFRESH_TOKEN,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.access_token, SANDBOX_ACCESS_TOKEN);
  assert.equal(String(body.user_id), SANDBOX_SELLER_ID);
});
