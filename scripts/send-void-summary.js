process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:packages/desktop/storage/boletas.db';
process.env.STORAGE_PATH = process.env.STORAGE_PATH || 'packages/desktop/storage';

const core = require('../packages/core/dist');

async function main() {
  const [companyIdArg, branchIdArg, boletaIdsArg] = process.argv.slice(2);
  if (!companyIdArg || !branchIdArg || !boletaIdsArg) {
    throw new Error('Uso: electron scripts/send-void-summary.js <companyId> <branchId> <boletaId,boletaId,...>');
  }

  const companyId = Number(companyIdArg);
  const branchId = Number(branchIdArg);
  const boletaIds = boletaIdsArg.split(',').map(value => Number(value.trim())).filter(Number.isFinite);
  if (!boletaIds.length) {
    throw new Error('Debes indicar al menos un boletaId válido');
  }

  const result = await core.sendBoletasAsVoidedDailySummaries(
    companyId,
    branchId,
    boletaIds,
    (status) => console.log(`PROGRESS ${status}`),
  );

  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ERROR', error?.stack || error?.message || String(error));
    process.exit(1);
  });
