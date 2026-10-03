import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockedBuyerCopy,
  buyerMessageClock,
  buyerMessageDayKey,
  firstUnreadBuyerIndex,
  formatAttachmentSize,
  groupBuyerMessagesByDay,
  isImageAttachment,
  validateBuyerAttachment,
} from './buyer-messages.ts';

const message = (overrides = {}) => ({
  id: 'm1',
  direction: 'buyer',
  text: 'Hola',
  sentAt: '2026-10-03T13:00:00.000Z',
  readAt: null,
  attachments: [],
  ...overrides,
});

test('agrupa los mensajes por día en hora de Lima', () => {
  const now = new Date('2026-10-04T18:00:00.000Z');
  const messages = [
    message({ id: 'c', sentAt: '2026-10-03T20:00:00.000Z' }),
    message({ id: 'a', sentAt: '2026-10-04T14:00:00.000Z' }),
    message({ id: 'b', direction: 'seller', sentAt: '2026-10-04T15:00:00.000Z' }),
  ];
  const groups = groupBuyerMessagesByDay(messages, now);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, '2026-10-03');
  assert.equal(groups[0].label, 'Ayer');
  assert.deepEqual(groups[0].messages.map((entry) => entry.id), ['c']);
  assert.equal(groups[1].key, '2026-10-04');
  assert.equal(groups[1].label, 'Hoy');
  assert.deepEqual(groups[1].messages.map((entry) => entry.id), ['a', 'b']);
  assert.equal(buyerMessageDayKey('2026-10-04T23:00:00.000Z'), '2026-10-04');
});

test('calcula el primer mensaje sin leer a partir del conteo previo', () => {
  const messages = [
    message({ id: 'a', direction: 'buyer' }),
    message({ id: 'b', direction: 'seller' }),
    message({ id: 'c', direction: 'buyer' }),
    message({ id: 'd', direction: 'buyer' }),
  ];
  assert.equal(firstUnreadBuyerIndex(messages, 0), null);
  assert.equal(firstUnreadBuyerIndex(messages, 2), 2);
  assert.equal(firstUnreadBuyerIndex(messages, 99), 0);
  assert.equal(firstUnreadBuyerIndex([message({ direction: 'seller' })], 3), null);
});

test('valida tipo y tamaño de adjuntos', () => {
  assert.equal(validateBuyerAttachment({ name: 'foto.PNG', size: 1024 }), null);
  assert.equal(validateBuyerAttachment({ name: 'guia.pdf', size: 1024 }), null);
  assert.equal(validateBuyerAttachment({ name: 'archivo.docx', size: 1024 }), 'type');
  assert.equal(validateBuyerAttachment({ name: 'foto.jpg', size: 26 * 1024 * 1024 }), 'size');
  assert.equal(isImageAttachment({ id: 'a', name: 'foto.jpeg', size: null, contentType: null }), true);
  assert.equal(isImageAttachment({ id: 'a', name: 'guia.pdf', size: null, contentType: 'application/pdf' }), false);
});

test('formatea tamaño y hora de los mensajes', () => {
  assert.equal(formatAttachmentSize(512), '512 B');
  assert.equal(formatAttachmentSize(2048), '2 KB');
  assert.equal(formatAttachmentSize(2.5 * 1024 * 1024), '2,5 MB');
  assert.equal(formatAttachmentSize(null), null);
  assert.equal(buyerMessageClock('2026-10-03T13:05:00.000Z').startsWith('08:05'), true);
});

test('microcopy de conversaciones bloqueadas por motivo', () => {
  assert.match(blockedBuyerCopy({ reason: 'cancelled', substatus: 'blocked_by_cancelled_order' }).body, /cancelado/);
  assert.match(blockedBuyerCopy({ reason: 'mediation', substatus: null }).body, /mediación/);
  assert.match(blockedBuyerCopy({ reason: 'fulfillment', substatus: null }).body, /Fulfillment/);
  assert.match(blockedBuyerCopy({ reason: 'buyer', substatus: null }).body, /bloqueó la recepción/);
  assert.match(blockedBuyerCopy({ reason: 'other', substatus: null }).body, /no permite enviar mensajes/);
});
