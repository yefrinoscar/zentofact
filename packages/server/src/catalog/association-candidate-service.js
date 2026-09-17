import { listRipleyProducts } from '../ripley-catalog.js';
import { isFalabellaActivePublished } from './catalog-import.js';
import { falabellaPublicationSnapshot } from './listing-snapshot-service.js';
import { httpError, loadCore, positiveInt } from './utils.js';

const LIVE_CATALOG_TTL_MS = 30_000;
const LIVE_CATALOG_PAGE_SIZE = 1_000;
const liveCatalogCache = new Map();

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

function companyName(company) {
  return String(company.nombreComercial || company.nombre || company.razonSocial || `Empresa ${company.id}`).trim();
}

function listingIdentity(channelCode, companyId, sellerSku) {
  return `${channelCode}:${Number(companyId)}:${String(sellerSku || '').trim().toLocaleUpperCase('es')}`;
}

function providerMessage(response) {
  return response?.error?.Head?.ErrorMessage
    || response?.error?.message
    || (typeof response?.error === 'string' ? response.error : null);
}

async function cachedCatalog(cache, key, loader, now) {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.promise;
  const promise = loader();
  cache.set(key, { expiresAt: now + LIVE_CATALOG_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    if (cache.get(key)?.promise === promise) cache.delete(key);
    throw error;
  }
}

async function falabellaCatalog(company, dependencies) {
  const products = [];
  for (let offset = 0; offset < 20_000; offset += LIVE_CATALOG_PAGE_SIZE) {
    const response = await dependencies.falabellaGetProducts({
      companyId: Number(company.id),
      filters: { filter: 'all', limit: LIVE_CATALOG_PAGE_SIZE, offset, includeTotal: offset === 0 },
    });
    const error = providerMessage(response);
    if (error || response?.ok === false) {
      throw httpError(`${companyName(company)}: Falabella no pudo entregar el catálogo: ${error || 'respuesta inválida'}`, 502);
    }
    const page = Array.isArray(response?.products) ? response.products : [];
    products.push(...page);
    if (page.length < LIVE_CATALOG_PAGE_SIZE || (response.totalCount != null && products.length >= Number(response.totalCount))) break;
  }

  const sellerSkus = [...new Set(products.map((product) => String(product?.sellerSku || '').trim()).filter(Boolean))];
  const stocks = [];
  for (let start = 0; start < sellerSkus.length; start += LIVE_CATALOG_PAGE_SIZE) {
    const batch = sellerSkus.slice(start, start + LIVE_CATALOG_PAGE_SIZE);
    const response = await dependencies.falabellaGetStock({
      companyId: Number(company.id),
      sellerSkus: batch,
      limit: batch.length,
    });
    const error = providerMessage(response);
    if (error || response?.ok === false) {
      throw httpError(`${companyName(company)}: Falabella no pudo entregar el stock: ${error || 'respuesta inválida'}`, 502);
    }
    stocks.push(...(Array.isArray(response?.stocks) ? response.stocks : []));
  }
  const stockBySku = new Map(stocks.map((stock) => [String(stock?.sellerSku || '').trim(), stock]));

  return products.map((product) => {
    const sellerSku = String(product?.sellerSku || '').trim();
    const snapshot = falabellaPublicationSnapshot(product, stockBySku.get(sellerSku));
    return {
      channelCode: 'falabella',
      companyId: Number(company.id),
      companyName: companyName(company),
      sellerSku,
      shopSku: snapshot.shopSku,
      title: snapshot.title || sellerSku,
      active: isFalabellaActivePublished(product),
      marketplaceQuantity: snapshot.availableQuantity,
      imageUrl: Array.isArray(product?.images) ? product.images[0] || null : null,
      metadata: snapshot.metadata,
    };
  }).filter((candidate) => candidate.sellerSku);
}

async function ripleyCatalog(company, dependencies) {
  const response = await dependencies.listRipleyProducts(Number(company.id), { all: true });
  const offers = Array.isArray(response?.offers) ? response.offers : [];
  return offers.map((offer) => ({
    channelCode: 'ripley',
    companyId: Number(company.id),
    companyName: companyName(company),
    sellerSku: String(offer?.sellerSku || '').trim(),
    shopSku: offer?.productSku || null,
    title: offer?.productTitle || offer?.sellerSku || null,
    active: offer?.active === true,
    marketplaceQuantity: offer?.quantity == null ? null : Number(offer.quantity),
    imageUrl: offer?.imageUrl || null,
    metadata: {
      price: offer?.price ?? null,
      imageUrl: offer?.imageUrl || null,
      isPublished: offer?.active === true,
      isSellable: offer?.active === true,
      marketplaceStatus: offer?.active === true ? 'active' : 'inactive',
    },
  })).filter((candidate) => candidate.sellerSku);
}

async function dependenciesFor(input) {
  const needsCore = !input.db
    || !input.listCompanies
    || !input.falabellaGetProducts
    || !input.falabellaGetStock
    || !input.listRipleyProducts;
  const core = input.core || (needsCore ? await loadCore() : null);
  return {
    db: input.db || core.pool,
    listCompanies: input.listCompanies || core.listCompanies,
    falabellaGetProducts: input.falabellaGetProducts || core.falabellaGetProducts,
    falabellaGetStock: input.falabellaGetStock || core.falabellaGetStock,
    listRipleyProducts: input.listRipleyProducts || ((companyId, filters) => listRipleyProducts(
      companyId,
      filters,
      { getCompany: core.getCompany },
    )),
    cache: input.cache || liveCatalogCache,
    now: typeof input.now === 'function' ? input.now : Date.now,
  };
}

function selectedChannels(filters) {
  const requested = filters.channelCode
    ? [filters.channelCode]
    : String(filters.channelCodes || 'falabella,ripley,mercado_libre').split(',');
  const channels = [...new Set(requested.map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
  if (!channels.length || channels.some((channel) => !['falabella', 'ripley', 'mercado_libre'].includes(channel))) {
    throw httpError('Canal inválido.');
  }
  return new Set(channels);
}

function candidateMatches(candidate, search) {
  if (!search) return true;
  return [candidate.title, candidate.sellerSku, candidate.shopSku, candidate.companyName]
    .some((value) => normalizedText(value).includes(search));
}

export async function listLiveAssociationCandidates(filters = {}, inputDependencies = {}) {
  const productId = positiveInt(filters.productId, 'productId');
  const channels = selectedChannels(filters);
  const availability = String(filters.availability || 'all').trim().toLowerCase();
  if (!['recommended', 'all'].includes(availability)) throw httpError('availability inválido.');
  const search = normalizedText(filters.search);
  const limit = Math.min(Math.max(Number(filters.limit) || 30, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const dependencies = await dependenciesFor(inputDependencies);
  const companies = (await dependencies.listCompanies()).filter((company) => company.activo !== false);
  const now = dependencies.now();
  const tasks = [];

  if (channels.has('falabella')) {
    for (const company of companies.filter((candidate) => candidate.falabellaApiUserId?.trim() && candidate.falabellaApiKey?.trim())) {
      tasks.push(cachedCatalog(
        dependencies.cache,
        `falabella:${company.id}`,
        () => falabellaCatalog(company, dependencies),
        now,
      ));
    }
  }
  if (channels.has('ripley')) {
    for (const company of companies.filter((candidate) => candidate.ripleyApiKey?.trim())) {
      tasks.push(cachedCatalog(
        dependencies.cache,
        `ripley:${company.id}`,
        () => ripleyCatalog(company, dependencies),
        now,
      ));
    }
  }

  const remoteCandidates = (await Promise.all(tasks)).flat();
  const listingResult = await dependencies.db.query(
    `select l.id,l.product_id,l.channel_code,l.company_id,l.seller_sku,l.status,
            p.main_sku as linked_product_sku,p.name as linked_product_name
     from product_listings l
     left join products p on p.id=l.product_id
     where l.channel_code=any($1::text[])`,
    [[...channels]],
  );
  const listingByIdentity = new Map(listingResult.rows.map((listing) => [
    listingIdentity(listing.channel_code, listing.company_id, listing.seller_sku),
    listing,
  ]));
  const uniqueCandidates = new Map();
  for (const remote of remoteCandidates) {
    const identity = listingIdentity(remote.channelCode, remote.companyId, remote.sellerSku);
    const existing = listingByIdentity.get(identity);
    const linkedElsewhere = existing
      && existing.status !== 'unlinked'
      && Number(existing.product_id) !== productId;
    if (existing && existing.status !== 'unlinked' && !linkedElsewhere) continue;
    if (linkedElsewhere && !search) continue;
    if (!candidateMatches(remote, search)) continue;
    uniqueCandidates.set(identity, {
      id: existing ? Number(existing.id) : 0,
      productId: existing ? Number(existing.product_id) : 0,
      companyId: remote.companyId,
      companyName: remote.companyName,
      channelCode: remote.channelCode,
      sellerSku: remote.sellerSku,
      shopSku: remote.shopSku,
      title: remote.title,
      status: remote.active ? 'active' : 'inactive',
      marketplaceQuantity: remote.marketplaceQuantity,
      metadata: remote.metadata,
      imageUrl: remote.imageUrl,
      candidateSource: existing ? 'catalog' : 'remote',
      association: linkedElsewhere ? {
        kind: 'linked_elsewhere',
        productId: Number(existing.product_id),
        mainSku: existing.linked_product_sku || null,
        productName: existing.linked_product_name || null,
      } : { kind: 'available' },
    });
  }
  const matchingCandidates = [...uniqueCandidates.values()];
  const availableCandidates = availability === 'recommended'
    ? matchingCandidates.filter((candidate) => candidate.status === 'active' && Number(candidate.marketplaceQuantity) > 0)
    : matchingCandidates;
  const candidates = availableCandidates.sort((left, right) => (
    left.channelCode.localeCompare(right.channelCode, 'es')
      || left.companyName.localeCompare(right.companyName, 'es')
      || String(left.title || '').localeCompare(String(right.title || ''), 'es')
      || left.sellerSku.localeCompare(right.sellerSku, 'es')
  ));
  return {
    candidates: candidates.slice(offset, offset + limit),
    totalCount: candidates.length,
    limit,
    offset,
    source: 'marketplaces_live',
    hiddenByAvailabilityCount: matchingCandidates.length - availableCandidates.length,
  };
}
