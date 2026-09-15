import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshRealtimeNotifications,
  initialRealtimeNotifications,
  unreadRealtimeNotifications,
} from './operator-notification-alert.ts';

const marketplace = {
  id: 'marketplace_mutation:41:succeeded',
  kind: 'marketplace_mutation',
  severity: 'success',
  title: 'Stock actualizado en Falabella',
  body: 'MCS12309843 quedó en 99 unidades.',
  href: '/productos',
  moduleLabel: 'Catálogo',
  count: 1,
  createdAt: '2026-09-15T15:01:00.000Z',
  unread: true,
};

test('una actualización nueva de Falabella activa el aviso en vivo', () => {
  const incoming = unreadRealtimeNotifications([
    marketplace,
    { ...marketplace, id: 'read', unread: false },
    { ...marketplace, id: 'overdue', kind: 'bandeja_overdue' },
  ]);
  assert.deepEqual(incoming.map((item) => item.id), ['marketplace_mutation:41:succeeded']);
  assert.deepEqual(freshRealtimeNotifications([], incoming), [marketplace]);
});

test('un aviso ya visto no vuelve a producir toast ni sonido', () => {
  assert.deepEqual(
    freshRealtimeNotifications(['marketplace_mutation:41:succeeded'], [marketplace]),
    [],
  );
});

test('al recargar solo anuncia una actualización terminada durante la nueva sesión', () => {
  const startedAt = Date.parse('2026-09-15T15:00:00.000Z');
  assert.deepEqual(
    initialRealtimeNotifications([{ ...marketplace, createdAt: '2026-09-15T15:00:02.000Z' }], startedAt),
    [{ ...marketplace, createdAt: '2026-09-15T15:00:02.000Z' }],
  );
  assert.deepEqual(
    initialRealtimeNotifications([{ ...marketplace, createdAt: '2026-09-15T14:59:00.000Z' }], startedAt),
    [],
  );
});
