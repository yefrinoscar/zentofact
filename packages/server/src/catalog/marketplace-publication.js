import { finiteNumber, httpError, loadCore, positiveInt } from './utils.js';
import { enqueueMarketplaceMutation } from './marketplace-mutation-jobs.js';

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

export async function updateMarketplaceSellerStock(idInput, input, dependencies = {}) {
  assertMarketplacePublicationMutationEnabled(dependencies.enabled);
  const quantity = wholeQuantity(input.quantity);
  const { id, target } = await listingForMutation(idInput, dependencies.db);
  const enqueue = dependencies.enqueue || enqueueMarketplaceMutation;
  const job = await enqueue({ listingId: id, userId: dependencies.userId, kind: 'stock', target: { quantity } }, target);
  return { queued: true, jobId: job.id, status: job.status };
}

export async function updateMarketplacePublication(idInput, input, dependencies = {}) {
  assertMarketplacePublicationMutationEnabled(dependencies.enabled);
  if (typeof input.visible !== 'boolean') throw httpError('visible debe ser true o false.');
  const { id, target } = await listingForMutation(idInput, dependencies.db);
  const enqueue = dependencies.enqueue || enqueueMarketplaceMutation;
  const job = await enqueue({ listingId: id, userId: dependencies.userId, kind: 'publication', target: { visible: input.visible } }, target);
  return { queued: true, jobId: job.id, status: job.status };
}
