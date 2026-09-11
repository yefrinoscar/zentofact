import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationAriaLabel,
  notificationElapsedLabel,
  parseOperatorNotification,
  parseOperatorNotificationsResponse,
  unreadBadgeLabel,
} from './notifications-presentation.ts';

const valid = {
  id: 'bandeja_overdue:3',
  kind: 'bandeja_overdue',
  severity: 'critical',
  title: 'Hay 3 pedidos vencidos',
  body: 'El plazo de envío ya pasó.',
  href: '/bandeja',
  moduleLabel: 'Bandeja',
  count: 3,
  createdAt: '2026-09-10T12:00:00.000Z',
  unread: true,
};

test('acepta un aviso operativo y descarta filas rotas', () => {
  const parsed = parseOperatorNotification(valid);
  assert.equal(parsed?.kind, 'bandeja_overdue');
  assert.equal(parsed?.unread, true);
  assert.equal(parseOperatorNotification({ ...valid, kind: 'email' }), null);
  assert.equal(parseOperatorNotification({ ...valid, href: 'https://evil.example' }), null);
  assert.equal(parseOperatorNotification({ ...valid, title: '' }), null);
});

test('el listado ignora ítems inválidos y recalcula el no leído si falta', () => {
  const parsed = parseOperatorNotificationsResponse({
    items: [valid, { id: 'x' }, { ...valid, id: 'insumo_low_stock:1:0', kind: 'insumo_low_stock', unread: false }],
  });
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.unreadCount, 1);
});

test('el distintivo del timbre se corta en 9+', () => {
  assert.equal(unreadBadgeLabel(0), '');
  assert.equal(unreadBadgeLabel(1), '1');
  assert.equal(unreadBadgeLabel(9), '9');
  assert.equal(unreadBadgeLabel(12), '9+');
});

test('el tiempo relativo usa minutos, horas y días', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  assert.equal(notificationElapsedLabel('2026-09-10T11:59:20.000Z', now), 'ahora');
  assert.equal(notificationElapsedLabel('2026-09-10T11:40:00.000Z', now), 'hace 20 min');
  assert.equal(notificationElapsedLabel('2026-09-10T09:00:00.000Z', now), 'hace 3 h');
  assert.equal(notificationElapsedLabel('2026-09-08T12:00:00.000Z', now), 'hace 2 días');
  assert.equal(notificationElapsedLabel(null, now), '');
});

test('el aria-label del timbre incluye la cantidad sin leer', () => {
  assert.equal(notificationAriaLabel(0), 'Avisos');
  assert.equal(notificationAriaLabel(1), 'Avisos, 1 sin leer');
  assert.equal(notificationAriaLabel(4), 'Avisos, 4 sin leer');
});
