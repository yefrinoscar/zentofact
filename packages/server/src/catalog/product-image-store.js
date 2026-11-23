// Fotos propias de productos: se guardan en el mismo almacenamiento del sistema
// (proxy R2, R2 directo o disco local) y se sirven desde el API, para no depender
// de que Falabella o Ripley mantengan publicada la imagen.
import { createHash } from 'node:crypto';
import { httpError, loadCore } from './utils.js';

export const PRODUCT_IMAGE_ROUTE = '/catalog/product-images/';
export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;

const STORAGE_PREFIX = 'product-images/';
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MIME_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const OWN_IMAGE_PATH = /^(\d+)\/([a-f0-9]{24})\.(png|jpg|webp)$/;

export function detectProductImageMime(bytes) {
  if (!bytes || bytes.length < 12) return '';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return '';
}

/** Ruta relativa del archivo dentro de la URL propia, o '' si la URL no es una foto propia. */
export function ownProductImagePath(url) {
  const value = String(url || '').trim();
  if (!value.startsWith(PRODUCT_IMAGE_ROUTE)) return '';
  const rest = value.slice(PRODUCT_IMAGE_ROUTE.length).split(/[?#]/)[0];
  return OWN_IMAGE_PATH.test(rest) ? rest : '';
}

export function isOwnProductImageUrl(url) {
  return Boolean(ownProductImagePath(url));
}

async function defaultStorage() {
  const core = await loadCore();
  return { save: core.saveStoredObject, read: core.readStoredObject };
}

/** Guarda los bytes de una foto y devuelve la URL propia que se graba en products.image_url. */
export async function storeProductImage(productIdInput, bytesInput, deps = {}) {
  const productId = Number(productIdInput);
  if (!Number.isSafeInteger(productId) || productId <= 0) throw httpError('productId inválido.', 400);
  const bytes = Buffer.isBuffer(bytesInput) ? bytesInput : Buffer.from(bytesInput || []);
  if (!bytes.length) throw httpError('La foto llegó vacía.', 400);
  if (bytes.length > MAX_PRODUCT_IMAGE_BYTES) throw httpError('La foto pesa más de 8 MB.', 413);
  const mimeType = detectProductImageMime(bytes);
  if (!mimeType) throw httpError('La foto debe ser PNG, JPEG o WEBP.', 415);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const file = `${productId}/${hash}.${EXTENSIONS[mimeType]}`;
  const storage = deps.storage || await defaultStorage();
  await storage.save(`${STORAGE_PREFIX}${file}`, bytes, mimeType);
  return { url: `${PRODUCT_IMAGE_ROUTE}${file}`, mimeType, bytes: bytes.length };
}

/** Lee una foto propia a partir de su ruta (`<productId>/<hash>.<ext>`). */
export async function readProductImage(pathInput, deps = {}) {
  const file = String(pathInput || '');
  const match = OWN_IMAGE_PATH.exec(file);
  if (!match) throw httpError('Foto no encontrada.', 404);
  const storage = deps.storage || await defaultStorage();
  let bytes;
  try {
    bytes = await storage.read(`${STORAGE_PREFIX}${file}`);
  } catch {
    throw httpError('Foto no encontrada.', 404);
  }
  return { bytes: new Uint8Array(bytes), mimeType: MIME_BY_EXTENSION[match[3]] };
}

/** Lee una foto propia a partir de su URL (para PDFs y etiquetas). */
export function readOwnProductImageUrl(url, deps = {}) {
  return readProductImage(ownProductImagePath(url), deps);
}

export function decodeUploadedImage(input = {}) {
  const raw = String(input.dataBase64 || input.data || '').trim();
  const base64 = raw.includes(',') && raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!base64) throw httpError('Envía la foto en dataBase64.', 400);
  if (base64.length > Math.ceil(MAX_PRODUCT_IMAGE_BYTES / 3) * 4 + 4) throw httpError('La foto pesa más de 8 MB.', 413);
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw httpError('dataBase64 no es válido.', 400);
  return Buffer.from(base64, 'base64');
}

/**
 * Copia una foto externa (Falabella, Ripley, etc.) al almacenamiento propio.
 * `download` debe validar la URL (HTTPS, sin redes privadas) y devolver { bytes }.
 */
export async function mirrorProductImage(productId, sourceUrl, deps) {
  if (isOwnProductImageUrl(sourceUrl)) return { url: sourceUrl, mirrored: false };
  const { bytes } = await deps.download(sourceUrl);
  const stored = await storeProductImage(productId, bytes, deps);
  return { ...stored, mirrored: true };
}
