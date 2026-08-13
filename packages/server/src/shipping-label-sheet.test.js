import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  A4_HEIGHT,
  A4_WIDTH,
  appendTicketInventoryPages,
  buildA4ShippingLabelSheet,
  composeA4ShippingLabelSheet,
  extractShippingLabelTrackingCodes,
  inventoryForTicket,
  shippingLabelCropBox,
  ticketCode,
} from './shipping-label-sheet.js';

async function sampleLabel(width = 200, height = 320, pages = 1) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([width, height]);
    page.drawText(`ETIQUETA ${index + 1}`, { x: 20, y: height - 40, size: 16 });
  }
  return pdf.save();
}

test('extrae el tracking largo del texto de cada página de Falabella', async () => {
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([300, 400]);
  first.drawText('Orden 3248342012');
  first.drawText('240121000011894785', { y: 200 });
  const second = pdf.addPage([300, 400]);
  second.drawText('240111000011900534');

  assert.deepEqual(
    await extractShippingLabelTrackingCodes(await pdf.save()),
    ['240121000011894785', '240111000011900534'],
  );
});

const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=',
  'base64',
);

function sampleInventory(itemCount = 1) {
  return {
    ok: true,
    orderNumber: 'ORD-10',
    companyName: 'Tienda Demo',
    customerName: 'María Pérez',
    orderedAt: '2026-07-31T15:00:00.000Z',
    shippingType: 'Entrega regular',
    items: Array.from({ length: itemCount }, (_, index) => ({
      sellerSku: `SKU-${index + 1}`,
      name: `Producto número ${index + 1} con descripción completa 📦`,
      quantity: index + 1,
      imageBytes: SAMPLE_PNG,
      imageMimeType: 'image/png',
    })),
  };
}

async function appendSampleInventoryPages(ticketInventories, options = {}) {
  const pdf = await PDFDocument.create();
  pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const stats = await appendTicketInventoryPages(pdf, ticketInventories, options);
  const bytes = await pdf.save();
  return {
    ...stats,
    pageCount: (await PDFDocument.load(bytes)).getPageCount(),
  };
}

test('genera códigos cortos de tres caracteres para cada ticket', () => {
  assert.equal(ticketCode(1), 'A01');
  assert.equal(ticketCode(15), 'A15');
  assert.equal(ticketCode(20), 'A20');
  assert.equal(ticketCode(30), 'A30');
  assert.equal(ticketCode(99), 'A99');
  assert.equal(ticketCode(100), 'B01');
  assert.equal(ticketCode(500), 'F05');
});

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

test('incluye únicamente las etiquetas seleccionadas de un pedido multipágina', async () => {
  const threeLabels = await sampleLabel(200, 320, 3);
  const result = await buildA4ShippingLabelSheet([
    { companyId: 2, orderId: '10', orderNumber: 'ORD-10', labelIndex: 2 },
  ], async () => ({
    ok: true,
    mimeType: 'application/pdf',
    base64: Buffer.from(threeLabels).toString('base64'),
  }));

  assert.equal(result.labelCount, 1);
  assert.deepEqual(result.printedLabels, [{
    companyId: 2,
    orderId: '10',
    orderNumber: 'ORD-10',
    labelIndexes: [2],
  }]);
});

test('combina varios índices del mismo pedido sin duplicarlos', async () => {
  const threeLabels = await sampleLabel(200, 320, 3);
  const result = await buildA4ShippingLabelSheet([
    { companyId: 2, orderId: '10', orderNumber: 'ORD-10', labelIndex: 3 },
    { companyId: 2, orderId: '10', orderNumber: 'ORD-10', labelIndex: 1 },
    { companyId: 2, orderId: '10', orderNumber: 'ORD-10', labelIndex: 3 },
  ], async () => ({
    ok: true,
    mimeType: 'application/pdf',
    base64: Buffer.from(threeLabels).toString('base64'),
  }));

  assert.equal(result.orderCount, 1);
  assert.equal(result.labelCount, 2);
  assert.deepEqual(result.printedLabels[0].labelIndexes, [1, 3]);
});

test('agrupa las etiquetas por seller y conserva el orden interno de cada tienda', async () => {
  const label = await sampleLabel();
  const result = await buildA4ShippingLabelSheet([
    { companyId: 2, sellerKey: 'MANTA-RAYA', orderId: 'A-1', orderNumber: 'SELLER-A-1' },
    { companyId: 2, sellerKey: 'RUNA-PUMA', orderId: 'B-1', orderNumber: 'SELLER-B-1' },
    { companyId: 2, sellerKey: 'MANTA-RAYA', orderId: 'A-2', orderNumber: 'SELLER-A-2' },
    { companyId: 2, sellerKey: 'BEAUTY-HOME', orderId: 'C-1', orderNumber: 'SELLER-C-1' },
    { companyId: 2, sellerKey: 'RUNA-PUMA', orderId: 'B-2', orderNumber: 'SELLER-B-2' },
  ], async () => ({
    ok: true,
    mimeType: 'application/pdf',
    base64: Buffer.from(label).toString('base64'),
  }));

  assert.deepEqual(
    result.printedLabels.map((entry) => entry.orderId),
    ['A-1', 'A-2', 'B-1', 'B-2', 'C-1'],
  );
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

test('imprime únicamente las etiquetas aunque se consulte el inventario para el escáner', async () => {
  const twoLabels = await sampleLabel(200, 320, 2);
  let inventoryCalls = 0;
  const result = await buildA4ShippingLabelSheet([
    { companyId: 2, orderId: '10', orderNumber: 'ORD-10', labelIndex: 1 },
    { companyId: 2, orderId: '10', orderNumber: 'ORD-10', labelIndex: 2 },
  ], async () => ({
    ok: true,
    mimeType: 'application/pdf',
    base64: Buffer.from(twoLabels).toString('base64'),
  }), async () => {
    inventoryCalls += 1;
    return sampleInventory(2);
  });

  assert.equal(inventoryCalls, 1);
  assert.equal(result.labelPageCount, 1);
  assert.equal(result.inventoryTicketCount, 0);
  assert.equal(result.inventoryCardCount, 0);
  assert.equal(result.inventoryPageCount, 0);
  assert.equal(result.inventoryIncluded, false);
  assert.equal(result.pageCount, 1);
  assert.match(result.filename, /^etiquetas-a4-/);
  assert.equal((await PDFDocument.load(Buffer.from(result.base64, 'base64'))).getPageCount(), 1);
});

test('distribuye hasta ocho tickets simples por hoja de inventario', async () => {
  const result = await appendSampleInventoryPages(Array.from({ length: 8 }, (_, index) => ({
    ticketNumber: index + 1,
    labelIndex: 1,
    labelCount: 1,
    inventory: { ...sampleInventory(), orderNumber: `ORD-${index + 1}` },
  })));

  assert.equal(result.inventoryTicketCount, 8);
  assert.equal(result.inventoryCardCount, 8);
  assert.equal(result.inventoryPageCount, 1);
  assert.equal(result.pageCount, 2);
});

test('combina un ticket doble y seis simples en una sola hoja de inventario', async () => {
  const result = await appendSampleInventoryPages(Array.from({ length: 7 }, (_, index) => ({
    ticketNumber: index + 1,
    labelIndex: 1,
    labelCount: 1,
    inventory: {
      ...sampleInventory(index === 0 ? 2 : 1),
      orderNumber: `ORD-${index + 1}`,
    },
  })));

  assert.equal(result.inventoryTicketCount, 7);
  assert.equal(result.inventoryCardCount, 7);
  assert.equal(result.inventoryPageCount, 1);
  assert.equal(result.pageCount, 2);
});

test('asigna a cada ticket únicamente los productos de su PackageId', () => {
  const inventory = {
    items: [
      { name: 'Producto A', packageId: 'PKG-A', quantity: 1 },
      { name: 'Producto B', packageId: 'PKG-B', quantity: 2 },
      { name: 'Producto C', packageId: 'PKG-B', quantity: 1 },
    ],
  };

  const first = inventoryForTicket(inventory, 1, 2);
  const second = inventoryForTicket(inventory, 2, 2);
  assert.equal(first.packageMappingComplete, true);
  assert.deepEqual(first.items.map((item) => item.name), ['Producto A']);
  assert.equal(second.ticketPackageId, 'PKG-B');
  assert.deepEqual(second.items.map((item) => item.name), ['Producto B', 'Producto C']);
});

test('divide un inventario largo en varias páginas sin perder las etiquetas', async () => {
  const result = await appendSampleInventoryPages([{
    ticketNumber: 1,
    labelIndex: 1,
    labelCount: 1,
    inventory: sampleInventory(13),
  }]);

  assert.equal(result.inventoryTicketCount, 1);
  assert.equal(result.inventoryCardCount, 5);
  assert.equal(result.inventoryPageCount, 2);
  assert.equal(result.pageCount, 3);
});

test('mantiene el PDF aunque una foto remota no se pueda descargar', async () => {
  const inventory = sampleInventory();
  delete inventory.items[0].imageBytes;
  inventory.items[0].imageUrl = 'https://imagenes.example.test/producto.jpg';
  const result = await appendSampleInventoryPages([{
    ticketNumber: 1,
    labelIndex: 1,
    labelCount: 1,
    inventory,
  }], {
    fetchProductImage: async () => { throw new Error('sin imagen'); },
  });

  assert.equal(result.inventoryPageCount, 1);
  assert.equal(result.pageCount, 2);
});

test('usa otra foto candidata cuando la primera URL falla', async () => {
  const inventory = sampleInventory();
  delete inventory.items[0].imageBytes;
  inventory.items[0].imageUrl = 'https://imagenes.example.test/fallida.jpg';
  inventory.items[0].imageUrls = [
    'https://imagenes.example.test/fallida.jpg',
    'https://imagenes.example.test/correcta.jpg',
  ];
  const attempted = [];
  const result = await appendSampleInventoryPages([{
    ticketNumber: 1,
    labelIndex: 1,
    labelCount: 1,
    inventory,
  }], {
    fetchProductImage: async (imageUrl) => {
      attempted.push(imageUrl);
      if (imageUrl.endsWith('/fallida.jpg')) throw new Error('sin imagen');
      return { bytes: SAMPLE_PNG, mimeType: 'image/png' };
    },
  });

  assert.deepEqual(attempted.sort(), [
    'https://imagenes.example.test/correcta.jpg',
    'https://imagenes.example.test/fallida.jpg',
  ]);
  assert.equal(result.inventoryPageCount, 1);
  assert.equal(result.pageCount, 2);
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
