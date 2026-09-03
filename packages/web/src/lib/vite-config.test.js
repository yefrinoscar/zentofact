import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';

const configFile = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));

test('development uses the canonical port and proxies Ripley API routes', async () => {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, configFile);

  assert.ok(loaded, 'Vite config should load');
  assert.equal(loaded.config.server?.port, 3011);
  assert.equal(loaded.config.server?.strictPort, true);
  assert.ok(loaded.config.server?.proxy?.['/ripley']);
  assert.ok(loaded.config.server?.proxy?.['/logistics-inbox']);
});
