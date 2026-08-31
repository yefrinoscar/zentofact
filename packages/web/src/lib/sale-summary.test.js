import assert from 'node:assert/strict';
import test from 'node:test';
import { PICKUP_ADDRESS } from './registrar-venta.ts';
import { saleTotals } from './own-fleet-shipping.ts';
import {
  customerSummaryRows,
  deliverySummaryRows,
  documentSummary,
  formatDistanceKm,
  formatSaleDate,
  ownFleetShippingLabel,
  paymentSummaryRows,
  saleSummaryGroups,
  saleTotalRows,
} from './sale-summary.ts';

const baseLine = {
  id: 'line-1',
  productId: 44,
  sku: 'AG301',
  name: 'Coche bastón celeste',
  catalogPrice: 250,
  unitPrice: 250,
  quantity: 1,
};

function validSale(overrides = {}) {
  return {
    channelAccountId: 22,
    customerName: 'Ana Pérez',
    customerPhone: '999111222',
    lines: [baseLine],
    delivery: 'envio',
    deliveryDate: '2026-08-25',
    shippingCarrier: 'shaloom',
    dropoffPlace: { label: 'Av. Primavera 123, Surco', district: 'Surco', lat: -12.1, lng: -77.0 },
    shippingNote: 'Tocar timbre',
    saleSource: 'whatsapp',
    paymentMethod: 'despues',
    ...overrides,
  };
}

function valueOf(rows, label) {
  return rows.find((row) => row.label === label)?.value;
}

/** Intl separa el símbolo con espacio duro; el test compara el texto que ve el vendedor. */
function money(value) {
  return String(value).replace(/\u00a0/g, ' ');
}

test('la fecha del resumen se lee en español y sin año cuando es del año en curso', () => {
  const mismoAno = formatSaleDate('2026-08-25', '2026-08-24');
  assert.match(mismoAno, /\bmar\b/);
  assert.match(mismoAno, /\b25\b/);
  assert.match(mismoAno, /\bago\b/);
  assert.doesNotMatch(mismoAno, /2026/);
  assert.equal(mismoAno, mismoAno.toLocaleLowerCase('es-PE'));

  assert.match(formatSaleDate('2025-12-31', '2026-08-24'), /2025/);
  assert.equal(formatSaleDate('', '2026-08-24'), 'Elegir fecha');
  assert.equal(formatSaleDate('25/08/2026', '2026-08-24'), 'Elegir fecha');
});

test('el resumen del comprobante dice qué se emitirá y con qué documento', () => {
  assert.equal(documentSummary(validSale()), 'Sin comprobante');
  assert.equal(
    documentSummary(validSale({ documentRequest: 'boleta', customerDocumentNumber: '12345678' })),
    'Boleta · DNI 12345678',
  );
  assert.equal(
    documentSummary(validSale({ documentRequest: 'boleta', boletaIdentity: 'ce', customerDocumentNumber: '001234567' })),
    'Boleta · CE 001234567',
  );
  assert.equal(
    documentSummary(validSale({
      documentRequest: 'factura',
      customerDocumentNumber: '20990001001',
      legalName: 'LIMBO PERU S.R.L.',
    })),
    'Factura · RUC 20990001001 · LIMBO PERU S.R.L.',
  );
});

test('el resumen del cliente traduce el origen y marca los datos vacíos', () => {
  const rows = customerSummaryRows(validSale());
  assert.equal(valueOf(rows, 'Origen'), 'WhatsApp');
  assert.equal(valueOf(rows, 'Nombre'), 'Ana Pérez');
  assert.equal(valueOf(rows, 'Teléfono'), '999111222');
  assert.equal(valueOf(rows, 'Comprobante'), 'Sin comprobante');

  const vacio = customerSummaryRows(validSale({ customerPhone: '  ' }));
  assert.equal(valueOf(vacio, 'Teléfono'), '—');
});

test('el resumen de entrega distingue envío de recojo en tienda', () => {
  const envio = deliverySummaryRows(validSale(), '2026-08-24');
  assert.equal(valueOf(envio, 'Modo'), 'Envío');
  assert.equal(valueOf(envio, 'Reparto'), 'Shaloom');
  assert.equal(valueOf(envio, 'Dirección'), 'Av. Primavera 123, Surco');
  assert.equal(valueOf(envio, 'Referencia'), 'Tocar timbre');

  const recojo = deliverySummaryRows(validSale({
    delivery: 'recojo',
    shippingCarrier: '',
    dropoffPlace: null,
    shippingNote: '',
  }), '2026-08-24');
  assert.equal(valueOf(recojo, 'Modo'), 'Recojo en tienda');
  assert.equal(valueOf(recojo, 'Tienda'), PICKUP_ADDRESS);
  assert.equal(valueOf(recojo, 'Reparto'), undefined);
  assert.equal(valueOf(recojo, 'Dirección'), undefined);
});

test('el resumen de entrega omite la referencia cuando el vendedor no escribió ninguna', () => {
  const rows = deliverySummaryRows(validSale({ shippingNote: '   ' }), '2026-08-24');
  assert.equal(valueOf(rows, 'Referencia'), undefined);
});

test('el resumen de pago solo muestra cobrador y constancia cuando aplican', () => {
  assert.deepEqual(paymentSummaryRows(validSale()), [{ label: 'Método', value: 'Después' }]);

  const efectivo = paymentSummaryRows(validSale({ paymentMethod: 'efectivo', receivedBy: 'Luis' }));
  assert.equal(valueOf(efectivo, 'Método'), 'Efectivo');
  assert.equal(valueOf(efectivo, 'Cobró'), 'Luis');

  const sinCobrador = paymentSummaryRows(validSale({ paymentMethod: 'efectivo', receivedBy: '' }));
  assert.equal(valueOf(sinCobrador, 'Cobró'), undefined);

  const yape = paymentSummaryRows(validSale({ paymentMethod: 'yape_plin' }));
  assert.equal(valueOf(yape, 'Constancia'), 'Sin adjuntar');

  const conFoto = paymentSummaryRows(validSale({
    paymentMethod: 'transferencia',
    paymentProof: { name: 'captura.jpg', type: 'image/jpeg', dataUrl: 'data:,' },
  }));
  assert.equal(valueOf(conFoto, 'Constancia'), 'captura.jpg');
});

test('el resumen agrupa cliente, entrega y pago apuntando a su paso del stepper', () => {
  const groups = saleSummaryGroups(validSale(), '2026-08-24');
  assert.deepEqual(groups.map((group) => group.step), ['cliente', 'entrega', 'pago']);
  assert.deepEqual(groups.map((group) => group.title), ['Cliente', 'Entrega', 'Pago']);
});

test('el desglose de totales cobra el envío una sola vez', () => {
  const sinEnvio = saleTotalRows(saleTotals(250, null));
  assert.equal(sinEnvio.length, 1);
  assert.equal(sinEnvio[0].label, 'Productos');
  assert.equal(money(sinEnvio[0].value), 'S/ 250.00');

  // Distrito y distancia son partes de un único cobro, no dos envíos.
  const conEnvio = saleTotalRows(
    saleTotals(250, { charged: true, districtAmount: 8, distanceAmount: 10 }),
    'San Miguel',
    4.32,
  );
  assert.equal(conEnvio.length, 2);
  assert.equal(conEnvio[0].label, 'Productos');
  assert.equal(conEnvio[1].label, 'Envío Express · San Miguel, 4,3 km');
  assert.equal(money(conEnvio[1].value), 'S/ 18.00');
});

test('la etiqueta de envío propio resume zona y distancia sin duplicar el cobro', () => {
  assert.equal(ownFleetShippingLabel('Lurigancho', 44.34), 'Envío Express · Lurigancho, 44,3 km');
  assert.equal(ownFleetShippingLabel('Lurigancho', 0), 'Envío Express · Lurigancho');
  assert.equal(ownFleetShippingLabel('', null), 'Envío Express');
  assert.equal(formatDistanceKm(44.34), '44,3 km');
  assert.equal(formatDistanceKm(0), '');
  assert.equal(formatDistanceKm(null), '');
});
