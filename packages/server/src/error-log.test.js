import assert from 'node:assert/strict';
import test from 'node:test';
import { clientErrorMessage, compactStack, createLogId, existingLogId, operationalErrorBody } from './error-log.js';

test('createLogId returns a short copyable identifier', () => {
  const logId = createLogId();
  assert.match(logId, /^log_[0-9a-f]{12}$/);
  assert.notEqual(createLogId(), logId);
  assert.equal(existingLogId(logId), logId);
  assert.equal(existingLogId('log_not-valid'), '');
});

test('operationalErrorBody reutiliza el logId y los details del error de impresión', () => {
  const lines = [];
  const error = new Error('El pedido Ripley no tiene seller.');
  error.logId = 'log_cccccccccccc';
  error.details = {
    orderIds: [88],
    skipped: [{ id: 88, reason: 'El pedido Ripley no tiene seller.' }],
    orders: [{ id: 88, channel: 'ripley', externalOrderNumber: '7935256701' }],
  };
  const body = operationalErrorBody(error, {
    operation: 'logistics.print',
    context: { method: 'POST', path: '/logistics-inbox/print', status: 400 },
  }, {
    createLogId: () => 'log_should_not_win',
    log: (line) => lines.push(line),
  });

  assert.deepEqual(body, {
    error: 'El pedido Ripley no tiene seller.',
    logId: 'log_cccccccccccc',
  });
  const payload = JSON.parse(lines[0].slice('[ZF_LOG] log_cccccccccccc '.length));
  assert.equal(payload.logId, 'log_cccccccccccc');
  assert.equal(payload.operation, 'logistics.print');
  assert.deepEqual(payload.orderIds, [88]);
  assert.equal(payload.skipped[0].id, 88);
  assert.equal(payload.orders[0].externalOrderNumber, '7935256701');
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
  assert.deepEqual(payload.stack, compactStack(error));
  assert.ok(payload.stack.every((frame) => !frame.includes('node:internal')));
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
  assert.equal(payload.message, 'Falló una consulta a la base de datos (insert account): column "issuer" of relation "account" does not exist.');
  assert.equal(payload.type, 'database_query');
  assert.equal(payload.query, 'insert account');
  assert.equal(payload.cause, undefined);
  assert.equal(payload.path, '/users');
});

test('un timeout del pool de Postgres se registra en una línea clara, sin SQL ni params', () => {
  const lines = [];
  const error = new Error('Failed query: select "id", "nombre", "falabella_api_key", "mercado_libre_refresh_token" from "companies" where "companies"."id" = $1 limit $2\nparams: 2,1');
  error.cause = new Error('timeout exceeded when trying to connect');
  error.stack = [
    `Error: ${error.message}`,
    '    at NodePgPreparedQuery.queryWithCache (/app/node_modules/drizzle-orm/pg-core/session.cjs:66:15)',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
    '    at async getCompany (/app/packages/core/dist/services/company.service.js:125:18)',
    '    at async syncFalabellaOrders (file:///app/packages/server/src/falabella-sync.js:830:21)',
    '    at async Promise.all (index 1)',
  ].join('\n');
  const body = operationalErrorBody(error, {
    operation: 'order_sync_account',
    context: { seller: 'DOLPHIN', companyId: 2, channelCode: 'falabella', source: 'zentofact' },
  }, {
    createLogId: () => 'log_c9fb1be42870',
    log: (line) => lines.push(line),
  });

  assert.equal(body.error, 'La base de datos no respondió a tiempo. Intenta de nuevo en unos minutos.');
  const payload = JSON.parse(lines[0].slice('[ZF_LOG] log_c9fb1be42870 '.length));
  assert.equal(payload.message, 'La base de datos no respondió (select companies): timeout exceeded when trying to connect.');
  assert.equal(payload.type, 'database_unavailable');
  assert.equal(payload.query, 'select companies');
  assert.deepEqual(payload.stack, [
    'getCompany (packages/core/dist/services/company.service.js:125:18)',
    'syncFalabellaOrders (packages/server/src/falabella-sync.js:830:21)',
  ]);
  assert.doesNotMatch(lines[0], /falabella_api_key|params|drizzle/);
});
