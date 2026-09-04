import assert from 'node:assert/strict';
import test from 'node:test';
import { clientErrorMessage, createLogId, operationalErrorBody } from './error-log.js';

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

test('clientErrorMessage oculta SQL de Drizzle al cliente', () => {
  assert.equal(
    clientErrorMessage(new Error('Failed query: insert into "account" ("password") values ($1)\nparams: hash')),
    'No se pudo completar la operación.',
  );
  assert.equal(clientErrorMessage(new Error('Correo inválido')), 'Correo inválido');
});

test('operationalErrorBody registra la causa de Postgres y no la devuelve como error', () => {
  const lines = [];
  const error = new Error('Failed query: insert into "account" ("issuer") values ($1)');
  error.cause = new Error('column "issuer" of relation "account" does not exist');
  const body = operationalErrorBody(error, {
    operation: 'api',
    context: { method: 'POST', path: '/users', status: 400 },
  }, {
    createLogId: () => 'log_bbbbbbbbbbbb',
    log: (line) => lines.push(line),
  });

  assert.deepEqual(body, {
    error: 'No se pudo completar la operación.',
    logId: 'log_bbbbbbbbbbbb',
  });
  const payload = JSON.parse(lines[0].slice('[ZF_LOG] log_bbbbbbbbbbbb '.length));
  assert.equal(payload.message, error.message);
  assert.equal(payload.cause, 'column "issuer" of relation "account" does not exist');
  assert.equal(payload.path, '/users');
});
