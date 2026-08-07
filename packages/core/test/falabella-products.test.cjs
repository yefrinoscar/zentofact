const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL_POSTGRES ||= 'postgresql://test:test@127.0.0.1:5432/test';

const { parseFalabellaXmlResponse } = require('../dist/services/falabella.service.js');

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
