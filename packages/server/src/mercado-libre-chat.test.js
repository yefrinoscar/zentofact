import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadOrderAttachment,
  getOrderConversation,
  listUnreadMessages,
  sendOrderMessage,
  unreadOrderIds,
  uploadOrderAttachment,
} from './mercado-libre-chat.js';

function orderRow(overrides = {}) {
  return {
    id: 44,
    company_id: 8,
    external_order_id: '2000018761771764',
    external_order_number: '2000018761771764',
    order_status: 'confirmed',
    fulfillment_status: 'ready_to_ship',
    customer: { name: 'Diego Alvarado' },
    metadata: { packId: '2000015319992713', buyerId: '999' },
    channel_code: 'mercado_libre',
    ...overrides,
  };
}

function page(overrides = {}) {
  return {
    packId: '2000015319992713',
    sellerId: '555',
    messages: [
      {
        messageId: 'm1',
        fromUserId: '999',
        toUserId: '555',
        text: '¿Llega hoy?',
        status: 'available',
        moderationStatus: 'clean',
        createdAt: '2026-10-03T12:00:00.000Z',
        readAt: null,
        attachments: [],
        resources: [],
      },
      {
        messageId: 'm2',
        fromUserId: '555',
        toUserId: '999',
        text: 'Sí, hoy llega.',
        status: 'available',
        moderationStatus: 'clean',
        createdAt: '2026-10-03T12:05:00.000Z',
        readAt: null,
        attachments: [{
          attachmentId: 'guia.pdf',
          filename: 'guia.pdf',
          contentType: 'application/pdf',
          size: 1024,
        }],
        resources: [],
      },
      {
        messageId: 'm3',
        fromUserId: '0',
        toUserId: '999',
        text: 'Mercado Libre: compra protegida.',
        status: 'available',
        moderationStatus: 'clean',
        createdAt: '2026-10-03T12:06:00.000Z',
        readAt: null,
        attachments: [],
        resources: [],
      },
    ],
    total: 3,
    offset: 0,
    limit: 50,
    conversationStatus: {
      path: '/packs/2000015319992713/sellers/555',
      status: 'active',
      substatus: null,
      statusDate: '2026-10-03T12:00:00.000Z',
      claimId: null,
      shippingId: '55',
    },
    sellerMaxMessageLength: 350,
    raw: {},
    ...overrides,
  };
}

function deps({ client, order = orderRow(), company = { id: 8, mercadoLibreUserId: '555' } } = {}) {
  return {
    core: { pool: null, getCompany: async () => company },
    db: {},
    loadOrder: async () => order,
    getCompany: async () => company,
    clientForCompany: async () => client,
  };
}

test('unreadOrderIds normaliza, deduplica y limita la lista', () => {
  assert.deepEqual(unreadOrderIds('3,1,3,0,-2,abc,2'), [3, 1, 2]);
  assert.deepEqual(unreadOrderIds([7, '7', 8]), [7, 8]);
});

test('mapea la conversación posventa con direcciones y adjuntos', async () => {
  const context = deps({ client: { getPackMessages: async () => page() } });
  const conversation = await getOrderConversation({ orderId: 44 }, context);

  assert.equal(conversation.orderId, 44);
  assert.equal(conversation.buyerId, '999');
  assert.equal(conversation.buyerName, 'Diego Alvarado');
  assert.equal(conversation.blocked, null);
  assert.equal(conversation.conversation.status, 'active');
  assert.equal(conversation.sellerMaxMessageLength, 350);
  assert.deepEqual(conversation.messages.map((message) => message.direction), ['buyer', 'seller', 'system']);
  assert.equal(conversation.messages[0].text, '¿Llega hoy?');
  assert.deepEqual(conversation.messages[1].attachments, [{
    id: 'guia.pdf',
    name: 'guia.pdf',
    size: 1024,
    contentType: 'application/pdf',
  }]);
});

test('marca bloqueada la conversación de un pedido cancelado', async () => {
  const context = deps({
    client: { getPackMessages: async () => page() },
    order: orderRow({ order_status: 'cancelled' }),
  });
  const conversation = await getOrderConversation({ orderId: 44 }, context);
  assert.deepEqual(conversation.blocked, { reason: 'cancelled', substatus: 'blocked_by_cancelled_order' });
});

test('respeta el motivo de bloqueo que informa Mercado Libre', async () => {
  const context = deps({
    client: {
      getPackMessages: async () => page({
        conversationStatus: {
          path: '/packs/1/sellers/555',
          status: 'blocked',
          substatus: 'blocked_by_mediation',
          statusDate: null,
          claimId: 'CLAIM-1',
          shippingId: null,
        },
      }),
    },
  });
  const conversation = await getOrderConversation({ orderId: 44 }, context);
  assert.deepEqual(conversation.blocked, { reason: 'mediation', substatus: 'blocked_by_mediation' });
});

test('envía el mensaje con el comprador resuelto desde la orden', async () => {
  const calls = [];
  const client = {
    getPackMessages: async () => page(),
    sendPackMessage: async (options) => {
      calls.push(options);
      return {
        messageId: 'sent-1',
        fromUserId: '555',
        toUserId: '999',
        text: options.text,
        status: 'available',
        moderationStatus: 'clean',
        createdAt: '2026-10-03T13:00:00.000Z',
        readAt: null,
        attachments: [],
        resources: [],
      };
    },
  };
  const result = await sendOrderMessage({ orderId: 44, text: 'Hola', attachmentId: 'att-1' }, deps({ client }));
  assert.equal(result.sent, true);
  assert.equal(result.message.direction, 'seller');
  assert.deepEqual(calls[0], {
    packId: '2000015319992713',
    sellerId: '555',
    fromUserId: '555',
    toUserId: '999',
    text: 'Hola',
    attachments: ['att-1'],
  });
});

test('rechaza mensajes vacíos o que superan los 350 caracteres', async () => {
  const context = deps({ client: {} });
  await assert.rejects(() => sendOrderMessage({ orderId: 44, text: '   ' }, context), /Escribe un mensaje/);
  await assert.rejects(
    () => sendOrderMessage({ orderId: 44, text: 'x'.repeat(351) }, context),
    /350 caracteres/,
  );
});

test('sin comprador identificable pide esperar al primer mensaje', async () => {
  const client = {
    getOrder: async () => ({ buyerId: null }),
    getPackMessages: async () => page({ messages: [] }),
  };
  const context = deps({
    client,
    order: orderRow({ metadata: { packId: '2000015319992713' } }),
  });
  await assert.rejects(
    () => sendOrderMessage({ orderId: 44, text: 'Hola' }, context),
    /identificar al comprador/,
  );
});

test('lista no leídos por pedido sin marcar como leído', async () => {
  const queries = [];
  const context = {
    db: {
      query: async (sql, params) => {
        queries.push(params);
        return {
          rows: [
            { id: 44, company_id: 8, pack_id: '2000015319992713' },
            { id: 45, company_id: 8, pack_id: '2000015000000000' },
          ],
        };
      },
    },
    core: { pool: null },
    getCompany: async () => ({ id: 8, mercadoLibreUserId: '555' }),
    clientForCompany: async () => ({
      listUnreadPackMessages: async () => [
        { resource: '/packs/2000015319992713/sellers/555', packId: '2000015319992713', sellerId: '555', count: 2 },
      ],
    }),
  };
  const result = await listUnreadMessages({ orderIds: '44,45' }, context);
  assert.deepEqual(result.counts, { 44: 2, 45: 0 });
  assert.deepEqual(queries[0], [[44, 45]]);
});

test('la bandeja no se cae si Mercado Libre falla al contar no leídos', async () => {
  const context = {
    db: {
      query: async () => ({ rows: [{ id: 44, company_id: 8, pack_id: 'p-1' }] }),
    },
    core: { pool: null },
    getCompany: async () => ({ id: 8, mercadoLibreUserId: '555' }),
    clientForCompany: async () => ({
      listUnreadPackMessages: async () => {
        throw new Error('sin token');
      },
    }),
  };
  const result = await listUnreadMessages({ orderIds: [44] }, context);
  assert.deepEqual(result.counts, { 44: 0 });
});

test('sube y descarga adjuntos del pedido', async () => {
  const client = {
    uploadMessageAttachment: async (options) => {
      assert.equal(options.filename, 'foto.png');
      assert.deepEqual([...options.file], [1, 2]);
      return { attachmentId: 'att-9', raw: {} };
    },
    getMessageAttachment: async (attachmentId) => {
      assert.equal(attachmentId, 'att-9');
      return { bytes: new Uint8Array([9]), contentType: 'image/png' };
    },
  };
  const context = deps({ client });
  const upload = await uploadOrderAttachment({
    orderId: 44,
    file: new Uint8Array([1, 2]),
    filename: 'foto.png',
    contentType: 'image/png',
  }, context);
  assert.deepEqual(upload, { attachmentId: 'att-9', name: 'foto.png', size: 2 });

  const download = await downloadOrderAttachment({ orderId: 44, attachmentId: 'att-9' }, context);
  assert.equal(download.contentType, 'image/png');
  assert.equal(download.bytes[0], 9);
});
