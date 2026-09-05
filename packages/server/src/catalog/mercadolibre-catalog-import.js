import { expandItemListings } from '@zentofact/mercado-libre-api';
import { createProduct } from './product-service.js';
import { upsertListing } from './listing-service.js';
import { inTransaction, loadCore } from './utils.js';
import { mercadoLibreClientForCompany, mercadoLibreGrantFromCompany } from '../mercado-libre-tokens.js';
import { ensureMercadoLibreOrderAccount } from '../order-adapters/mercadolibre.js';

function text(value) {
  return String(value ?? '').trim();
}

export function resolveMercadoLibreCatalogMatch({ sellerSku, existingListing, productsByMainSku }) {
  const sku = text(sellerSku);
  if (!sku) return { action: 'skip', reason: 'missing_seller_sku' };
  if (existingListing) {
    return {
      action: 'refresh',
      productId: Number(existingListing.product_id || existingListing.productId),
      mainSku: existingListing.main_sku || existingListing.mainSku || null,
    };
  }
  const product = productsByMainSku.get(sku.toUpperCase());
  if (product) {
    return {
      action: 'associate',
      productId: Number(product.id),
      mainSku: product.mainSku || product.main_sku,
    };
  }
  return { action: 'unmapped' };
}

async function listSellerItems(client, sellerId) {
  const items = [];
  let scrollId = null;
  for (let page = 0; page < 200; page += 1) {
    const result = await client.searchItems({
      sellerId,
      searchType: 'scan',
      scrollId,
      limit: 50,
    });
    if (!result.itemIds.length) break;
    items.push(...await client.getItems(result.itemIds));
    scrollId = result.scrollId;
    if (!scrollId) break;
  }
  return items.flatMap((item) => expandItemListings(item));
}

function listingInput(company, item, accountId) {
  return {
    channelCode: 'mercado_libre',
    companyId: company.id,
    channelAccountId: accountId,
    sellerSku: item.sellerSku,
    shopSku: item.itemId,
    externalProductId: item.variationId ? `${item.itemId}:${item.variationId}` : item.itemId,
    title: item.title || item.sellerSku,
    marketplaceQuantity: item.availableQuantity,
    marketplaceSyncedAt: new Date().toISOString(),
    metadata: {
      permalink: item.permalink,
      imageUrl: item.pictureUrl,
      price: item.price,
      userProductId: item.userProductId,
      catalogProductId: item.catalogProductId,
      variationId: item.variationId,
      marketplaceStatus: item.status,
      isPublished: item.status === 'active',
    },
  };
}

export async function syncMercadoLibreCatalog(input = {}, actorUserId, db) {
  const core = await loadCore();
  const target = db || core.pool;
  const companies = (input.companies || (await target.query(
    `select id, coalesce(nullif(nombre_comercial,''),nullif(nombre,''),razon_social) as name,
            mercado_libre_user_id, mercado_libre_site_id, mercado_libre_access_token,
            mercado_libre_refresh_token, mercado_libre_token_expires_at
     from companies
     where activo is not false and nullif(trim(mercado_libre_refresh_token), '') is not null
     order by id`,
  )).rows).map((company) => ({
    id: Number(company.id),
    name: company.name || company.nombre || `Empresa ${company.id}`,
    mercadoLibreUserId: company.mercado_libre_user_id || company.mercadoLibreUserId,
    mercadoLibreSiteId: company.mercado_libre_site_id || company.mercadoLibreSiteId,
    mercadoLibreAccessToken: company.mercado_libre_access_token || company.mercadoLibreAccessToken,
    mercadoLibreRefreshToken: company.mercado_libre_refresh_token || company.mercadoLibreRefreshToken,
    mercadoLibreTokenExpiresAt: company.mercado_libre_token_expires_at || company.mercadoLibreTokenExpiresAt,
  })).filter((company) => mercadoLibreGrantFromCompany(company));
  const products = (await target.query(
    `select id, main_sku, name from products where status <> 'archived'`,
  )).rows.map((row) => ({
    id: Number(row.id),
    mainSku: row.main_sku,
    name: row.name,
  }));
  const productsByMainSku = new Map(products.map((product) => [String(product.mainSku || '').toUpperCase(), product]));
  const existingListings = (await target.query(
    `select id, product_id, company_id, seller_sku, status from product_listings
     where channel_code='mercado_libre'`,
  )).rows;
  const listingBySeller = new Map(existingListings.map((listing) => [
    `${Number(listing.company_id)}:${String(listing.seller_sku || '').trim()}`,
    listing,
  ]));
  const report = {
    dryRun: input.dryRun === true,
    companiesRequested: companies.length,
    companiesSynced: 0,
    itemsReceived: 0,
    kept: [],
    associated: [],
    created: [],
    unassociated: [],
    errors: [],
  };
  const apply = input.dryRun === true
    ? async (work) => work({
      query: async () => ({ rows: [] }),
    })
    : (work) => inTransaction(db, work);

  for (const company of companies) {
    try {
      const client = await mercadoLibreClientForCompany(company, input.dependencies || {});
      const items = await (input.listItems || listSellerItems)(client, company.mercadoLibreUserId);
      report.itemsReceived += items.length;
      report.companiesSynced += 1;
      const account = input.dryRun === true
        ? { id: null }
        : await ensureMercadoLibreOrderAccount(target, company.id, company.name, company.mercadoLibreUserId);
      await apply(async (txn) => {
        for (const item of items) {
          const match = resolveMercadoLibreCatalogMatch({
            sellerSku: item.sellerSku,
            existingListing: listingBySeller.get(`${company.id}:${text(item.sellerSku)}`),
            productsByMainSku,
          });
          const row = {
            companyId: company.id,
            companyName: company.name,
            sellerSku: item.sellerSku,
            title: item.title || item.sellerSku,
            mainSku: match.mainSku || null,
          };
          if (match.action === 'skip') {
            report.unassociated.push({ ...row, reason: match.reason });
            continue;
          }
          if (match.action === 'refresh') {
            if (!input.dryRun) {
              await upsertListing(match.productId, listingInput(company, item, account.id), txn);
            }
            report.kept.push(row);
            continue;
          }
          if (match.action === 'associate') {
            if (!input.dryRun) {
              await upsertListing(match.productId, listingInput(company, item, account.id), txn);
            }
            report.associated.push(row);
            continue;
          }
          if (input.createProductsFromSellerSku === true) {
            if (!input.dryRun) {
              const product = await createProduct({
                mainSku: item.sellerSku,
                name: item.title || item.sellerSku,
                imageUrl: item.pictureUrl,
                referencePrice: item.price,
                status: 'active',
                attributes: { imported_from: 'mercado_libre' },
              }, actorUserId, txn);
              await upsertListing(product.id, listingInput(company, item, account.id), txn);
              row.mainSku = product.mainSku;
            } else {
              row.mainSku = text(item.sellerSku).toUpperCase();
            }
            report.created.push(row);
            continue;
          }
          report.unassociated.push({ ...row, reason: 'seller_sku_unmapped' });
        }
      });
    } catch (error) {
      report.errors.push({
        companyId: company.id,
        companyName: company.name,
        message: error?.message || String(error),
      });
    }
  }
  return report;
}
