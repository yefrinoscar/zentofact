import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCoverage, createTransfer, previewTransfer, requeueStockJobs } from './stock-transfers.js';

test('computeCoverage cubre pedidos FIFO con el disponible del destino', () => {
  const jobs = [
    { jobId: 1, orderNumber: 'A', missing: 1, status: 'failed' },
    { jobId: 2, orderNumber: 'B', missing: 1, status: 'failed' },
    { jobId: 3, orderNumber: 'C', missing: 1, status: 'pending' },
  ];
  const coverage = computeCoverage({ availableAfter: 2, jobs });
  assert.deepEqual(coverage.covered.map((job) => job.jobId), [1, 2]);
  assert.deepEqual(coverage.uncovered.map((job) => job.jobId), [3]);
  assert.equal(coverage.leftover, 0);
});

test('computeCoverage no cubre un pedido a medias y sigue con el siguiente', () => {
  const jobs = [
    { jobId: 1, orderNumber: 'A', missing: 3, status: 'failed' },
    { jobId: 2, orderNumber: 'B', missing: 1, status: 'failed' },
  ];
  const coverage = computeCoverage({ availableAfter: 2, jobs });
  assert.deepEqual(coverage.covered.map((job) => job.jobId), [2]);
  assert.equal(coverage.uncovered[0].jobId, 1);
  assert.equal(coverage.uncovered[0].shortBy, 1);
});

test('computeCoverage sin disponible deja todo pendiente', () => {
  const coverage = computeCoverage({ availableAfter: 0, jobs: [{ jobId: 1, missing: 1, status: 'failed' }] });
  assert.equal(coverage.covered.length, 0);
  assert.equal(coverage.uncovered.length, 1);
});

test('createTransfer rechaza origen y destino iguales sin tocar la base', async () => {
  await assert.rejects(
    createTransfer({ sourceProductId: 7, targetProductId: 7, quantity: 1, reasonCode: 'import_duplicate' }),
    /distintos/,
  );
});

test('createTransfer exige un motivo válido y nota para «Otro»', async () => {
  await assert.rejects(
    createTransfer({ sourceProductId: 1, targetProductId: 2, quantity: 1, reasonCode: 'inventado' }),
    /Motivo de transferencia inválido/,
  );
  await assert.rejects(
    createTransfer({ sourceProductId: 1, targetProductId: 2, quantity: 1, reasonCode: 'other' }),
    /Describe el motivo/,
  );
});

test('previewTransfer rechaza origen y destino iguales sin tocar la base', async () => {
  await assert.rejects(
    previewTransfer({ sourceProductId: 5, targetProductId: 5, quantity: 2 }),
    /distintos/,
  );
});

test('requeueStockJobs exige ids y un máximo por lote', async () => {
  await assert.rejects(requeueStockJobs({ jobIds: [] }), /Indica los pedidos/);
  await assert.rejects(
    requeueStockJobs({ jobIds: Array.from({ length: 51 }, (_, index) => index + 1) }),
    /hasta 50 pedidos/,
  );
});
