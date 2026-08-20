import { httpError } from './utils.js';

export const MARKETPLACE_PUBLICATION_MUTATION_ENV = 'MARKETPLACE_PUBLICATION_MUTATION_ENABLED';

export function marketplacePublicationMutationEnabled(env = process.env) {
  const value = String(env[MARKETPLACE_PUBLICATION_MUTATION_ENV] ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

export function assertMarketplacePublicationMutationEnabled(env = process.env) {
  if (marketplacePublicationMutationEnabled(env)) return;
  throw httpError(
    'La mutación de publicaciones Falabella está desactivada. Esta versión solo simula el flujo.',
    409,
    'marketplace_publication_visual_only',
  );
}

export async function createMarketplaceProduct(createProduct, payload, env = process.env) {
  assertMarketplacePublicationMutationEnabled(env);
  return createProduct(payload);
}
