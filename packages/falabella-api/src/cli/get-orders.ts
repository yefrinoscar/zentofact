import { FalabellaApiClient, getFalabellaError, normalizeGetOrdersResult } from '../index';
import type { GetOrdersV2Filters } from '../types';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userId = process.env.FALABELLA_API_USER_ID || '';
  const apiKey = process.env.FALABELLA_API_KEY || '';

  if (!userId || !apiKey) {
    throw new Error('Faltan FALABELLA_API_USER_ID o FALABELLA_API_KEY.');
  }

  const client = new FalabellaApiClient({
    userId,
    apiKey,
    baseUrl: process.env.FALABELLA_API_URL || undefined,
    version: process.env.FALABELLA_API_VERSION || '1.0',
    defaultFormat: 'JSON',
  });

  const response = await client.getOrdersV2(args);
  const error = getFalabellaError(response.data);

  if (error) {
    console.log(JSON.stringify({
      ok: response.ok,
      status: response.status,
      url: response.url,
      error,
    }, null, 2));
    process.exit(1);
  }

  const normalized = normalizeGetOrdersResult(response.data);
  console.log(JSON.stringify({
    ok: response.ok,
    status: response.status,
    url: response.url,
    totalCount: normalized.totalCount,
    returnedOrders: normalized.orders.length,
    sampleOrders: normalized.orders.slice(0, 3),
  }, null, 2));
}

function parseArgs(argv: string[]): GetOrdersV2Filters {
  const filters: GetOrdersV2Filters = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key.startsWith('--')) continue;

    switch (key) {
      case '--created-after':
        filters.createdAfter = value;
        index += 1;
        break;
      case '--created-before':
        filters.createdBefore = value;
        index += 1;
        break;
      case '--updated-after':
        filters.updatedAfter = value;
        index += 1;
        break;
      case '--updated-before':
        filters.updatedBefore = value;
        index += 1;
        break;
      case '--limit':
        filters.limit = Number(value);
        index += 1;
        break;
      case '--offset':
        filters.offset = Number(value);
        index += 1;
        break;
      case '--status':
        filters.status = value as GetOrdersV2Filters['status'];
        index += 1;
        break;
      case '--sort-direction':
        filters.sortDirection = value as GetOrdersV2Filters['sortDirection'];
        index += 1;
        break;
      case '--shipping-type':
        filters.shippingType = value as GetOrdersV2Filters['shippingType'];
        index += 1;
        break;
      default:
        throw new Error(`Argumento no soportado: ${key}`);
    }
  }

  return filters;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
