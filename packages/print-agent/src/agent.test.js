import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, runOnce } from './agent.js';

test('lee api, token e impresora de flags o env', () => {
  assert.deepEqual(parseArgs(['--api', 'https://api.example', '--token', 't', '--printer', 'Zebra'], {}), {
    command: 'run',
    api: 'https://api.example',
    token: 't',
    printer: 'Zebra',
  });
  const fromEnv = parseArgs([], {
    ZENTOFACT_API_URL: 'https://api.example/',
    ZENTOFACT_PRINT_TOKEN: 't',
    ZENTOFACT_PRINTER: 'HP',
  });
  assert.equal(fromEnv.api, 'https://api.example');
  assert.equal(fromEnv.printer, 'HP');
});

test('si el API dice wait, el agente no imprime', async () => {
  const printed = [];
  const result = await runOnce({ api: 'https://api.example', token: 't', printer: 'HP' }, {
    requestNext: async () => ({ kind: 'wait', reason: 'gathering', pendingCount: 2, waitMs: 3000 }),
    printPdf: async (job) => printed.push(job),
    log: () => {},
  });
  assert.equal(result.printed, false);
  assert.equal(printed.length, 0);
});

test('imprime el PDF y confirma el lote', async () => {
  const acked = [];
  const result = await runOnce({ api: 'https://api.example', token: 't', printer: 'HP' }, {
    requestNext: async () => ({
      kind: 'print',
      batchId: 'b1',
      reason: 'page_full',
      orderIds: [1, 2, 3, 4],
      pages: 1,
      filename: 'bandeja.pdf',
      base64: 'JVBERg==',
    }),
    printPdf: async () => ({ ok: true }),
    requestAck: async (_config, payload) => { acked.push(payload); },
    log: () => {},
  });
  assert.equal(result.printed, true);
  assert.deepEqual(acked[0], { batchId: 'b1', orderIds: [1, 2, 3, 4] });
});

test('si la impresora falla, el lote vuelve a pending', async () => {
  const failed = [];
  await assert.rejects(() => runOnce({ api: 'https://api.example', token: 't', printer: 'HP' }, {
    requestNext: async () => ({
      kind: 'print',
      batchId: 'b2',
      orderIds: [8],
      base64: 'JVBERg==',
    }),
    printPdf: async () => { throw new Error('lp: printer not found'); },
    requestFail: async (_config, payload) => { failed.push(payload); },
    log: () => {},
  }), /printer not found/);
  assert.equal(failed[0].batchId, 'b2');
});
