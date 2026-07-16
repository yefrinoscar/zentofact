import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  A4_HEIGHT,
  A4_WIDTH,
  buildA4ShippingLabelSheet,
  composeA4ShippingLabelSheet,
  shippingLabelCropBox,
} from './shipping-label-sheet.js';

async function sampleLabel(width = 200, height = 320, pages = 1) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([width, height]);
    page.drawText(`ETIQUETA ${index + 1}`, { x: 20, y: height - 40, size: 16 });
  }
  return pdf.save();
}

test('agrupa hasta cuatro etiquetas por página A4', async () => {
  const label = await sampleLabel();
  const result = await composeA4ShippingLabelSheet([label, label, label, label, label]);
  const pdf = await PDFDocument.load(result);

  assert.equal(pdf.getPageCount(), 2);
  for (const page of pdf.getPages()) {
    assert.equal(page.getWidth(), A4_WIDTH);
    assert.equal(page.getHeight(), A4_HEIGHT);
  }
});

test('conserva todas las páginas cuando Falabella devuelve un PDF multipágina', async () => {
  const twoLabels = await sampleLabel(200, 320, 2);
  const oneLabel = await sampleLabel();
  const result = await composeA4ShippingLabelSheet([twoLabels, oneLabel, oneLabel, oneLabel]);

  assert.equal((await PDFDocument.load(result)).getPageCount(), 2);
});

test('recorta el cuadrante superior izquierdo de la hoja completa de Falabella', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([A4_WIDTH, A4_HEIGHT]);

  assert.deepEqual(shippingLabelCropBox(page), {
    left: 0,
    bottom: A4_HEIGHT * 0.505,
    right: A4_WIDTH * 0.445,
    top: A4_HEIGHT,
  });
  assert.equal(shippingLabelCropBox((await PDFDocument.load(await sampleLabel())).getPage(0)), undefined);
});

test('detecta una hoja A4 reducida por su proporción y no por sus puntos físicos', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([420, 594]);

  assert.deepEqual(shippingLabelCropBox(page), {
    left: 0,
    bottom: 299.97,
    right: 186.9,
    top: 594,
  });
});

test('obtiene cada etiqueta y devuelve un único PDF imprimible', async () => {
  const label = await sampleLabel();
  const seen = [];
  const result = await buildA4ShippingLabelSheet([
    { companyId: 2, orderId: '10', orderNumber: 'ORD-10' },
    { companyId: 2, orderId: '11', orderNumber: 'ORD-11' },
  ], async (order) => {
    seen.push(order.orderId);
    return { ok: true, mimeType: 'application/pdf', base64: Buffer.from(label).toString('base64') };
  });

  assert.deepEqual(seen.sort(), ['10', '11']);
  assert.equal(result.labelCount, 2);
  assert.equal(result.pageCount, 1);
  assert.equal((await PDFDocument.load(Buffer.from(result.base64, 'base64'))).getPageCount(), 1);
});

test('no omite silenciosamente una etiqueta que Falabella no pudo entregar', async () => {
  await assert.rejects(
    buildA4ShippingLabelSheet(
      [{ companyId: 2, orderId: '10', orderNumber: 'ORD-10' }],
      async () => ({ ok: false, error: 'temporal' }),
    ),
    /ORD-10: temporal/,
  );
});

test('deja de iniciar consultas nuevas cuando una etiqueta falla', async () => {
  let calls = 0;
  const orders = Array.from({ length: 12 }, (_, index) => ({
    companyId: 2,
    orderId: String(index + 1),
    orderNumber: `ORD-${index + 1}`,
  }));

  await assert.rejects(buildA4ShippingLabelSheet(orders, async () => {
    calls += 1;
    return { ok: false, error: 'temporal' };
  }));
  assert.ok(calls <= 4);
});
