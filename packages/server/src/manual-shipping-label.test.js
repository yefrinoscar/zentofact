import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { A4_HEIGHT, A4_WIDTH } from './shipping-label-sheet.js';
import { buildManualLabelSheet, deliveryLine, shippingAddressLine } from './manual-shipping-label.js';

function sampleOrder(overrides = {}) {
  return {
    id: 11,
    externalOrderNumber: 'QNC260902120000',
    companyName: 'LIMBO',
    customer: { name: 'Carlos Vega', phone: '999111222' },
    shipping: {
      type: 'envio',
      carrier: 'nosotros',
      address: 'Av. La Marina 2055, San Miguel',
    },
    items: [
      { sku: 'ZF-BOT-003', description: 'Botella térmica 750 ml', quantity: 2 },
      { sku: 'ZF-MOC-001', description: 'Mochila urbana', quantity: 1 },
    ],
    ...overrides,
  };
}

test('la línea de entrega usa el repartidor corto', () => {
  assert.equal(deliveryLine({ shipping: { type: 'envio', carrier: 'nosotros' } }), 'Envío · Express');
  assert.equal(deliveryLine({ shipping: { type: 'recojo' } }), 'Recojo en tienda');
  assert.equal(shippingAddressLine({ address: 'Av. Brasil 100, Magdalena' }), 'Av. Brasil 100, Magdalena');
});

test('arma una hoja A4 con 4 etiquetas manuales', async () => {
  const bytes = await buildManualLabelSheet([
    sampleOrder(),
    sampleOrder({ id: 12, externalOrderNumber: 'QNC260902120001' }),
    sampleOrder({ id: 13, externalOrderNumber: 'QNC260902120002' }),
    sampleOrder({ id: 14, externalOrderNumber: 'QNC260902120003' }),
    sampleOrder({ id: 15, externalOrderNumber: 'QNC260902120004' }),
  ]);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  const first = pdf.getPage(0);
  assert.equal(first.getWidth(), A4_WIDTH);
  assert.equal(first.getHeight(), A4_HEIGHT);
});

test('exige al menos un pedido manual', async () => {
  await assert.rejects(() => buildManualLabelSheet([]), /al menos un pedido manual/);
});
