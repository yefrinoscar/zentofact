import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from './api-error.ts';
import { inboxBulkReadyErrorNotice, inboxSyncNotice, noticeFromError } from './inbox-notice.ts';

test('sync notice stays successful when every store updates', () => {
  assert.deepEqual(inboxSyncNotice({ successful: 9, failed: 0, results: [{ ok: true }] }), {
    tone: 'success',
    message: 'Pedidos actualizados con Falabella.',
    refs: [],
  });
});

test('sync notice becomes an error when no store updates', () => {
  assert.deepEqual(inboxSyncNotice({
    successful: 0,
    failed: 1,
    results: [{ ok: false, companyName: 'LIMBO', logId: 'log_eeeeeeeeeeee' }],
  }), {
    tone: 'error',
    message: '1 tienda no pudo sincronizarse.',
    refs: [{ label: 'LIMBO', logId: 'log_eeeeeeeeeeee' }],
  });
});

test('sync notice exposes a copyable logId per failed store', () => {
  assert.deepEqual(inboxSyncNotice({
    successful: 9,
    failed: 1,
    results: [
      { ok: true, companyName: 'LIMBO' },
      { ok: false, companyName: 'INVERSIONES YAKURUNA S.A.C.', logId: 'log_bbbbbbbbbbbb' },
    ],
  }), {
    tone: 'warning',
    message: '9 tiendas actualizadas; 1 no pudo sincronizarse.',
    refs: [{ label: 'INVERSIONES YAKURUNA S.A.C.', logId: 'log_bbbbbbbbbbbb' }],
  });
});

test('bulk ready failures keep order numbers and tracking ids', () => {
  assert.deepEqual(inboxBulkReadyErrorNotice([
    { orderNumber: '32700111', logId: 'log_cccccccccccc' },
    { orderNumber: '32700122' },
  ]), {
    tone: 'error',
    message: '2 pedidos no pudieron actualizarse. Intenta sincronizar y vuelve a revisar.',
    refs: [
      { label: '32700111', logId: 'log_cccccccccccc' },
      { label: '32700122', logId: undefined },
    ],
  });
});

test('HTTP errors surface the server logId as a tracking id', () => {
  const error = new ApiError('No se pudieron sincronizar las tiendas.', { logId: 'log_dddddddddddd' });
  assert.deepEqual(noticeFromError(error, 'No se pudieron sincronizar las tiendas.'), {
    tone: 'error',
    message: 'No se pudieron sincronizar las tiendas.',
    refs: [{ label: 'ID de seguimiento', logId: 'log_dddddddddddd' }],
  });
});
