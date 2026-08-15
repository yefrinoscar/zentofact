import test from 'node:test';
import assert from 'node:assert/strict';
import { falabellaProductUrl } from './marketplace-url.ts';

const productUrl = 'https://www.falabella.com.pe/falabella-pe/product/144957151/Cuadro-Decorativo-Metalico-Dorado-3D-Pared-sala-Moderna/144957152';

test('uses the official Falabella product URL from listing metadata', () => {
  assert.equal(falabellaProductUrl('falabella', { url: productUrl }), productUrl);
});

test('does not invent or expose an unsafe marketplace URL', () => {
  assert.equal(falabellaProductUrl('falabella', {}), null);
  assert.equal(falabellaProductUrl('falabella', { url: 'http://www.falabella.com.pe/product/1' }), null);
  assert.equal(falabellaProductUrl('falabella', { url: 'https://falabella.com.pe.example.com/product/1' }), null);
  assert.equal(falabellaProductUrl('ripley', { url: productUrl }), null);
});
