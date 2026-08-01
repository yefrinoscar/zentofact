import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupPickingScan, normalizeScannedCode } from './picking-scanner.js';

test('extrae un tracking desde texto o una URL escaneada', () => {
  assert.equal(normalizeScannedCode('240121000011723360'), '240121000011723360');
  assert.equal(
    normalizeScannedCode('https://app.example/armado?tracking=240121000011723360'),
    '240121000011723360',
  );
});

test('resuelve un tracking guardado y devuelve solo el bulto escaneado', async () => {
  const stored = {
    company_id: 3,
    company_name: 'INVERSIONES MANTA RAYA E.I.R.L.',
    order_id: '5004148908',
    order_number: '3246836553',
    status: 'ready_to_ship',
    falabella_created_at: '2026-08-01T11:33:14.000Z',
    falabella_updated_at: '2026-08-01T12:26:53.000Z',
    raw_data: {
      CustomerFirstName: 'Leslie',
      CustomerLastName: 'Barja',
      ShippingType: 'Dropshipping',
      Warehouse: { FacilityId: 'GSC-SC41A6D2695881D' },
      AddressShipping: { City: 'PACASMAYO', Ward: 'PACASMAYO', Region: 'LA LIBERTAD' },
    },
  };
  const db = {
    async query(sql) {
      if (sql.includes('where fo.order_number=$1')) return { rows: [] };
      if (sql.includes('from falabella_ticket_items') && sql.includes('match_type')) {
        return { rows: [{ company_id: 3, order_id: '5004148908', match_type: 'tracking' }] };
      }
      if (sql.includes('where fo.company_id=$1')) return { rows: [stored] };
      if (sql.includes('insert into falabella_ticket_items')) return { rows: [] };
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  const getOrderItems = async () => ({
    ok: true,
    orderItems: [{
      OrderItemId: '56748669',
      Name: 'Triturador USB',
      Sku: 'TRI65748392',
      ShopSku: '129633448',
      TrackingCode: '240121000011723360',
      PackageId: 'PKG00000JV2GA',
      Status: 'ready_to_ship',
    }],
    items: [{
      orderItemId: '56748669',
      name: 'Triturador USB',
      sellerSku: 'TRI65748392',
      shopSku: '129633448',
      quantity: 1,
      imageUrl: 'https://media.example/producto.jpg',
    }],
  });

  const result = await lookupPickingScan({
    db,
    getOrderItems,
    input: '240121000011723360',
  });

  assert.equal(result.scan.matchType, 'tracking');
  assert.equal(result.order.orderNumber, '3246836553');
  assert.equal(result.order.customerName, 'Leslie Barja');
  assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0].packageId, 'PKG00000JV2GA');
  assert.equal(result.packages[0].items[0].sellerSku, 'TRI65748392');
});
