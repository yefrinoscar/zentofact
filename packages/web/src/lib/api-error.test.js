import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, apiErrorFromResponse, logIdFromUnknown } from './api-error.ts';

test('apiErrorFromResponse keeps the server logId on HTTP errors', () => {
  const error = apiErrorFromResponse(
    { error: 'Falabella rechazó la operación.', logId: 'log_aaaaaaaaaaaa' },
    502,
    'HTTP 502',
  );
  assert.equal(error.message, 'Falabella rechazó la operación.');
  assert.equal(error.logId, 'log_aaaaaaaaaaaa');
  assert.equal(error.status, 502);
  assert.equal(logIdFromUnknown(error), 'log_aaaaaaaaaaaa');
});

test('logIdFromUnknown ignores errors without a tracking id', () => {
  assert.equal(logIdFromUnknown(new Error('falló')), undefined);
  assert.equal(logIdFromUnknown(new ApiError('falló')), undefined);
  assert.equal(logIdFromUnknown({ logId: 12 }), undefined);
});
