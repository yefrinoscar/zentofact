import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  authorizationUrl,
  extractOrderItemSellerSku,
  extractSellerSku,
  hourPrecision,
  MercadoLibreApiClient,
} from '../dist/index.js';

describe('oauth helpers', () => {
  it('builds the Peru authorization URL', () => {
    const url = authorizationUrl({
      appId: '123',
      redirectUri: 'https://app.example/cb',
      state: 'abc',
    });
    assert.equal(
      url,
      'https://auth.mercadolibre.com.pe/authorization?response_type=code&client_id=123&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&state=abc',
    );
  });
});

describe('sku helpers', () => {
  it('reads SELLER_SKU and ignores seller_custom_field', () => {
    assert.equal(
      extractSellerSku({
        seller_custom_field: 'NOT-SKU',
        attributes: [{ id: 'SELLER_SKU', value_name: '  HOG025  ' }],
      }),
      'HOG025',
    );
    assert.equal(extractSellerSku({ seller_custom_field: 'NOT-SKU' }), null);
  });

  it('reads the order line seller_sku', () => {
    assert.equal(extractOrderItemSellerSku({ item: { seller_sku: 'HOG025' } }), 'HOG025');
    assert.equal(extractOrderItemSellerSku({ item: { seller_custom_field: 'x' } }), null);
  });
});

describe('hourPrecision', () => {
  it('truncates to the hour for search filters', () => {
    assert.equal(hourPrecision('2026-03-15T14:37:22.000Z'), '2026-03-15T14:00:00.000-00:00');
  });
});

describe('MercadoLibreApiClient', () => {
  it('sends Bearer tokens and the shipment format header', async () => {
    const fetchImpl = mock.fn(async () => new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const client = new MercadoLibreApiClient({
      accessToken: 'tok',
      fetchImpl,
    });
    await client.getMe();
    await client.getShipment('99');

    const firstCall = fetchImpl.mock.calls[0].arguments;
    const secondCall = fetchImpl.mock.calls[1].arguments;
    assert.equal(String(firstCall[0]), 'https://api.mercadolibre.com/users/me');
    assert.equal(String(secondCall[0]), 'https://api.mercadolibre.com/shipments/99');
    assert.equal(new Headers(firstCall[1].headers).get('authorization'), 'Bearer tok');
    assert.equal(new Headers(secondCall[1].headers).get('x-format-new'), 'true');
  });

  it('throws on HTTP failures', async () => {
    const client = new MercadoLibreApiClient({
      accessToken: 'tok',
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: 'invalid_token', status: 401 }), { status: 401 }),
    });
    await assert.rejects(
      () => client.getMe(),
      (error) => error instanceof Error && /HTTP 401/.test(error.message),
    );
  });

  it('downloads shipment labels as bytes', async () => {
    const fetchImpl = mock.fn(async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    }));
    const client = new MercadoLibreApiClient({ accessToken: 'tok', fetchImpl });
    const bytes = await client.getShipmentLabels(['900000031']);
    assert.equal(bytes[0], 0x25);
    const url = String(fetchImpl.mock.calls[0].arguments[0]);
    assert.match(url, /\/shipment_labels\?/);
    assert.match(url, /shipment_ids=900000031/);
    assert.match(url, /response_type=pdf/);
  });

  it('allows HTTP only on localhost', () => {
    assert.ok(new MercadoLibreApiClient({
      accessToken: 'tok',
      baseUrl: 'http://127.0.0.1:3999',
      fetchImpl: async () => new Response('{}'),
    }));
    assert.throws(
      () => new MercadoLibreApiClient({ accessToken: 'tok', baseUrl: 'http://api.mercadolibre.com' }),
      /HTTPS/,
    );
  });

  it('refuses sandbox tokens against the live API', async () => {
    const client = new MercadoLibreApiClient({ accessToken: 'SANDBOX-LIMBO-ACCESS' });
    await assert.rejects(() => client.getMe(), /sandbox/);
  });
});

describe('MercadoLibre chat', () => {
  it('lists pack messages with the post_sale tag', async () => {
    const fetchImpl = mock.fn(async () => new Response(JSON.stringify({
      paging: { limit: 10, offset: 0, total: 1 },
      conversation_status: {
        path: '/packs/123/sellers/555',
        status: 'active',
        substatus: null,
        status_date: '2026-10-03T13:00:00Z',
        claim_id: null,
        shipping_id: '55',
      },
      messages: [{
        id: 'm1',
        site_id: 'MPE',
        from: { user_id: 999 },
        to: { user_id: 555 },
        status: 'available',
        text: '¿Llega mañana?',
        message_date: { created: '2026-10-03T12:00:00Z', read: null },
        message_moderation: { status: 'clean' },
        message_attachments: [{ id: 'att1', filename: 'foto.png', content_type: 'image/png' }],
        message_resources: [{ id: '123', name: 'packs' }],
      }],
      seller_max_message_length: 350,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new MercadoLibreApiClient({ accessToken: 'tok', fetchImpl });
    const page = await client.getPackMessages({ packId: '123', sellerId: '555' });
    assert.equal(page.total, 1);
    assert.equal(page.conversationStatus.status, 'active');
    assert.equal(page.conversationStatus.shippingId, '55');
    assert.equal(page.sellerMaxMessageLength, 350);
    assert.equal(page.messages[0].messageId, 'm1');
    assert.equal(page.messages[0].fromUserId, '999');
    assert.equal(page.messages[0].text, '¿Llega mañana?');
    assert.equal(page.messages[0].attachments[0].filename, 'foto.png');
    assert.equal(page.messages[0].resources[0].name, 'packs');
    const url = String(fetchImpl.mock.calls[0].arguments[0]);
    assert.match(url, /\/messages\/packs\/123\/sellers\/555\?tag=post_sale$/);
  });

  it('can peek messages without marking them as read', async () => {
    const fetchImpl = mock.fn(async () => new Response('{}', { status: 200 }));
    const client = new MercadoLibreApiClient({ accessToken: 'tok', fetchImpl });
    await client.getPackMessages({ packId: '123', sellerId: '555', markAsRead: false, limit: 5 });
    const url = String(fetchImpl.mock.calls[0].arguments[0]);
    assert.match(url, /mark_as_read=false/);
    assert.match(url, /limit=5/);
  });

  it('sends a message with from/to identities and enforces the 350 character limit', async () => {
    const fetchImpl = mock.fn(async () => new Response(JSON.stringify({
      id: 'sent1',
      from: { user_id: 555 },
      to: { user_id: 999 },
      text: 'Hola',
    }), { status: 200 }));
    const client = new MercadoLibreApiClient({ accessToken: 'tok', fetchImpl });
    const sent = await client.sendPackMessage({
      packId: '123',
      sellerId: '555',
      fromUserId: '555',
      toUserId: '999',
      text: 'Hola',
    });
    assert.equal(sent.messageId, 'sent1');
    const [url, init] = fetchImpl.mock.calls[0].arguments;
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), {
      from: { user_id: '555' },
      to: { user_id: '999' },
      text: 'Hola',
    });
    assert.match(String(url), /tag=post_sale/);
    await assert.rejects(
      () => client.sendPackMessage({
        packId: '123',
        sellerId: '555',
        fromUserId: '555',
        toUserId: '999',
        text: 'x'.repeat(351),
      }),
      /350/,
    );
  });

  it('uploads and downloads attachments with the seller token', async () => {
    const fetchImpl = mock.fn(async (url) => {
      const value = String(url);
      if (value.includes('/messages/attachments/att-1')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response(JSON.stringify({ id: 'att-1' }), { status: 200 });
    });
    const client = new MercadoLibreApiClient({ accessToken: 'tok', siteId: 'MPE', fetchImpl });
    const upload = await client.uploadMessageAttachment({
      file: new Uint8Array([1]),
      filename: 'foto.png',
      contentType: 'image/png',
    });
    assert.equal(upload.attachmentId, 'att-1');
    const uploadUrl = String(fetchImpl.mock.calls[0].arguments[0]);
    assert.match(uploadUrl, /site_id=MPE/);
    const download = await client.getMessageAttachment('att-1');
    assert.equal(download.contentType, 'image/png');
    assert.equal(download.bytes.length, 3);
    await assert.rejects(
      () => client.uploadMessageAttachment({ file: new Uint8Array([1]), filename: 'nota.docx' }),
      /JPG, PNG, PDF o TXT/,
    );
  });

  it('lists unread conversations without marking them as read', async () => {
    const fetchImpl = mock.fn(async () => new Response(JSON.stringify({
      user_id: 555,
      results: [
        { resource: '/packs/123/sellers/555', count: 2 },
        { resource: '/packs/999/sellers/555', count: 1 },
      ],
    }), { status: 200 }));
    const client = new MercadoLibreApiClient({ accessToken: 'tok', fetchImpl });
    const conversations = await client.listUnreadPackMessages({ role: 'seller' });
    assert.equal(conversations.length, 2);
    assert.deepEqual(conversations[0], {
      resource: '/packs/123/sellers/555',
      packId: '123',
      sellerId: '555',
      count: 2,
    });
    const url = String(fetchImpl.mock.calls[0].arguments[0]);
    assert.match(url, /\/messages\/unread\?/);
    assert.match(url, /role=seller/);
    assert.match(url, /tag=post_sale/);
  });

  it('exposes the order buyer id for post-sale messages', async () => {
    const fetchImpl = mock.fn(async () => new Response(JSON.stringify({
      id: 2000018761771764,
      status: 'paid',
      buyer: { id: 823716784 },
      pack_id: '2000015319992713',
    }), { status: 200 }));
    const client = new MercadoLibreApiClient({ accessToken: 'tok', fetchImpl });
    const order = await client.getOrder('2000018761771764');
    assert.equal(order.buyerId, '823716784');
    assert.equal(order.packId, '2000015319992713');
  });
});
