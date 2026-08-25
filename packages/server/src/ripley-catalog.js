import { RipleyApiClient } from '@zentofact/ripley-api';
import { ripleyApiUrl } from './ripley-api-url.js';

function positiveCompanyId(value) {
  const companyId = Number(value);
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error('Empresa inválida.');
  return companyId;
}

function configuredClient(company) {
  if (!company?.activo) throw new Error('Empresa no encontrada o inactiva.');
  if (!company.ripleyApiKey?.trim()) {
    throw new Error('La empresa no tiene configurada la API key de Ripley.');
  }
  return new RipleyApiClient({
    baseUrl: ripleyApiUrl(),
    apiKey: company.ripleyApiKey,
    shopId: company.ripleyShopId || undefined,
  });
}

/** Lists the seller's Ripley/Mirakl offers. This path never mutates Ripley. */
export async function listRipleyProducts(companyIdInput, filters = {}, dependencies = {}) {
  const companyId = positiveCompanyId(companyIdInput);
  const getCompany = dependencies.getCompany;
  if (typeof getCompany !== 'function') throw new Error('Falta el proveedor de empresas para Ripley.');
  const company = await getCompany(companyId);
  const client = dependencies.client || configuredClient(company);
  const all = filters.all === true || filters.all === 'true';
  if (all) {
    const offers = await client.listAllOffers();
    return { companyId, totalCount: offers.length, offers: await enrichOffers(client, offers) };
  }
  const page = await client.listOffers({
    max: filters.max == null ? undefined : Number(filters.max),
    offset: filters.offset == null ? undefined : Number(filters.offset),
    offerStateCodes: typeof filters.offerStateCodes === 'string' ? filters.offerStateCodes : undefined,
    sku: typeof filters.sku === 'string' ? filters.sku : undefined,
    productId: typeof filters.productId === 'string' ? filters.productId : undefined,
  });
  return { companyId, ...page, offers: await enrichOffers(client, page.offers) };
}

async function enrichOffers(client, offers) {
  const productSkus = offers.map((offer) => offer.productSku).filter(Boolean);
  if (!productSkus.length) return offers;
  const contents = await client.listProductContents(productSkus);
  const contentBySku = new Map(contents.map((content) => [content.productSku, content]));
  return offers.map((offer) => {
    const content = contentBySku.get(offer.productSku);
    return {
      ...offer,
      productTitle: content?.productTitle || offer.productTitle,
      imageUrl: content?.imageUrl || null,
    };
  });
}
