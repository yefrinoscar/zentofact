import { RipleyApiClient } from '@zentofact/ripley-api';

const RIPLEY_PERU_API_URL = 'https://ripleyperu-prod.mirakl.net';

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
    baseUrl: RIPLEY_PERU_API_URL,
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
    return { companyId, totalCount: offers.length, offers };
  }
  const page = await client.listOffers({
    max: filters.max == null ? undefined : Number(filters.max),
    offset: filters.offset == null ? undefined : Number(filters.offset),
    offerStateCodes: typeof filters.offerStateCodes === 'string' ? filters.offerStateCodes : undefined,
    sku: typeof filters.sku === 'string' ? filters.sku : undefined,
    productId: typeof filters.productId === 'string' ? filters.productId : undefined,
  });
  return { companyId, ...page };
}
