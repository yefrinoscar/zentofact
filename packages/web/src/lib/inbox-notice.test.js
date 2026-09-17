import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from './api-error.ts';
import { inboxBulkReadyErrorNotice, inboxSyncNotice, logisticsSyncNotice, noticeFromError } from './inbox-notice.ts';

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
    message: 'Limbo no pudo sincronizarse.',
    refs: [{ label: 'Limbo', logId: 'log_eeeeeeeeeeee' }],
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
    message: 'Yakuruna no pudo sincronizarse.',
    refs: [{ label: 'Yakuruna', logId: 'log_bbbbbbbbbbbb' }],
  });
});

test('la bandeja unificada nombra la tienda que falló', () => {
  assert.deepEqual(logisticsSyncNotice({
    results: [
      { status: 'success', companyName: 'LIMBO' },
      { status: 'error', companyName: 'BEAUTY HOME E.I.R.L', companyId: 8, logId: 'log_beautyhome' },
    ],
  }), {
    tone: 'warning',
    message: 'Beauty home no pudo sincronizarse.',
    refs: [{ label: 'Beauty home', logId: 'log_beautyhome' }],
  });
});

test('la bandeja unificada nombra la tienda ocupada', () => {
  assert.deepEqual(logisticsSyncNotice({
    results: [
      { status: 'success', companyName: 'STINGRAY' },
      { status: 'already_running', companyName: 'BEAUTY HOMEHOLD', companyId: 8 },
    ],
  }), {
    tone: 'warning',
    message: 'Beauty homehold ya se estaba sincronizando.',
    refs: [],
  });
});

test('una sincronización incompleta no se presenta como actualizada', () => {
  assert.deepEqual(logisticsSyncNotice({
    results: [{ status: 'partial', companyName: 'STINGRAY', failed: 2, logId: 'log_stingray' }],
  }), {
    tone: 'error',
    message: 'Stingray no pudo sincronizarse.',
    refs: [{ label: 'Stingray', logId: 'log_stingray' }],
  });
});

test('si el sync no manda el nombre, la bandeja usa el de los pedidos visibles', () => {
  assert.equal(logisticsSyncNotice({
    results: [{ status: 'error', companyId: 8, logId: 'log_mapped' }],
  }, new Map([[8, 'Beauty homehold']])).message, 'Beauty homehold no pudo sincronizarse.');
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

test('scanner lookup errors keep the copyable tracking id from the API', () => {
  const error = new ApiError('No encontramos una etiqueta u orden asociada a 240121000011723360.', {
    logId: 'log_ffffffffffff',
  });
  assert.deepEqual(noticeFromError(error, 'No pudimos encontrar la etiqueta.'), {
    tone: 'error',
    message: 'No encontramos una etiqueta u orden asociada a 240121000011723360.',
    refs: [{ label: 'ID de seguimiento', logId: 'log_ffffffffffff' }],
  });
});

test('client validation errors do not invent a tracking id', () => {
  assert.deepEqual(noticeFromError(new Error('Escanea un QR o escribe el número de tracking u orden.'), 'No pudimos encontrar la etiqueta.'), {
    tone: 'error',
    message: 'Escanea un QR o escribe el número de tracking u orden.',
    refs: [],
  });
});
