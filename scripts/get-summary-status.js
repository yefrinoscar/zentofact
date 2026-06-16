process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:packages/desktop/storage/boletas.db';
process.env.STORAGE_PATH = process.env.STORAGE_PATH || 'packages/desktop/storage';

const core = require('../packages/core/dist');

async function main() {
  const ids = process.argv.slice(2).map(value => Number(value)).filter(Number.isFinite);
  if (!ids.length) {
    throw new Error('Uso: electron scripts/get-summary-status.js <summaryId> [summaryId...]');
  }

  const results = [];
  for (const id of ids) {
    const result = await core.refreshDailySummaryStatus(id);
    results.push({ id, ...result });
  }

  console.log(JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ERROR', error?.stack || error?.message || String(error));
    process.exit(1);
  });
