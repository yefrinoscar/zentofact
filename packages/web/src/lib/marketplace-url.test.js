import test from 'node:test';
import assert from 'node:assert/strict';
import { marketplaceProductUrl } from './marketplace-url.ts';

const productUrl = 'https://www.falabella.com.pe/falabella-pe/product/144957151/Cuadro-Decorativo-Metalico-Dorado-3D-Pared-sala-Moderna/144957152';

test('uses the official Falabella product URL from listing metadata', () => {
  assert.equal(marketplaceProductUrl({ channelCode: 'falabella', metadata: { url: productUrl } }), productUrl);
});

test('does not invent or expose an unsafe marketplace URL', () => {
  assert.equal(marketplaceProductUrl({ channelCode: 'falabella', metadata: {} }), null);
  assert.equal(marketplaceProductUrl({ channelCode: 'falabella', metadata: { url: 'http://www.falabella.com.pe/product/1' } }), null);
  assert.equal(marketplaceProductUrl({ channelCode: 'falabella', metadata: { url: 'https://falabella.com.pe.example.com/product/1' } }), null);
});

test('builds the public Ripley product URL from its product SKU and title', () => {
  assert.equal(
    marketplaceProductUrl({
      channelCode: 'ripley',
      title: 'Aquashoes Zapatos para Piscina, Playa - Talla 36 a 41',
      shopSku: 'PMP00001948462-1',
    }),
    'https://simple.ripley.com.pe/aquashoes-zapatos-para-piscina-playa-talla-36-a-41-pmp00001948462',
  );
});

test('does not build a Ripley URL without an official product SKU and title', () => {
  assert.equal(marketplaceProductUrl({ channelCode: 'ripley', title: 'Producto', shopSku: 'ESC-1058777' }), null);
  assert.equal(marketplaceProductUrl({ channelCode: 'ripley', title: '', shopSku: 'PMP00001948462-1' }), null);
  assert.equal(marketplaceProductUrl({ channelCode: 'externo', title: 'Producto', shopSku: 'PMP00001948462-1' }), null);
});
