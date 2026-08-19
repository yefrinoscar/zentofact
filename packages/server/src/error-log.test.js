import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogId, operationalErrorBody } from './error-log.js';

test('createLogId returns a short copyable identifier', () => {
  const logId = createLogId();
  assert.match(logId, /^log_[0-9a-f]{12}$/);
  assert.notEqual(createLogId(), logId);
});

test('operationalErrorBody logs context and returns the same logId', () => {
  const lines = [];
  const error = new Error('Falabella rechazó la operación.');
  const body = operationalErrorBody(error, {
    operation: 'falabella.ready-to-ship',
    context: { companyId: 4, orderId: '32700111', status: 502, event: 'ignored' },
  }, {
    createLogId: () => 'log_aaaaaaaaaaaa',
    log: (line) => lines.push(line),
  });

  assert.deepEqual(body, {
    error: 'Falabella rechazó la operación.',
    logId: 'log_aaaaaaaaaaaa',
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[ZF_LOG\] log_aaaaaaaaaaaa /);
  const payload = JSON.parse(lines[0].slice('[ZF_LOG] log_aaaaaaaaaaaa '.length));
  assert.equal(payload.event, 'zf_log');
  assert.equal(payload.logId, 'log_aaaaaaaaaaaa');
  assert.equal(payload.operation, 'falabella.ready-to-ship');
  assert.equal(payload.companyId, 4);
  assert.equal(payload.orderId, '32700111');
  assert.equal(payload.status, 502);
  assert.equal(payload.message, 'Falabella rechazó la operación.');
  assert.equal(payload.stack, error.stack);
});
