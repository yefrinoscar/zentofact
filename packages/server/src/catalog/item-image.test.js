import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETPLACE_RAW_IMAGE_SQL, marketplaceItemImageUrl } from './item-image.js';

test('lee la foto de Ripley en product_medias de Mirakl', () => {
  assert.equal(marketplaceItemImageUrl({
    product_medias: [
      { type: 'SMALL', mime_type: 'image/jpeg', media_url: 'https://home.ripley.com.pe/desk.jpg' },
    ],
  }), 'https://home.ripley.com.pe/desk.jpg');
});

test('prefiere dam_url de P11 cuando viene como objeto', () => {
  assert.equal(marketplaceItemImageUrl({
    product_media: {
      dam_url: 'https://dam.ripley.test/p.jpg',
      media_url: 'https://media.ripley.test/p.jpg',
    },
  }), 'https://dam.ripley.test/p.jpg');
});

test('conserva Image de Falabella por encima de Ripley', () => {
  assert.equal(marketplaceItemImageUrl({
    Image: 'https://media.falabella.com/falabellaPE/1_01',
    product_medias: [{ media_url: 'https://home.ripley.com.pe/other.jpg' }],
  }), 'https://media.falabella.com/falabellaPE/1_01');
});

test('el SQL de la bandeja y la cola lee product_medias', () => {
  assert.match(MARKETPLACE_RAW_IMAGE_SQL, /product_medias/);
  assert.match(MARKETPLACE_RAW_IMAGE_SQL, /media_url/);
  assert.match(MARKETPLACE_RAW_IMAGE_SQL, /dam_url/);
});
