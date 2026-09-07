import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { resolveRipleyOrderBackfillOptions } from './order-sync-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '../../..');
config({ path: resolve(appRoot, '.env') });

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requiere YYYY-MM-DD.`);
  return value;
}

export function parseRipleyBackfillArgv(argv, now = new Date()) {
  return resolveRipleyOrderBackfillOptions({
    from: argValue(argv, '--from'),
    to: argValue(argv, '--to'),
    now,
  });
}

async function main() {
  const options = parseRipleyBackfillArgv(process.argv.slice(2));
  const { syncOrders } = await import('./order-sync.js');
  console.log(JSON.stringify({ event: 'ripley.backfill.start', ...options }));
  const result = await syncOrders(options);
  const summary = {
    event: 'ripley.backfill.done',
    ...options,
    accounts: result.results.length,
    successful: result.results.filter((entry) => entry.status === 'success').length,
    partial: result.results.filter((entry) => entry.status === 'partial').length,
    failed: result.results.filter((entry) => entry.status === 'error').length,
    received: result.results.reduce((sum, entry) => sum + Number(entry.received || 0), 0),
    upserted: result.results.reduce((sum, entry) => sum + Number(entry.upserted || 0), 0),
    results: result.results,
  };
  console.log(JSON.stringify(summary));
  if (summary.failed > 0) process.exitCode = 1;
}

const isCli = process.argv[1] && String(process.argv[1]).endsWith('backfill-ripley-orders.js');
if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
