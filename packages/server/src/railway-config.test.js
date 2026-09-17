import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requiredRuntimeBuilds = [
  '@zentofact/falabella-api',
  '@zentofact/core',
  '@zentofact/ripley-api',
  '@zentofact/mercado-libre-api',
];

test('Railway compila las librerías internas que usa el API', async () => {
  const railway = JSON.parse(await readFile(resolve(appRoot, 'railway.json'), 'utf8'));
  const buildCommand = railway.build?.buildCommand || '';

  for (const workspace of requiredRuntimeBuilds) {
    assert.ok(
      buildCommand.includes(`npm run build -w ${workspace}`),
      `Railway omite el build de ${workspace}`,
    );
  }
});
