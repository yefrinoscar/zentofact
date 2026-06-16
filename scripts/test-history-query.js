process.env.DATABASE_URL = 'sqlite:packages/desktop/storage/boletas.db';
const core = require('../packages/core/dist');

async function main() {
  const result = core.listBoletas({
    companyId: 3,
    orderNumber: 'B001-000733',
    limit: 20,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
