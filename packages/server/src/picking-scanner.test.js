import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { attachShippingLabelTrackingCodes, lookupPickingScan, normalizeScannedCode, saveFalabellaTicketSnapshot } from './picking-scanner.js';

test('extrae un tracking desde texto o una URL escaneada', () => {
  assert.equal(normalizeScannedCode('240121000011723360'), '240121000011723360');
  assert.equal(
    normalizeScannedCode('https://app.example/armado?tracking=240121000011723360'),
    '240121000011723360',
  );
});

test('asocia el tracking impreso con los artículos de un pedido pendiente', () => {
  const inventory = attachShippingLabelTrackingCodes({
    ok: true,
    orderItems: [{ OrderItemId: '1', PackageId: 'PKG-1' }],
    items: [{ orderItemId: '1', packageId: 'PKG-1' }],
  }, ['240121000011894785']);

  assert.equal(inventory.orderItems[0].TrackingCode, '240121000011894785');
});

test('recupera una etiqueta pendiente ya impresa leyendo el tracking de su PDF', async () => {
  const stored = {
    company_id: 3,
    company_name: 'STINGRAY',
    order_id: '5005000001',
    order_number: '3248342012',
    status: 'pending',
    raw_data: {},
  };
  const db = {
    async query(sql) {
      if (sql.includes('where fo.order_number=$1')) return { rows: [] };
      if (sql.includes('from falabella_ticket_items') && sql.includes('match_type')) return { rows: [] };
      if (sql.includes('from falabella_label_prints')) return { rows: [{ company_id: 3, order_id: stored.order_id, order_number: stored.order_number }] };
      if (sql.includes('where fo.company_id=$1')) return { rows: [stored] };
      if (sql.includes('from falabella_product_variants')) return { rows: [] };
      if (sql.includes('insert into falabella_product_variants')) return { rows: [] };
      if (sql.includes('insert into falabella_ticket_items')) return { rows: [] };
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  const getOrderItems = async () => ({
    ok: true,
    orderItems: [{ OrderItemId: '1', PackageId: 'PKG-1', Name: 'Bolso' }],
    items: [{ orderItemId: '1', packageId: 'PKG-1', name: 'Bolso', quantity: 1 }],
  });
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]).drawText('240121000011894785');
  const getShippingLabel = async () => ({
    ok: true,
    base64: Buffer.from(await pdf.save()).toString('base64'),
  });

  const result = await lookupPickingScan({
    db,
    getOrderItems,
    getShippingLabel,
    input: '240121000011894785',
  });

  assert.equal(result.order.orderNumber, '3248342012');
  assert.equal(result.scan.matchType, 'tracking');
  assert.equal(result.packages[0].trackingCode, '240121000011894785');
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
      if (sql.includes('insert into falabella_product_variants')) return { rows: [] };
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
      variation: { color: 'Negro', size: 'XL', label: 'Negro · XL', source: 'catalog-name' },
      color: 'Negro',
      size: 'XL',
      variantLabel: 'Negro · XL',
      variantSource: 'catalog-name',
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
  assert.equal(result.packages[0].items[0].color, 'Negro');
  assert.equal(result.packages[0].items[0].size, 'XL');
  assert.equal(result.packages[0].items[0].variantLabel, 'Negro · XL');
});

test('recupera color y talla del caché por SKU cuando Falabella responde sin variante', async () => {
  let savedItem = null;
  const db = {
    async query(sql, params) {
      if (sql.includes('from falabella_product_variants')) {
        assert.deepEqual(params, [2, ['CM22121111'], ['140704030']]);
        return {
          rows: [{
            seller_sku: 'CM22121111',
            shop_sku: '140704030',
            color: 'Negro',
            size: 'M',
            variant_label: 'Negro · M',
            source: 'catalog',
          }],
        };
      }
      if (sql.includes('insert into falabella_product_variants')) return { rows: [] };
      if (sql.includes('insert into falabella_ticket_items')) {
        savedItem = JSON.parse(params[6]).item;
        return { rows: [] };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  const inventory = {
    ok: true,
    orderItems: [{
      OrderItemId: '56749999',
      Name: 'Camiseta Faja Reductora',
      Sku: 'CM22121111',
      ShopSku: '140704030',
      TrackingCode: '240121000011760976',
      PackageId: 'PKG-1',
    }],
    items: [{
      orderItemId: '56749999',
      name: 'Camiseta Faja Reductora',
      sellerSku: 'CM22121111',
      shopSku: '140704030',
      quantity: 1,
      color: '',
      size: '',
      variantLabel: '',
      variantSource: '',
    }],
  };

  const items = await saveFalabellaTicketSnapshot(db, {
    companyId: 2,
    orderId: '5004241698',
    orderNumber: '3247341646',
  }, inventory);

  assert.equal(items[0].color, 'Negro');
  assert.equal(items[0].size, 'M');
  assert.equal(items[0].variantLabel, 'Negro · M');
  assert.equal(savedItem.color, 'Negro');
  assert.equal(savedItem.size, 'M');
});
