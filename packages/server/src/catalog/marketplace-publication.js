import { finiteNumber, httpError, jsonObject, loadCore, positiveInt } from './utils.js';
import { updateListingPublicationState, updateListingSellerStock } from './listing-service.js';
import { falabellaPublicationState } from './listing-snapshot-service.js';

export const MARKETPLACE_PUBLICATION_MUTATION_ENV = 'MARKETPLACE_PUBLICATION_MUTATION_ENABLED';

export function marketplacePublicationMutationEnabled(env = process.env) {
  const value = String(env[MARKETPLACE_PUBLICATION_MUTATION_ENV] ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function mutationEnabled(value) {
  return typeof value === 'boolean' ? value : marketplacePublicationMutationEnabled(value);
}

export function assertMarketplacePublicationMutationEnabled(value = process.env) {
  if (mutationEnabled(value)) return;
  throw httpError(
    'La escritura a Falabella está desactivada en Configuración del sistema.',
    409,
    'marketplace_mutation_disabled',
  );
}

export async function createMarketplaceProduct(createProduct, payload, enabled = process.env) {
  assertMarketplacePublicationMutationEnabled(enabled);
  return createProduct(payload);
}

function wholeQuantity(value) {
  const quantity = finiteNumber(value, 'quantity');
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw httpError('El stock debe ser un entero mayor o igual a 0.');
  }
  return quantity;
}

function falabellaErrorMessage(result, fallback) {
  const message = result?.error?.Head?.ErrorMessage
    || result?.error?.message
    || (typeof result?.error === 'string' ? result.error : '');
  return String(message || fallback);
}

function assertFalabellaAccepted(result, action) {
  if (result?.ok === true) return;
  throw httpError(
    falabellaErrorMessage(result, `Falabella no aceptó ${action}.`),
    502,
    'falabella_mutation_failed',
  );
}

async function listingForMutation(idInput, db) {
  const target = db || (await loadCore()).pool;
  const id = positiveInt(idInput, 'listingId');
  const listing = (await target.query(
    "select * from product_listings where id=$1 and status <> 'unlinked'",
    [id],
  )).rows[0];
  if (!listing) throw httpError('Publicación no encontrada.', 404);
  if (String(listing.channel_code).toLowerCase() !== 'falabella') {
    throw httpError('Esta acción solo está disponible para publicaciones Falabella.', 400);
  }
  return { id, listing, target };
}

function listingFacilityId(listing) {
  const warehouses = jsonObject(listing.metadata).sellerWarehouses;
  if (!Array.isArray(warehouses) || warehouses.length !== 1) return null;
  const warehouse = jsonObject(warehouses[0]);
  return String(warehouse.facilityId || warehouse.FacilityID || '').trim() || null;
}

const DEFAULT_CONFIRMATION_ATTEMPTS = 30;
const DEFAULT_CONFIRMATION_INTERVAL_MS = 2_000;

function sameSellerSku(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function providerError(response) {
  return response?.error?.Head?.ErrorMessage
    || response?.error?.message
    || (typeof response?.error === 'string' ? response.error : '');
}

function confirmationOptions(dependencies) {
  const requestedAttempts = Number(dependencies.confirmationAttempts ?? DEFAULT_CONFIRMATION_ATTEMPTS);
  const attempts = Number.isInteger(requestedAttempts)
    ? Math.min(Math.max(requestedAttempts, 1), DEFAULT_CONFIRMATION_ATTEMPTS)
    : DEFAULT_CONFIRMATION_ATTEMPTS;
  return {
    attempts,
    wait: typeof dependencies.wait === 'function'
      ? dependencies.wait
      : () => new Promise((resolve) => setTimeout(resolve, DEFAULT_CONFIRMATION_INTERVAL_MS)),
  };
}

async function confirmSellerStock({ companyId, sellerSku, quantity, getStock, dependencies }) {
  if (typeof getStock !== 'function') throw new Error('Falta el adaptador GetStock de Falabella.');
  const { attempts, wait } = confirmationOptions(dependencies);
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await getStock({ companyId, sellerSkus: [sellerSku], limit: 1 });
    lastError = providerError(response);
    if (!lastError && response?.ok !== false) {
      const stock = (Array.isArray(response?.stocks) ? response.stocks : [])
        .find((candidate) => sameSellerSku(candidate?.sellerSku, sellerSku));
      if (stock && Number(stock.sellerWarehouseQuantity) === quantity) {
        return { stock, attempts: attempt };
      }
    }
    if (attempt < attempts) await wait();
  }
  throw httpError(
    lastError
      ? `Falabella aceptó el cambio, pero GetStock falló al confirmarlo: ${lastError}`
      : `Falabella aceptó el cambio, pero GetStock no confirmó ${quantity} unidades para ${sellerSku}.`,
    504,
    'falabella_mutation_unconfirmed',
  );
}

async function confirmPublicationStatus({ companyId, sellerSku, visible, getProducts, dependencies }) {
  if (typeof getProducts !== 'function') throw new Error('Falta el adaptador GetProducts de Falabella.');
  const { attempts, wait } = confirmationOptions(dependencies);
  const expectedStatus = visible ? 'active' : 'inactive';
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await getProducts({
      companyId,
      filters: { filter: 'all', skuSellerList: [sellerSku], limit: 1 },
    });
    lastError = providerError(response);
    if (!lastError && response?.ok !== false) {
      const product = (Array.isArray(response?.products) ? response.products : [])
        .find((candidate) => sameSellerSku(candidate?.sellerSku, sellerSku));
      if (product && falabellaPublicationState(product).businessUnitStatus === expectedStatus) {
        return { product, attempts: attempt };
      }
    }
    if (attempt < attempts) await wait();
  }
  throw httpError(
    lastError
      ? `Falabella aceptó el cambio, pero GetProducts falló al confirmarlo: ${lastError}`
      : `Falabella aceptó el cambio, pero GetProducts no confirmó el estado ${expectedStatus} para ${sellerSku}.`,
    504,
    'falabella_mutation_unconfirmed',
  );
}

export async function updateMarketplaceSellerStock(idInput, input, dependencies = {}) {
  assertMarketplacePublicationMutationEnabled(dependencies.enabled);
  const quantity = wholeQuantity(input.quantity);
  const { id, listing, target } = await listingForMutation(idInput, dependencies.db);
  const updateStock = dependencies.updateStock;
  if (typeof updateStock !== 'function') throw new Error('Falta el adaptador UpdateStock de Falabella.');
  const result = await updateStock({
    companyId: Number(listing.company_id),
    sellerSku: String(listing.seller_sku),
    quantity,
    facilityId: listingFacilityId(listing),
  });
  assertFalabellaAccepted(result, 'la actualización de stock');
  const confirmation = await confirmSellerStock({
    companyId: Number(listing.company_id),
    sellerSku: String(listing.seller_sku),
    quantity,
    getStock: dependencies.getStock,
    dependencies,
  });
  const saved = await updateListingSellerStock(id, {
    quantity,
    requestId: result.requestId,
  }, target);
  return {
    listing: saved,
    requestId: result.requestId || null,
    submitted: true,
    confirmed: true,
    confirmationAttempts: confirmation.attempts,
  };
}

export async function updateMarketplacePublication(idInput, input, dependencies = {}) {
  assertMarketplacePublicationMutationEnabled(dependencies.enabled);
  if (typeof input.visible !== 'boolean') throw httpError('visible debe ser true o false.');
  const { id, listing, target } = await listingForMutation(idInput, dependencies.db);
  const updateStatus = dependencies.updateStatus;
  if (typeof updateStatus !== 'function') throw new Error('Falta el adaptador ProductUpdate de Falabella.');
  const result = await updateStatus({
    companyId: Number(listing.company_id),
    sellerSku: String(listing.seller_sku),
    status: input.visible ? 'active' : 'inactive',
  });
  assertFalabellaAccepted(result, input.visible ? 'la publicación' : 'la despublicación');
  const confirmation = await confirmPublicationStatus({
    companyId: Number(listing.company_id),
    sellerSku: String(listing.seller_sku),
    visible: input.visible,
    getProducts: dependencies.getProducts,
    dependencies,
  });
  const saved = await updateListingPublicationState(id, {
    visible: input.visible,
    requestId: result.requestId,
  }, target);
  return {
    listing: saved,
    requestId: result.requestId || null,
    submitted: true,
    confirmed: true,
    confirmationAttempts: confirmation.attempts,
  };
}
