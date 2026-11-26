import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { A4_HEIGHT, A4_WIDTH } from './shipping-label-sheet.js';
import { buildManualLabelSheet, deliveryLine, shalomLabelData, shippingAddressLine } from './manual-shipping-label.js';

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

const shalomShipping = {
  type: 'envio',
  carrier: 'shaloom',
  address: 'Arequipa',
  shalom: {
    name: 'Maribel Vanesa Silva Cama',
    dni: '40328817',
    phone: '968784568 / 975141252',
    sede: 'Arequipa / Alto Selva Alegre / Av Lima',
  },
};

test('los pedidos Shaloom usan los datos de agencia guardados', () => {
  assert.deepEqual(shalomLabelData({ shipping: shalomShipping }), shalomShipping.shalom);
  assert.equal(shalomLabelData({ shipping: { ...shalomShipping, carrier: 'marvisuar' } }), null);
  assert.equal(shalomLabelData({ shipping: { type: 'envio', carrier: 'shaloom' } }), null);
});

test('Shalom va en hojas de 2 y los demás manuales siguen en hojas de 4', async () => {
  const bytes = await buildManualLabelSheet([
    sampleOrder({ shipping: shalomShipping }),
    sampleOrder({ id: 12 }),
    sampleOrder({ id: 13, shipping: { ...shalomShipping, shalom: { ...shalomShipping.shalom, sede: 'Lima / Los Olivos / Agencia Av. Carlos Izaguirre cuadra 9 frente al mercado' } } }),
    sampleOrder({ id: 14, shipping: shalomShipping }),
  ]);
  const pdf = await PDFDocument.load(bytes);
  // 1 hoja vertical con la etiqueta manual + 2 hojas horizontales con 3 etiquetas Shalom.
  assert.equal(pdf.getPageCount(), 3);
  assert.equal(pdf.getPage(0).getWidth(), A4_WIDTH);
  assert.equal(pdf.getPage(1).getWidth(), A4_HEIGHT);
  assert.equal(pdf.getPage(1).getHeight(), A4_WIDTH);
});
