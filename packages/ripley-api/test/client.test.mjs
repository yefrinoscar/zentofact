import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRipleySvcBaseUrl, RipleyApiClient, RipleySvcClient } from '../dist/index.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('lista las ofertas de Ripley con autenticación y paginación Mirakl', async () => {
  let request;
  const client = new RipleyApiClient({
    baseUrl: 'https://marketplace.ripley.test', apiKey: 'secret', shopId: 17,
    fetchImpl: async (url, init) => {
      request = { url: new URL(url), init };
      return response({ total_count: 1, offers: [{ offer_id: 11, sku: 'SELLER-1', product_sku: 'P-1', product_title: 'Producto', active: true, quantity: 4, price: 29.9 }] });
    },
  });

  const page = await client.listOffers({ max: 50, offset: 100 });
  assert.equal(request.url.pathname, '/api/offers');
  assert.equal(request.url.searchParams.get('shop_id'), '17');
  assert.equal(request.url.searchParams.get('max'), '50');
  assert.equal(request.url.searchParams.get('offset'), '100');
  assert.equal(request.init.headers.Authorization, 'secret');
  assert.deepEqual(page.offers[0], {
    offerId: '11', sellerSku: 'SELLER-1', productSku: 'P-1', productTitle: 'Producto', active: true, quantity: 4, price: 29.9,
    imageUrl: null, raw: { offer_id: 11, sku: 'SELLER-1', product_sku: 'P-1', product_title: 'Producto', active: true, quantity: 4, price: 29.9 },
  });
});

test('obtiene imágenes con P11 y prefiere dam_url', async () => {
  let request;
  const client = new RipleyApiClient({
    baseUrl: 'https://marketplace.ripley.test', apiKey: 'secret',
    fetchImpl: async (url) => {
      request = new URL(url);
      return response({ products: [{ product_sku: 'P-1', product_title: 'Producto', product_media: { dam_url: 'https://dam.ripley.test/p-1.jpg', media_url: 'https://media.ripley.test/p-1.jpg', type: 'large' } }] });
    },
  });
  const products = await client.listProductContents(['P-1']);
  assert.equal(request.pathname, '/api/products/offers');
  assert.equal(request.searchParams.get('product_ids'), 'P-1');
  assert.equal(products[0].imageUrl, 'https://dam.ripley.test/p-1.jpg');
});

test('lee product_medias cuando P11 devuelve un arreglo', async () => {
  const client = new RipleyApiClient({
    baseUrl: 'https://marketplace.ripley.test', apiKey: 'secret',
    fetchImpl: async () => response({
      products: [{
        product_sku: 'P-2',
        product_title: 'Escritorio',
        product_medias: [{ media_url: 'https://home.ripley.com.pe/desk.jpg', type: 'SMALL' }],
      }],
    }),
  });
  const products = await client.listProductContents(['P-2']);
  assert.equal(products[0].imageUrl, 'https://home.ripley.com.pe/desk.jpg');
});

test('trae todas las páginas de ofertas', async () => {
  const calls = [];
  const client = new RipleyApiClient({
    baseUrl: 'https://marketplace.ripley.test', apiKey: 'secret',
    fetchImpl: async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      calls.push(offset);
      const offers = offset === 0
        ? Array.from({ length: 100 }, (_, index) => ({ sku: `SKU-${index}` }))
        : [{ sku: 'SKU-100' }];
      return response({ total_count: 101, offers });
    },
  });

  const offers = await client.listAllOffers();
  assert.equal(offers.length, 101);
  assert.deepEqual(calls, [0, 100]);
});

test('lista y normaliza pedidos de Ripley mediante Mirakl OR11', async () => {
  let request;
  const raw = {
    order_id: 'R-100-A', commercial_id: 'R-100', order_state: 'SHIPPING',
    created_date: '2026-08-20T10:00:00Z', last_updated_date: '2026-08-20T11:00:00Z',
    currency_iso_code: 'PEN', total_price: '149.90', order_lines: [],
  };
  const client = new RipleyApiClient({
    baseUrl: 'https://marketplace.ripley.test', apiKey: 'secret', shopId: 17,
    fetchImpl: async (url, init) => {
      request = { url: new URL(url), init };
      return response({ total_count: 1, orders: [raw] });
    },
  });

  const page = await client.listOrders({
    max: 50, offset: 100, orderStateCodes: ['WAITING_ACCEPTANCE', 'SHIPPING'],
    startUpdateDate: '2026-08-20T00:00:00Z',
  });
  assert.equal(request.url.pathname, '/api/orders');
  assert.equal(request.url.searchParams.get('shop_id'), '17');
  assert.equal(request.url.searchParams.get('order_state_codes'), 'WAITING_ACCEPTANCE,SHIPPING');
  assert.equal(request.url.searchParams.get('start_update_date'), '2026-08-20T00:00:00Z');
  assert.equal(request.init.headers.Authorization, 'secret');
  assert.deepEqual(page.orders[0], {
    orderId: 'R-100-A', orderNumber: 'R-100', status: 'SHIPPING',
    createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-20T11:00:00.000Z',
    currency: 'PEN', total: 149.9, raw,
  });
});

test('trae todas las páginas de pedidos', async () => {
  const calls = [];
  const client = new RipleyApiClient({
    baseUrl: 'https://marketplace.ripley.test', apiKey: 'secret',
    fetchImpl: async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      calls.push(offset);
      const orders = offset === 0
        ? Array.from({ length: 100 }, (_, index) => ({ order_id: `R-${index}` }))
        : [{ order_id: 'R-100' }];
      return response({ total_count: 101, orders });
    },
  });

  const orders = await client.listAllOrders({ startDate: '2026-08-01T00:00:00Z' });
  assert.equal(orders.length, 101);
  assert.deepEqual(calls, [0, 100]);
});

test('si el login vendor falla, no usa el login web y reporta el Basic enviado', async () => {
  const paths = [];
  const client = new RipleySvcClient({
    baseUrl: 'https://sellercenter.ripley.test',
    username: 'seller_limbo',
    password: 'clave-invalida',
    country: 'PE',
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      paths.push(parsed.pathname);
      if (parsed.pathname.endsWith('/auth/login/vendor')) {
        assert.equal(parsed.host, 'sellercenter.ripley.test');
        assert.equal(init.headers['X-Country'], 'PE');
        assert.equal(init.headers.Authorization, `Basic ${btoa('seller_limbo:clave-invalida')}`);
        assert.equal(init.body, undefined);
        return response({ message: 'Invalid authentication credentials' }, 403);
      }
      return response({ message: 'no debe llamarse el login web' }, 500);
    },
  });

  await assert.rejects(
    () => client.listLabels({ orderId: '7935614201' }),
    (error) => {
      assert.deepEqual(paths, ['/api/current/auth/login/vendor']);
      assert.match(error.message, /HTTP 403: Invalid authentication credentials/);
      assert.match(error.message, /POST \/api\/current\/auth\/login\/vendor \(sellercenter.ripley.test\)/);
      assert.match(error.message, /Authorization Basic \(usuario seller_limbo, clave de 14 caracteres\)/);
      assert.match(error.message, /X-Country PE/);
      assert.match(error.message, /no uses la API key de Mirakl/);
      assert.equal(error.details.ripleyAuth.username, 'seller_limbo');
      assert.equal(error.details.ripleyAuth.passwordLength, 14);
      assert.equal(error.details.ripleyAuth.sent.officialApi.path, '/api/current/auth/login/vendor');
      assert.equal(error.details.ripleyAuth.sent.officialApi.body, null);
      assert.equal(error.details.ripleyAuth.sent.webFallback, undefined);
      assert.deepEqual(error.details.ripleyAuth.attempts, [{
        step: 'vendor',
        method: 'POST',
        path: '/api/current/auth/login/vendor',
        host: 'sellercenter.ripley.test',
        status: 403,
        ripley: 'Invalid authentication credentials',
      }]);
      return true;
    },
  );
});

test('autentica SVC y lista la bandeja logística Fast Management', async () => {
  const calls = [];
  const client = new RipleySvcClient({
    baseUrl: 'https://sellercenter.ripley.test', username: 'seller', password: 'clave',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: new URL(url), init });
      if (new URL(url).pathname.endsWith('/auth/login/vendor')) return response({ access_token: 'token-1' });
      return response({ total: 1, orders: [{ order_id: 'R-1' }] });
    },
  });

  const result = await client.listLogisticsOrders({ page: 2, limit: 50, statusManagement: 'TO_PREPARE' });
  assert.deepEqual(result, { total: 1, orders: [{ order_id: 'R-1' }] });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Basic ${btoa('seller:clave')}`);
  assert.equal(calls[1].url.searchParams.get('is_fast_management'), 'true');
  assert.equal(calls[1].url.searchParams.get('status_management'), 'TO_PREPARE');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer token-1');
});

test('renueva una vez el token SVC cuando expira', async () => {
  let loginCount = 0;
  let listCount = 0;
  const client = new RipleySvcClient({
    baseUrl: 'https://sellercenter.ripley.test', username: 'seller', password: 'clave',
    fetchImpl: async (url) => {
      if (new URL(url).pathname.endsWith('/auth/login/vendor')) {
        loginCount += 1;
        return response({ access_token: `token-${loginCount}` });
      }
      listCount += 1;
      return listCount === 1 ? response({ message: 'expired' }, 401) : response({ labels: [] });
    },
  });
  assert.deepEqual(await client.listLabels({ find: 'printable' }), { labels: [] });
  assert.equal(loginCount, 2);
  assert.equal(listCount, 2);
});

test('actualiza la cantidad de bultos de una orden SVC', async () => {
  const calls = [];
  const client = new RipleySvcClient({
    baseUrl: 'https://sellercenter.ripley.test', username: 'seller', password: 'clave',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: new URL(url), init });
      if (new URL(url).pathname.endsWith('/auth/login/vendor')) return response({ access_token: 'token-1' });
      return response({ accepted: true }, 202);
    },
  });

  assert.deepEqual(await client.editPackages('svc-order-1', 2), { accepted: true });
  assert.equal(calls[1].url.pathname, '/api/v7/label/label/generate/edit/packages');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    label: { packages: 2 },
    order: { _id: 'svc-order-1' },
  });
});

test('descarga juntas las etiquetas seleccionadas', async () => {
  const calls = [];
  const client = new RipleySvcClient({
    baseUrl: 'https://sellercenter.ripley.test', username: 'seller', password: 'clave',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: new URL(url), init });
      if (new URL(url).pathname.endsWith('/auth/login/vendor')) return response({ access_token: 'token-1' });
      return response({ labels_generated: 'JVBERi0=', orders_without_labels: [] });
    },
  });

  await client.downloadLabels(['label-1', 'label-2']);
  assert.equal(calls[1].url.pathname, '/api/v7/label/label/download/');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    orders: [{ document_id: 'label-1' }, { document_id: 'label-2' }],
  });
});

test('agenda el recojo y genera el manifiesto con ids de etiquetas', async () => {
  const calls = [];
  const client = new RipleySvcClient({
    baseUrl: 'https://sellercenter.ripley.test', username: 'seller', password: 'clave',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: new URL(url), init });
      if (new URL(url).pathname.endsWith('/auth/login/vendor')) return response({ access_token: 'token-1' });
      return response({ manifests: [{ _id: 'manifest-1' }] });
    },
  });
  const payload = {
    scheduleableFromToday: {
      totalLabels: 1,
      labels: [{ _id: 'label-1', order_id: 'R-1', courier: 'RIPLEY' }],
      pickupDate: '2026-08-22',
    },
    scheduleableFromTomorrow: { totalLabels: 0, labels: [], pickupDate: '2026-08-23' },
    warehouseAddress: 'Av. Prueba 123',
  };

  await client.scheduleManifest(payload);
  assert.equal(calls[1].url.pathname, '/api/v1/manifest/schedule/generate');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), payload);
});

test('consulta y descarga un manifiesto por su id', async () => {
  const calls = [];
  const client = new RipleySvcClient({
    baseUrl: 'https://sellercenter.ripley.test', username: 'seller', password: 'clave',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: new URL(url), init });
      if (new URL(url).pathname.endsWith('/auth/login/vendor')) return response({ access_token: 'token-1' });
      return response({ pdf: 'JVBERi0=' });
    },
  });

  await client.getManifest('manifest / 1');
  await client.downloadManifest('manifest / 1');
  assert.equal(calls[1].url.pathname, '/bff/v1/manifest/manifest%20%2F%201');
  assert.equal(calls[2].url.pathname, '/bff/v1/manifest/manifest%20%2F%201/download');
});

test('desvincula etiquetas de un manifiesto', async () => {
  const calls = [];
  const client = new RipleySvcClient({
    baseUrl: 'https://sellercenter.ripley.test', username: 'seller', password: 'clave',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: new URL(url), init });
      if (new URL(url).pathname.endsWith('/auth/login/vendor')) return response({ access_token: 'token-1' });
      return response({ updated: true });
    },
  });

  await client.detachManifestLabels('manifest-1', ['label-1']);
  assert.equal(calls[1].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].init.body), { labels: [{ _id: 'label-1' }] });
});

test('usa SVC por defecto y rechaza una URL comercial Mirakl', () => {
  assert.equal(resolveRipleySvcBaseUrl(''), 'https://sellercenter.ripleylabs.com');
  assert.throws(() => resolveRipleySvcBaseUrl('https://ripleyperu-prod.mirakl.net'), /Mirakl/);
});

test('conserva la contraseña exacta al construir Basic Auth', async () => {
  const password = ' clave-con-espacios ';
  const client = new RipleySvcClient({
    baseUrl: 'https://sellercenter.ripley.test', username: 'seller', password,
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname.endsWith('/auth/login/vendor')) {
        assert.equal(init.headers.Authorization, `Basic ${btoa(`seller:${password}`)}`);
        return response({ status_code: 200, access_token: 'token' });
      }
      assert.equal(init.headers.Authorization, 'Bearer token');
      return response({ labels: [] });
    },
  });
  await client.listLabels();
});

test('una página HTML de login no se presenta como una lista SVC vacía', async () => {
  const client = new RipleySvcClient({
    baseUrl: '', username: 'seller', password: 'clave',
    fetchImpl: async (url) => new URL(url).pathname.endsWith('/auth/login/vendor')
      ? response({ access_token: 'token' })
      : new Response('<html>Iniciar sesión</html>', { headers: { 'content-type': 'text/html' } }),
  });
  await assert.rejects(() => client.listLabels(), /respuesta JSON/);
});
