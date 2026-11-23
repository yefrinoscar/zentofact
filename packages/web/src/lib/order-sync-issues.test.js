import test from 'node:test';
import assert from 'node:assert/strict';
import { orderSyncIssueOrigin, orderSyncIssues } from './order-sync-issues.ts';

test('separa fallas de Falabella de errores propios', () => {
  assert.equal(
    orderSyncIssueOrigin('1 pedido(s) fallaron; se reintentará la ventana. Último error: Falabella respondió HTTP 503 sin JSON válido en GetOrderItems: upstream connect error'),
    'marketplace',
  );
  assert.equal(orderSyncIssueOrigin('No se pudo conectar con Falabella (GetOrder): ECONNRESET'), 'marketplace');
  assert.equal(orderSyncIssueOrigin('Cannot read properties of undefined'), 'zentofact');
});

test('solo lista cuentas con error o parcial y un motivo', () => {
  const issues = orderSyncIssues([
    { channelAccountId: 1, channelCode: 'falabella', displayName: 'MANTA RAYA EIRL', status: 'partial', lastError: 'Falabella respondió HTTP 503', lastLogId: 'log_35d2e55e4ec2', lastFinishedAt: '2026-11-23T13:12:55Z' },
    { channelAccountId: 2, channelCode: 'falabella', displayName: 'LIMBO', status: 'success', lastError: null },
    { channelAccountId: 3, channelCode: 'ripley', displayName: 'YAKURUNA', status: 'error', lastError: 'boom', lastFinishedAt: '2026-11-23T14:00:00Z' },
  ]);
  assert.deepEqual(issues.map((issue) => issue.key), [3, 1]);
  assert.equal(issues[1].originLabel, 'Falla de Falabella');
  assert.equal(issues[1].logId, 'log_35d2e55e4ec2');
  assert.equal(issues[0].originLabel, 'Error de Zentofact');
});

test('usa el origen informado por el servidor antes que el texto', () => {
  assert.equal(orderSyncIssueOrigin('Falabella respondió HTTP 503', 'zentofact'), 'zentofact');
  assert.equal(orderSyncIssueOrigin('E009 Access Denied', 'falabella'), 'marketplace');
});

test('filtra por el canal seleccionado', () => {
  const accounts = [
    { channelAccountId: 1, channelCode: 'falabella', displayName: 'LIMBO', status: 'error', lastError: 'x' },
    { channelAccountId: 2, channelCode: 'ripley', displayName: 'LIMBO', status: 'error', lastError: 'y' },
  ];
  assert.deepEqual(orderSyncIssues(accounts, 'ripley').map((issue) => issue.key), [2]);
  assert.equal(orderSyncIssues(accounts, 'all').length, 2);
});
