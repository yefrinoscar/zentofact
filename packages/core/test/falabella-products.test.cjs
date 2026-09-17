const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL_POSTGRES ||= 'postgresql://test:test@127.0.0.1:5432/test';

const {
  falabellaProductStatusUpdateXml,
  falabellaStockUpdateXml,
  parseFalabellaXmlResponse,
} = require('../dist/services/falabella.service.js');

test('convierte productos XML de Falabella a la forma esperada por el catálogo', () => {
  const parsed = parseFalabellaXmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
    <SuccessResponse>
      <Head><RequestAction>GetProducts</RequestAction><TotalCount>2</TotalCount></Head>
      <Body><Products>
        <Product><SellerSku>SKU-1</SellerSku><Name>Producto uno</Name></Product>
        <Product><SellerSku>SKU-2</SellerSku><Name>Producto dos</Name></Product>
      </Products></Body>
    </SuccessResponse>`);

  assert.equal(parsed.SuccessResponse.Head.TotalCount, '2');
  assert.deepEqual(
    parsed.SuccessResponse.Body.Products.Product.map((product) => product.SellerSku),
    ['SKU-1', 'SKU-2'],
  );
});

test('conserva un único producto XML como objeto', () => {
  const parsed = parseFalabellaXmlResponse(
    '<SuccessResponse><Body><Products><Product><SellerSku>ONLY-1</SellerSku></Product></Products></Body></SuccessResponse>',
  );

  assert.equal(parsed.SuccessResponse.Body.Products.Product.SellerSku, 'ONLY-1');
});

test('rechaza la página HTML que Falabella devuelve de manera transitoria', () => {
  assert.throws(
    () => parseFalabellaXmlResponse('<!DOCTYPE html><html><body>upstream error</body></html>'),
    /página web en lugar del catálogo/,
  );
});

test('rechaza documentos que no son una respuesta de Seller Center', () => {
  assert.throws(
    () => parseFalabellaXmlResponse('<!-- proxy --><html><body>upstream error</body></html>'),
    /respuesta de catálogo inválida/,
  );
});

test('arma ProductUpdate mínimo para publicar o despublicar en Perú', () => {
  const xml = falabellaProductStatusUpdateXml({
    sellerSku: 'SKU<&>',
    status: 'inactive',
  });

  assert.match(xml, /<SellerSku>SKU&lt;&amp;&gt;<\/SellerSku>/);
  assert.match(xml, /<OperatorCode>fape<\/OperatorCode>/);
  assert.match(xml, /<Status>inactive<\/Status>/);
});

test('arma el XML requerido por UpdateStock sin tocar FBF', () => {
  const xml = falabellaStockUpdateXml({
    sellerSku: 'SKU-1',
    quantity: 17,
    facilityId: 'GSC-PE-1',
  });

  assert.match(xml, /<GSCFacilityId>GSC-PE-1<\/GSCFacilityId>/);
  assert.match(xml, /<SellerSku>SKU-1<\/SellerSku>/);
  assert.match(xml, /<Quantity>17<\/Quantity>/);
  assert.doesNotMatch(xml, /Fulfillment/i);
});
