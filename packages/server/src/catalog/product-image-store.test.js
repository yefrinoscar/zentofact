import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_IMAGE_ROUTE,
  decodeUploadedImage,
  detectProductImageMime,
  isOwnProductImageUrl,
  mirrorProductImage,
  readOwnProductImageUrl,
  storeProductImage,
} from './product-image-store.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 9]);

function memoryStorage() {
  const files = new Map();
  return {
    files,
    async save(key, bytes, contentType) { files.set(key, { bytes: Buffer.from(bytes), contentType }); return key; },
    async read(key) {
      if (!files.has(key)) throw new Error('Archivo no encontrado');
      return files.get(key).bytes;
    },
  };
}

test('guarda la foto en el almacenamiento propio con una URL por contenido', async () => {
  const storage = memoryStorage();
  const stored = await storeProductImage(145, PNG, { storage });
  assert.match(stored.url, /^\/catalog\/product-images\/145\/[a-f0-9]{24}\.png$/);
  assert.equal(stored.mimeType, 'image/png');
  const [[key, file]] = [...storage.files];
  assert.equal(key, `product-images/${stored.url.slice(PRODUCT_IMAGE_ROUTE.length)}`);
  assert.equal(file.contentType, 'image/png');
  assert.ok(isOwnProductImageUrl(stored.url));

  const again = await storeProductImage(145, PNG, { storage });
  assert.equal(again.url, stored.url);

  const read = await readOwnProductImageUrl(stored.url, { storage });
  assert.equal(read.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(read.bytes), PNG);
});

test('rechaza archivos que no son PNG, JPEG o WEBP y fotos vacías', async () => {
  const storage = memoryStorage();
  await assert.rejects(storeProductImage(1, Buffer.from('<svg></svg>xxxxx'), { storage }), /PNG, JPEG o WEBP/);
  await assert.rejects(storeProductImage(1, Buffer.alloc(0), { storage }), /vacía/);
  await assert.rejects(storeProductImage('x', PNG, { storage }), /productId/);
  assert.equal(storage.files.size, 0);
});

test('solo reconoce rutas propias válidas', async () => {
  assert.equal(isOwnProductImageUrl('https://media.falabella.com/falabellaPE/123_01'), false);
  assert.equal(isOwnProductImageUrl('/catalog/product-images/1/../../secret.png'), false);
  assert.equal(isOwnProductImageUrl('/catalog/product-images/1/abc.png'), false);
  await assert.rejects(readOwnProductImageUrl('/catalog/product-images/1/../x.png', { storage: memoryStorage() }), /no encontrada/);
});

test('decodifica la foto subida como data URL o base64 simple', () => {
  const dataUrl = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
  assert.deepEqual(decodeUploadedImage({ dataBase64: dataUrl }), JPEG);
  assert.deepEqual(decodeUploadedImage({ dataBase64: JPEG.toString('base64') }), JPEG);
  assert.equal(detectProductImageMime(JPEG), 'image/jpeg');
  assert.throws(() => decodeUploadedImage({}), /dataBase64/);
});

test('copia una foto externa y no vuelve a copiar una propia', async () => {
  const storage = memoryStorage();
  const downloads = [];
  const download = async (url) => { downloads.push(url); return { bytes: JPEG }; };
  const mirrored = await mirrorProductImage(9, 'https://media.falabella.com/falabellaPE/156500234_01', { storage, download });
  assert.equal(mirrored.mirrored, true);
  assert.match(mirrored.url, /^\/catalog\/product-images\/9\/[a-f0-9]{24}\.jpg$/);
  const again = await mirrorProductImage(9, mirrored.url, { storage, download });
  assert.equal(again.mirrored, false);
  assert.deepEqual(downloads, ['https://media.falabella.com/falabellaPE/156500234_01']);
});
