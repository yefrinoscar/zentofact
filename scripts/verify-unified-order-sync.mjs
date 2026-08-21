import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const full = process.argv.includes('--full');
const checks = [
  ['Ripley API build', 'npm', ['run', 'build', '-w', '@zentofact/ripley-api']],
  ['Ripley API tests', process.execPath, ['--test', 'packages/ripley-api/test/client.test.mjs']],
  ['Order sync backend tests', process.execPath, [
    '--test',
    'packages/server/src/order-sync-policy.test.js',
    'packages/server/src/order-sync.test.js',
    'packages/server/src/provider-request.test.js',
    'packages/server/src/order-adapters/ripley.test.js',
    'packages/server/src/order-management.test.js',
    'packages/server/src/falabella-sync.test.js',
    'packages/server/src/catalog/stock-jobs.test.js',
    'packages/server/src/ripley-orders.test.js',
    'packages/server/src/protected-paths.test.js',
  ]],
  ['Web tests', 'npm', ['test', '-w', '@zentofact/web']],
  ['Web typecheck', 'npm', ['run', 'typecheck', '-w', '@zentofact/web']],
];

if (full) {
  checks.push(
    ['Server test suite', 'npm', ['test', '-w', '@zentofact/server']],
    ['Production build', 'npm', ['run', 'build']],
  );
}

const failures = [];
for (const [name, command, args] of checks) {
  process.stdout.write(`\n[verify] ${name}\n`);
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' });
  if (result.status !== 0) failures.push(name);
}

const sources = {
  server: readFileSync('packages/server/src/index.js', 'utf8'),
  orders: readFileSync('packages/web/src/routes/PedidosMulticanal.tsx', 'utf8'),
  migration: readFileSync('packages/core/src/db/migrate.ts', 'utf8'),
};

const invariants = [
  ['generic scheduler starts', sources.server.includes('startOrderSyncScheduler')],
  ['invoice worker remains separate', sources.server.includes('startAutoEmission')],
  ['unified page avoids the Falabella inbox sync', !sources.orders.includes('syncOrdersInbox')],
  ['canonical order identity remains account-scoped', sources.migration.includes('UNIQUE (channel_account_id, external_order_id)')],
  ['item completeness is persisted', sources.migration.includes('items_status')],
];

for (const [name, passed] of invariants) {
  process.stdout.write(`[verify] ${passed ? 'PASS' : 'FAIL'} ${name}\n`);
  if (!passed) failures.push(name);
}

if (failures.length) {
  process.stderr.write(`\nFallaron ${failures.length} verificaciones: ${failures.join(', ')}\n`);
  process.exit(1);
}

process.stdout.write('\nSincronización unificada verificada.\n');
