import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PICKUP_ADDRESS,
  buildManualSaleOrderPayload,
  formatProductStock,
  generateManualOrderNumber,
  limaDateToIso,
  limaTodayKey,
  productPrice,
  productStock,
  saleLinesTotal,
  validateManualSale,
} from './registrar-venta.ts';

const baseLine = {
  id: 'line-1',
  productId: 44,
  sku: 'AG3',
  name: 'Silla rosa',
  catalogPrice: 250,
  unitPrice: 250,
  quantity: 1,
};

function validSale(overrides = {}) {
  return {
    channelAccountId: 22,
    customerName: 'Ana',
    customerPhone: '999111222',
    lines: [baseLine],
    delivery: 'envio',
    deliveryDate: '2026-08-25',
    shippingCarrier: 'shaloom',
    dropoffPlace: {
      label: 'Av. Primavera 123, Surco',
      district: 'Surco',
      lat: -12.1,
      lng: -77.0,
    },
    shippingNote: 'Tocar timbre',
    saleSource: 'whatsapp',
    paymentMethod: 'despues',
    orderedAt: '2026-08-24T15:00:00.000Z',
    orderNumber: '2608241500',
    ...overrides,
  };
}

test('el precio de venta prioriza el mínimo seller sobre el de referencia', () => {
  assert.equal(productPrice({
    id: 1,
    mainSku: 'A',
    name: 'X',
    sellerPriceMin: 120,
    referencePrice: 200,
  }), 120);
  assert.equal(productPrice({
    id: 1,
    mainSku: 'A',
    name: 'X',
    referencePrice: 200,
  }), 200);
  assert.equal(productPrice({
    id: 1,
    mainSku: 'A',
    name: 'X',
    sellerPriceMin: 0,
    referencePrice: null,
  }), 0);
});

test('el stock del modal usa available y formatea unidades', () => {
  assert.equal(productStock({ id: 1, mainSku: 'A', name: 'X', available: 12 }), 12);
  assert.equal(productStock({ id: 1, mainSku: 'A', name: 'X', available: 0 }), 0);
  assert.equal(productStock({ id: 1, mainSku: 'A', name: 'X', available: null }), 0);
  assert.equal(formatProductStock({ id: 1, mainSku: 'A', name: 'X', available: 12 }), '12 u');
  assert.equal(formatProductStock({ id: 1, mainSku: 'A', name: 'X', available: 0 }), '0 u');
});

test('limaTodayKey usa el calendario de Lima, no UTC', () => {
  // 2026-08-25 02:30 UTC = 2026-08-24 21:30 Lima
  assert.equal(limaTodayKey(new Date('2026-08-25T02:30:00.000Z')), '2026-08-24');
  assert.equal(limaTodayKey(new Date('2026-08-25T12:00:00.000Z')), '2026-08-25');
});

test('limaDateToIso fija mediodía Lima para la fecha de entrega', () => {
  assert.equal(limaDateToIso('2026-08-25'), '2026-08-25T12:00:00-05:00');
  assert.throws(() => limaDateToIso('25/08/2026'), /Fecha de entrega inválida/);
});

test('el número de venta manual tiene 10 dígitos como Falabella/Ripley', () => {
  const number = generateManualOrderNumber(new Date('2026-08-24T20:00:00.000Z'), () => 0.42);
  assert.match(number, /^\d{10}$/);
  assert.equal(number.slice(0, 6), '260824');
  assert.equal(number.slice(6), '4200');
});

test('buildManualSaleOrderPayload genera un pedido de 10 dígitos si no viene orderNumber', () => {
  const { orderNumber: _omit, ...sale } = validSale();
  const payload = buildManualSaleOrderPayload(sale);
  assert.match(payload.externalOrderNumber, /^\d{10}$/);
  assert.equal(payload.externalOrderId, payload.externalOrderNumber);
});

test('saleLinesTotal suma precio por cantidad', () => {
  assert.equal(saleLinesTotal([
    { ...baseLine, unitPrice: 100, quantity: 2 },
    { ...baseLine, id: '2', unitPrice: 50, quantity: 1 },
  ]), 250);
});

test('validateManualSale exige canal, cliente, productos, fecha y datos de envío', () => {
  assert.equal(validateManualSale(validSale({ channelAccountId: null })), 'Todavía no hay un canal de venta manual habilitado.');
  assert.equal(validateManualSale(validSale({ customerName: '  ' })), 'Escribe el nombre del cliente.');
  assert.equal(validateManualSale(validSale({ lines: [] })), 'Agrega al menos un producto.');
  assert.equal(
    validateManualSale(validSale({ lines: [{ ...baseLine, quantity: 0 }] })),
    'Revisa cantidad y precio de cada producto.',
  );
  assert.equal(validateManualSale(validSale({ deliveryDate: '' })), 'Indica la fecha de entrega.');
  assert.equal(
    validateManualSale(validSale({ shippingCarrier: '' })),
    'Elige el reparto: Marvisuar, Shaloom, Dinsides o Nosotros.',
  );
  assert.equal(
    validateManualSale(validSale({ dropoffPlace: null })),
    'Busca el distrito o el departamento de envío.',
  );
  assert.equal(validateManualSale(validSale()), null);
});

test('validateManualSale permite recojo sin repartidor ni mapa', () => {
  assert.equal(validateManualSale(validSale({
    delivery: 'recojo',
    shippingCarrier: '',
    dropoffPlace: null,
  })), null);
});

test('buildManualSaleOrderPayload incluye fecha de entrega y promisedShippingAt', () => {
  const payload = buildManualSaleOrderPayload(validSale());

  assert.equal(payload.promisedShippingAt, '2026-08-25T12:00:00-05:00');
  assert.equal(payload.metadata.deliveryDate, '2026-08-25');
  assert.equal(payload.metadata.origin, 'manual_ui');
  assert.equal(payload.fulfillmentStatus, 'ready_to_ship');
  assert.equal(payload.paymentStatus, 'pending');
  assert.equal(payload.shipping.type, 'envio');
  assert.equal(payload.shipping.carrier, 'shaloom');
  assert.equal(payload.shipping.address, 'Av. Primavera 123, Surco');
  assert.equal(payload.shipping.reference, 'Tocar timbre');
  assert.deepEqual(payload.items[0].metadata, { productId: 44, catalogPrice: 250 });
  assert.equal(payload.customer.phone, '999111222');
});

test('buildManualSaleOrderPayload en recojo usa la dirección de tienda', () => {
  const payload = buildManualSaleOrderPayload(validSale({
    delivery: 'recojo',
    shippingCarrier: '',
    dropoffPlace: null,
  }));

  assert.equal(payload.shipping.type, 'recojo');
  assert.equal(payload.shipping.carrier, undefined);
  assert.equal(payload.shipping.address, PICKUP_ADDRESS);
  assert.equal(payload.metadata.shippingCarrier, '');
});

test('buildManualSaleOrderPayload marca pagado cuando el cobro no es después', () => {
  const payload = buildManualSaleOrderPayload(validSale({
    paymentMethod: 'efectivo',
    receivedBy: 'Luis',
  }));

  assert.equal(payload.paymentStatus, 'paid');
  assert.equal(payload.metadata.receivedBy, 'Luis');
});

test('regresión: la venta manual siempre envía fecha de entrega al backend', () => {
  assert.throws(
    () => buildManualSaleOrderPayload(validSale({ deliveryDate: '' })),
    /Indica la fecha de entrega/,
  );

  const payload = buildManualSaleOrderPayload(validSale({ deliveryDate: '2026-08-26' }));
  assert.ok(payload.promisedShippingAt, 'promisedShippingAt no puede faltar');
  assert.equal(payload.metadata.deliveryDate, '2026-08-26');
});

test('Nosotros suma distrito y distancia al total de la venta', () => {
  const payload = buildManualSaleOrderPayload(validSale({
    shippingCarrier: 'nosotros',
    dropoffPlace: {
      label: 'Av. La Marina 2055, San Miguel',
      district: 'San Miguel',
      province: 'Lima',
      department: 'Lima',
      lat: -12.0776,
      lng: -77.0905,
    },
  }));

  assert.equal(payload.subtotal, 250);
  assert.equal(payload.shippingAmount, 18);
  assert.equal(payload.total, 268);
  assert.equal(payload.shipping.carrier, 'nosotros');
  assert.equal(payload.shipping.districtAmount, 8);
  assert.equal(payload.shipping.distanceAmount, 10);
  assert.equal(payload.shipping.zoneKind, 'lima_district');
  assert.equal(payload.shipping.district, 'San Miguel');
});

test('Nosotros persiste el distrito del pin aunque la búsqueda diga otro', () => {
  const payload = buildManualSaleOrderPayload(validSale({
    shippingCarrier: 'nosotros',
    dropoffPlace: {
      label: 'San Miguel, Lima 15047',
      district: 'San Miguel',
      province: 'Lima',
      department: 'Lima',
      lat: -12.114,
      lng: -77.021,
    },
  }));
  assert.equal(payload.shipping.district, 'Surquillo');
  assert.equal(payload.shipping.districtAmount, 12);
  assert.equal(payload.shipping.zoneLabel, 'Surquillo');
});

test('un repartidor tercero no cobra envío propio', () => {
  const payload = buildManualSaleOrderPayload(validSale());
  assert.equal(payload.shippingAmount, null);
  assert.equal(payload.total, 250);
});

test('regresión: el modal de productos muestra stock aunque sea cero', () => {
  assert.equal(formatProductStock({ id: 1, mainSku: 'A', name: 'X', available: 0 }), '0 u');
  assert.notEqual(formatProductStock({ id: 1, mainSku: 'A', name: 'X', available: 3 }), '');
});
