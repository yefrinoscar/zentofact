import { parseArgs } from 'node:util';
import { pool } from '@zentofact/core';
import { listLiveAssociationCandidates } from '../packages/server/src/catalog/association-candidate-service.js';
import { adjustInventory } from '../packages/server/src/catalog/inventory-service.js';
import { createListing, linkListing } from '../packages/server/src/catalog/listing-service.js';
import { createProduct } from '../packages/server/src/catalog/product-service.js';
import { inTransaction } from '../packages/server/src/catalog/utils.js';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
const MASTER_SKU = 'AG301';
const MASTER_NAME = 'Coche Bastón tipo Paraguas Liviano plegable Celeste';
const TARGET_STOCK = 1;
const TARGETS = [
  { channelCode: 'falabella', sellerSku: '1354xssew' },
  { channelCode: 'falabella', sellerSku: '143571425' },
  { channelCode: 'falabella', sellerSku: 'hsfds' },
  { channelCode: 'falabella', sellerSku: '123412asdfa' },
  { channelCode: 'ripley', sellerSku: 'S166285' },
];

function identity(channelCode, sellerSku) {
  return `${channelCode}:${sellerSku}`;
}

try {
  const live = await listLiveAssociationCandidates({
    productId: 120,
    search: 'coche baston',
    availability: 'all',
    limit: 100,
    offset: 0,
  });
  const liveByIdentity = new Map(live.candidates.map((candidate) => [
    identity(candidate.channelCode, candidate.sellerSku),
    candidate,
  ]));
  const existingListings = await pool.query(
    `select l.*, p.main_sku
     from product_listings l join products p on p.id=l.product_id
     where (l.channel_code,l.seller_sku) in (
       ('falabella','1354xssew'),
       ('falabella','143571425'),
       ('falabella','hsfds'),
       ('falabella','123412asdfa'),
       ('ripley','S166285')
     )`,
  );
  const existingByIdentity = new Map(existingListings.rows.map((listing) => [
    identity(listing.channel_code, listing.seller_sku),
    listing,
  ]));
  const missingEvidence = TARGETS.filter((target) => {
    const key = identity(target.channelCode, target.sellerSku);
    return !liveByIdentity.has(key) && !existingByIdentity.has(key);
  });
  if (missingEvidence.length) {
    throw new Error(`Faltan publicaciones esperadas: ${missingEvidence.map((target) => identity(target.channelCode, target.sellerSku)).join(', ')}`);
  }
  const conflicting = [...existingByIdentity.values()].filter((listing) => (
    listing.status !== 'unlinked' && listing.main_sku !== MASTER_SKU
  ));
  if (conflicting.length) {
    throw new Error(`Hay publicaciones ya asociadas a otro maestro: ${conflicting.map((listing) => `${listing.channel_code}:${listing.seller_sku}->${listing.main_sku}`).join(', ')}`);
  }

  const primary = liveByIdentity.get('falabella:143571425')
    || [...liveByIdentity.values()].find((candidate) => candidate.channelCode === 'falabella');
  console.table(TARGETS.map((target) => {
    const key = identity(target.channelCode, target.sellerSku);
    const candidate = liveByIdentity.get(key);
    const existing = existingByIdentity.get(key);
    return {
      canal: target.channelCode,
      sellerSku: target.sellerSku,
      seller: candidate?.companyName || null,
      titulo: candidate?.title || existing?.title || null,
      stockSeller: candidate?.marketplaceQuantity ?? existing?.marketplace_quantity ?? null,
      accion: existing?.main_sku === MASTER_SKU ? 'ya asociado' : existing ? 'vincular' : 'crear publicación',
    };
  }));
  console.log(`Maestro: ${MASTER_SKU} · ${MASTER_NAME} · stock físico ${TARGET_STOCK}`);

  if (!values.apply) {
    console.log('DRY RUN: no se modificó la base. Usa --apply para aplicar.');
  } else {
    const result = await inTransaction(null, async (client) => {
      let product = (await client.query('select * from products where main_sku=$1 for update', [MASTER_SKU])).rows[0];
      if (!product) {
        product = await createProduct({
          mainSku: MASTER_SKU,
          name: MASTER_NAME,
          status: 'active',
          imageUrl: primary?.imageUrl || null,
          referencePrice: 109.9,
          attributes: {
            color: 'Celeste',
            excel_variant_code: 'G35V',
            source_workbook: 'stock 21.08.2026 a las 2.50 pm.xlsx',
          },
        }, null, client);
      }
      for (const target of TARGETS) {
        const key = identity(target.channelCode, target.sellerSku);
        const existing = existingByIdentity.get(key);
        if (existing?.main_sku === MASTER_SKU) continue;
        if (existing) {
          await linkListing({ listingId: Number(existing.id), productId: Number(product.id) }, client);
          continue;
        }
        const candidate = liveByIdentity.get(key);
        await createListing(product.id, {
          channelCode: candidate.channelCode,
          companyId: candidate.companyId,
          sellerSku: candidate.sellerSku,
          shopSku: candidate.shopSku,
          title: candidate.title,
          status: 'active',
          marketplaceQuantity: candidate.marketplaceQuantity,
          marketplaceSyncedAt: new Date().toISOString(),
          metadata: { ...candidate.metadata, imageUrl: candidate.imageUrl },
        }, client);
      }
      await adjustInventory(product.id, {
        absoluteTarget: TARGET_STOCK,
        reason: 'Conteo físico del Excel del 21/08/2026 · variante G35V',
        idempotencyKey: 'inventory-count:2026-08-21:g35v:ag301',
      }, null, client);
      return product;
    });
    console.log(`APLICADO: ${result.mainSku || MASTER_SKU}`);
  }
} finally {
  await pool.end();
}
