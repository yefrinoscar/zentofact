const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL_POSTGRES ||= 'postgresql://test:test@127.0.0.1:5432/test';

const {
  cacheFalabellaManifestDocument,
  createFalabellaWebManifests,
  falabellaDiagnosticEndpoint,
  falabellaIsStaleDomError,
  falabellaLoginValidationMode,
  falabellaLocalCacheDiagnostic,
  falabellaManifestNeedsRemote,
  falabellaManifestDurationMs,
  falabellaManifestErrorMessage,
  falabellaProviderOrderMatchesRequest,
  findNewFalabellaManifests,
  mergeFalabellaManifestSummaries,
  matchFalabellaReadyOrderManifests,
  listFalabellaWebManifests,
  readCachedFalabellaManifest,
  readCachedFalabellaManifestDocument,
  readCachedFalabellaManifests,
  recordCachedFalabellaManifestDownload,
  resolveCachedFalabellaManifestDocumentRequests,
  selectFalabellaManifestOrders,
  upsertCachedFalabellaManifests,
  withManifestRunLock,
} = require('../dist/services/falabella-manifest-scraper.service.js');

test('guarda y recupera el PDF por compañía y UUID sin mezclar tiendas', async () => {
  const stored = new Map();
  const target = {
    async query(sql, values) {
      if (/UPDATE falabella_manifests SET/.test(sql)) {
        const [companyId, manifestId, buffer, filename, byteSize] = values;
        stored.set(`${companyId}:${manifestId}`, { buffer, filename, byteSize });
        return { rows: [{ manifest_id: manifestId }] };
      }
      const [companyId, manifestId] = values;
      const value = stored.get(`${companyId}:${manifestId}`);
      return { rows: value ? [{
        manifest_id: manifestId,
        manifest_code: companyId === 7 ? 'MF-7' : 'MF-8',
        pdf_data: value.buffer,
        pdf_filename: value.filename,
      }] : [] };
    },
  };
  const bytes = Buffer.from('%PDF-1.4\n%%EOF');
  await cacheFalabellaManifestDocument(7, 'same-uuid', {
    filename: 'manifesto-7.pdf', mimeType: 'application/pdf', base64: bytes.toString('base64'),
    manifestIds: ['same-uuid'], manifestCodes: ['MF-7'],
  }, target);
  assert.equal(await readCachedFalabellaManifestDocument(8, 'same-uuid', target), null);
  const document = await readCachedFalabellaManifestDocument(7, 'same-uuid', target);
  assert.equal(document.filename, 'manifesto-7.pdf');
  assert.equal(Buffer.from(document.base64, 'base64').toString(), bytes.toString());
  assert.deepEqual(document.manifestIds, ['same-uuid']);
  assert.equal(stored.get('7:same-uuid').byteSize, bytes.length);
});

test('rechaza guardar o leer un PDF de manifiesto dañado', async () => {
  await assert.rejects(
    cacheFalabellaManifestDocument(7, 'uuid-1', {
      filename: 'bad.pdf', mimeType: 'application/pdf', base64: Buffer.from('not-pdf').toString('base64'),
      manifestIds: ['uuid-1'], manifestCodes: [],
    }, { async query() { throw new Error('no debe escribir'); } }),
    /no es un PDF válido/,
  );
  await assert.rejects(
    readCachedFalabellaManifestDocument(7, 'uuid-1', {
      async query() {
        return { rows: [{
          manifest_id: 'uuid-1', manifest_code: 'MF-1',
          pdf_data: Buffer.from('broken'), pdf_filename: 'bad.pdf',
        }] };
      },
    }),
    /está dañado/,
  );
});

test('resuelve un manifiesto por UUID o código dentro de una sola compañía', async () => {
  const calls = [];
  const target = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{
        manifest_id: 'uuid-1', manifest_code: 'MF-1', shipment_provider: 'falabella',
        status: 'SENT', item_count: 2, provider_created_at: '2026-08-07T10:00:00.000Z',
      }] };
    },
  };
  const manifest = await readCachedFalabellaManifest(7, 'MF-1', target);
  assert.deepEqual(calls[0].values, [7, 'MF-1']);
  assert.match(calls[0].sql, /company_id=\$1 AND \(manifest_id=\$2 OR manifest_code=\$2\)/);
  assert.equal(manifest.id, 'uuid-1');
  assert.equal(manifest.code, 'MF-1');
});

test('registra la descarga solo para el UUID cacheado de la compañía', async () => {
  const calls = [];
  await recordCachedFalabellaManifestDownload(7, 'uuid-1', {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  });
  assert.deepEqual(calls[0].values, [7, 'uuid-1']);
  assert.match(calls[0].sql, /download_count=download_count\+1/);
  assert.match(calls[0].sql, /first_downloaded_at=COALESCE/);
  assert.match(calls[0].sql, /last_downloaded_at=NOW\(\)/);
});

test('resuelve el lote imprimible solo desde caché asociada y aísla UUID por compañía', async () => {
  const calls = [];
  const rowsByKey = new Map([
    ['7:MF-1', {
      manifest_id: 'same-uuid', manifest_code: 'MF-1', shipment_provider: 'falabella',
      status: 'PENDING', item_count: 1, created_by_app: true,
    }],
    ['7:same-uuid', {
      manifest_id: 'same-uuid', manifest_code: 'MF-1', shipment_provider: 'falabella',
      status: 'PENDING', item_count: 1, created_by_app: true,
    }],
    ['8:same-uuid', {
      manifest_id: 'same-uuid', manifest_code: 'MF-OTHER', shipment_provider: 'falabella',
      status: 'PENDING', item_count: 2, created_by_app: false,
    }],
  ]);
  const target = {
    async query(sql, values) {
      calls.push({ sql, values });
      const row = rowsByKey.get(`${values[0]}:${values[1]}`);
      return { rows: row ? [row] : [] };
    },
  };
  const resolved = await resolveCachedFalabellaManifestDocumentRequests([
    { companyId: 7, manifestId: 'MF-1' },
    { companyId: 7, manifestId: 'same-uuid' },
    { companyId: 8, manifestId: 'same-uuid' },
  ], target);

  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved.map((entry) => [entry.companyId, entry.manifest.id]), [
    [7, 'same-uuid'],
    [8, 'same-uuid'],
  ]);
  assert.match(calls[0].sql, /JOIN falabella_manifest_orders/);
  assert.match(calls[0].sql, /m\.company_id=\$1 AND \(m\.manifest_id=\$2 OR m\.manifest_code=\$2\)/);

  await assert.rejects(
    resolveCachedFalabellaManifestDocumentRequests([
      { companyId: 7, manifestId: 'not-cached' },
    ], target),
    /no está guardado para la tienda 7/,
  );
  await assert.rejects(
    resolveCachedFalabellaManifestDocumentRequests(
      Array.from({ length: 51 }, (_, index) => ({ companyId: 7, manifestId: `id-${index}` })),
      target,
    ),
    /hasta 50 manifiestos/,
  );
});

test('resuelve cobertura cacheada con identificadores tipados y aislados por compañía', async () => {
  const calls = [];
  const target = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [{
          company_id: 7,
          manifest_id: 'uuid-1',
          manifest_code: 'MF-1',
          shipment_provider: 'falabella',
          status: 'SENT',
          item_count: 1,
          provider_created_at: '2026-08-07T10:00:00.000Z',
          created_by_app: true,
          synced_at: '2026-08-07T11:00:00.000Z',
          local_order_id: 'ALIAS',
          order_number: 'ORDER-1',
          delivery_order_number: 'DELIVERY-1',
        }],
      };
    },
  };
  const cached = await readCachedFalabellaManifests(7, [
    { companyId: 7, orderId: 'ALIAS', orderNumber: 'LOCAL-1' },
    { companyId: 7, orderId: 'LOCAL-2', orderNumber: 'ALIAS' },
  ], target);

  assert.deepEqual(calls[0].values, [7, ['ALIAS', 'LOCAL-2'], ['LOCAL-1', 'ALIAS']]);
  assert.equal(cached.manifests[0].id, 'uuid-1');
  assert.equal(cached.manifests[0].createdByApp, true);
  assert.deepEqual(cached.missingOrders.map((order) => order.orderId), ['LOCAL-2']);
  assert.equal(cached.syncedAt, '2026-08-07T11:00:00.000Z');
  assert.equal(falabellaManifestNeedsRemote([
    { companyId: 7, orderId: 'ALIAS', orderNumber: 'LOCAL-1' },
  ], { ...cached, missingOrders: [] }), false);
  assert.equal(falabellaManifestNeedsRemote([
    { companyId: 7, orderId: 'LOCAL-2', orderNumber: 'ALIAS' },
  ], cached), true);
});

test('create sin selección válida termina sin abrir navegador ni cargar compañías', async () => {
  const empty = await createFalabellaWebManifests({});
  const malformed = await createFalabellaWebManifests({
    orders: [{ companyId: 0, orderId: 'ORDER-1' }],
  });
  const missingIdentity = await createFalabellaWebManifests({
    orders: [{ companyId: 5 }],
  });
  const partiallyMalformed = await createFalabellaWebManifests({
    orders: [
      { companyId: 5, orderId: 'ORDER-1' },
      { companyId: 0, orderId: 'ORDER-2' },
    ],
  });
  for (const result of [empty, malformed, missingIdentity, partiallyMalformed]) {
    assert.equal(result.companies, 0);
    assert.equal(result.createdManifests, 0);
    assert.deepEqual(result.results, []);
  }
});

test('el listado local no espera una creación que mantiene ocupado el lock global', async () => {
  let releaseCreation;
  let notifyLocked;
  const creationPending = new Promise((resolve) => { releaseCreation = resolve; });
  const locked = new Promise((resolve) => { notifyLocked = resolve; });
  const createRun = withManifestRunLock(async () => {
    notifyLocked();
    await creationPending;
  });
  await locked;
  try {
    const outcome = await Promise.race([
      listFalabellaWebManifests({}).then(() => 'listed'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 100)),
    ]);
    assert.equal(outcome, 'listed');
  } finally {
    releaseCreation();
    await createRun;
  }
});

test('persiste catálogo y asociación de pedidos en una transacción idempotente', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  await upsertCachedFalabellaManifests(7, [{
    id: 'uuid-1',
    code: 'MF-1',
    carrier: 'falabella',
    numberOfItems: 2,
    status: 'PENDING',
    createdAt: '2026-08-07T10:00:00.000Z',
    orders: [{ orderId: 'LOCAL-1', orderNumber: 'ORDER-1', deliveryOrderNumber: 'DELIVERY-1' }],
  }], ['uuid-1'], { async connect() { return client; }, query: client.query });

  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /INSERT INTO falabella_manifests/);
  assert.deepEqual(calls[1].values.slice(0, 4), [7, 'uuid-1', 'MF-1', 'falabella']);
  assert.equal(calls[1].values[7], true);
  assert.match(calls[1].sql, /created_by_app=falabella_manifests\.created_by_app OR EXCLUDED\.created_by_app/);
  assert.match(calls[2].sql, /INSERT INTO falabella_manifest_orders/);
  assert.doesNotMatch(calls[2].sql, /manifest_items/);
  assert.deepEqual(calls[2].values, [7, 'uuid-1', 'LOCAL-1', 'ORDER-1', 'DELIVERY-1']);
  assert.equal(calls[3].sql, 'COMMIT');
  assert.equal(calls[4].sql, 'RELEASE');

  calls.length = 0;
  await upsertCachedFalabellaManifests(7, [{
    id: 'uuid-1',
    code: 'MF-1',
    carrier: 'falabella',
    numberOfItems: 2,
    status: 'PENDING',
    createdAt: '2026-08-07T10:00:00.000Z',
    orders: [],
  }], [], { async connect() { return client; }, query: client.query });
  assert.equal(calls[1].values[7], false);
  assert.match(calls[1].sql, /created_by_app=falabella_manifests\.created_by_app OR EXCLUDED\.created_by_app/);
});

test('el listado cacheado conserva todos los manifiestos asociados sin filtrar procedencia', async () => {
  const cached = await readCachedFalabellaManifests(7, [
    { companyId: 7, orderId: 'LOCAL-APP', orderNumber: 'ORDER-APP' },
    { companyId: 7, orderId: 'LOCAL-REMOTE', orderNumber: 'ORDER-REMOTE' },
  ], {
    async query() {
      return {
        rows: [
          {
            company_id: 7,
            manifest_id: 'app-created',
            manifest_code: 'MF-APP',
            created_by_app: true,
            local_order_id: 'LOCAL-APP',
            order_number: 'ORDER-APP',
          },
          {
            company_id: 7,
            manifest_id: 'remote-existing',
            manifest_code: 'MF-REMOTE',
            created_by_app: false,
            local_order_id: 'LOCAL-REMOTE',
            order_number: 'ORDER-REMOTE',
          },
        ],
      };
    },
  });

  assert.deepEqual(cached.manifests.map((manifest) => ({
    id: manifest.id,
    createdByApp: manifest.createdByApp,
  })), [
    { id: 'app-created', createdByApp: true },
    { id: 'remote-existing', createdByApp: false },
  ]);
  assert.deepEqual(cached.missingOrders, []);
});

test('el listado cacheado descarta manifiestos de otra compañía o pedidos no solicitados', async () => {
  const cached = await readCachedFalabellaManifests(7, [
    { companyId: 7, orderId: 'LOCAL-REQUESTED', orderNumber: 'ORDER-REQUESTED' },
  ], {
    async query(sql, values) {
      assert.match(sql, /WHERE i\.company_id=\$1/);
      assert.match(sql, /i\.local_order_id = ANY\(\$2::text\[\]\)/);
      assert.match(sql, /i\.order_number = ANY\(\$3::text\[\]\)/);
      assert.deepEqual(values, [7, ['LOCAL-REQUESTED'], ['ORDER-REQUESTED']]);
      return {
        rows: [
          {
            company_id: 7,
            manifest_id: 'requested',
            manifest_code: 'MF-REQUESTED',
            created_by_app: false,
            local_order_id: 'LOCAL-REQUESTED',
            order_number: 'ORDER-REQUESTED',
          },
          {
            company_id: 7,
            manifest_id: 'unrelated',
            manifest_code: 'MF-UNRELATED',
            created_by_app: true,
            local_order_id: 'LOCAL-OTHER',
            order_number: 'ORDER-OTHER',
          },
          {
            company_id: 8,
            manifest_id: 'other-company',
            manifest_code: 'MF-OTHER-COMPANY',
            created_by_app: true,
            local_order_id: 'LOCAL-REQUESTED',
            order_number: 'ORDER-REQUESTED',
          },
        ],
      };
    },
  });

  assert.deepEqual(cached.manifests.map((manifest) => manifest.id), ['requested']);
  assert.deepEqual(cached.manifests[0].orders, [{
    orderId: 'LOCAL-REQUESTED',
    orderNumber: 'ORDER-REQUESTED',
    deliveryOrderNumber: '',
  }]);
  assert.deepEqual(cached.missingOrders, []);
});

test('fusiona manifiestos cacheados y remotos sin duplicar pedidos', () => {
  const base = {
    id: 'uuid-1', code: 'MF-1', carrier: 'falabella', numberOfItems: 1,
    status: 'PENDING', createdAt: '2026-08-07T10:00:00.000Z',
  };
  const merged = mergeFalabellaManifestSummaries(
    [{ ...base, createdByApp: true, orders: [{ orderId: '1', orderNumber: 'A', deliveryOrderNumber: 'D1' }] }],
    [{ ...base, numberOfItems: 2, orders: [
      { orderId: '1', orderNumber: 'A', deliveryOrderNumber: 'D1' },
      { orderId: '2', orderNumber: 'B', deliveryOrderNumber: 'D2' },
    ] }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].numberOfItems, 2);
  assert.equal(merged[0].createdByApp, true);
  assert.deepEqual(merged[0].orders.map((order) => order.orderId), ['1', '2']);
});

test('calcula la duración total usando el mayor valor entre timeline y mediciones', () => {
  assert.equal(falabellaManifestDurationMs([
    { at: '2026-08-07T10:00:02.250Z', durationMs: 800 },
    { at: 'sin-fecha' },
    { at: '2026-08-07T10:00:00.000Z' },
    { at: '2026-08-07T10:00:01.000Z' },
  ]), 2250);
  assert.equal(falabellaManifestDurationMs([
    { at: '2026-08-07T10:00:00.000Z', durationMs: 35 },
  ]), 35);
  assert.equal(falabellaManifestDurationMs([
    { at: '2026-08-07T10:00:00.000Z' },
    { at: '2026-08-07T10:00:00.010Z', durationMs: 45 },
  ]), 45);
  assert.equal(falabellaManifestDurationMs([]), 0);
});

test('diagnostica un create resuelto completamente desde caché con duración', () => {
  const diagnostic = falabellaLocalCacheDiagnostic(
    3,
    7,
    '2026-08-07T10:00:00.000Z',
  );
  assert.equal(diagnostic.stage, 'resuelto desde caché local');
  assert.equal(diagnostic.durationMs, 7);
  assert.equal(diagnostic.events.length, 1);
  assert.equal(diagnostic.events[0].durationMs, 7);
  assert.match(diagnostic.events[0].message, /3 pedido\(s\).*no se abrió Seller Center/);
});

test('reintenta solo errores causados por navegación o handles obsoletos', () => {
  assert.equal(
    falabellaIsStaleDomError(new Error('Protocol error (DOM.describeNode): Cannot find context with specified id')),
    true,
  );
  assert.equal(falabellaIsStaleDomError(new Error('Execution context was destroyed')), true);
  assert.equal(falabellaIsStaleDomError(new Error('Credenciales inválidas')), false);
});

test('interpreta la validación previa del correo antes de mostrar la contraseña', () => {
  assert.equal(falabellaLoginValidationMode({ response: false }), 'password');
  assert.equal(falabellaLoginValidationMode({ response: true, redirectUrl: 'https://example.test' }), 'federated');
  assert.equal(falabellaLoginValidationMode({}), 'unknown');
  assert.equal(falabellaLoginValidationMode(null), 'unknown');
});

test('oculta las rutas variables del challenge de Cloudflare en el diagnóstico', () => {
  assert.equal(
    falabellaDiagnosticEndpoint('https://sellercenter.falabella.com/cdn-cgi/challenge-platform/h/b/jsd/oneshot/token?secret=1'),
    'sellercenter.falabella.com/cdn-cgi/challenge-platform/[ruta-oculta]',
  );
  assert.equal(
    falabellaDiagnosticEndpoint('https://sellercenter.falabella.com/user/auth/validate-user?email=hidden'),
    'sellercenter.falabella.com/user/auth/validate-user',
  );
});

test('traduce los timeouts del navegador y de la API a mensajes entendibles', () => {
  assert.equal(
    falabellaManifestErrorMessage(new Error('Waiting failed: 30000ms exceeded')),
    'Falabella no mostró el elemento esperado dentro de 30 segundos.',
  );
  assert.equal(
    falabellaManifestErrorMessage(new DOMException('The operation was aborted', 'AbortError')),
    'La llamada interna a Falabella no respondió dentro de 30 segundos.',
  );
});

test('selecciona solo pedidos listos y sin manifiesto', () => {
  const selection = selectFalabellaManifestOrders([
    { orderId: 'A', deliveryOrderNumber: '100', status: 'READY_TO_SHIP' },
    { orderId: 'B', deliveryOrderNumber: '200', status: 'NON_MANIFESTED' },
    { orderId: 'C', deliveryOrderNumber: '300', status: 'DRAFT' },
    { orderId: 'D', deliveryOrderNumber: '400', status: 'CONFIRMED', manifestId: 'MF-400' },
    { orderId: 'E', status: 'READY_TO_SHIP' },
    { orderId: 'F', deliveryOrderNumber: '600', status: 'PACKED', displayStatus: 'Listo para despachar' },
  ]);

  assert.deepEqual(selection.eligible.map((order) => order.orderId), ['A', 'B', 'F']);
  assert.deepEqual(selection.alreadyManifested.map((order) => order.orderId), ['D']);
  assert.deepEqual(selection.notReady.map((order) => order.orderId), ['C', 'E']);
  assert.equal(selection.missingRequested, 0);
});

test('restringe la selección a los pedidos solicitados y cuenta pedidos faltantes, no identificadores', () => {
  const selection = selectFalabellaManifestOrders([
    { sellerOrderNumber: 'LOCAL-1', deliveryOrderNumber: 'FAL-1', status: 'READY_TO_SHIP' },
    { sellerOrderNumber: 'LOCAL-2', deliveryOrderNumber: 'FAL-2', status: 'READY_TO_SHIP' },
  ], [
    { companyId: 5, orderId: 'LOCAL-1', orderNumber: 'FAL-1' },
    { companyId: 5, orderId: 'LOCAL-MISSING', orderNumber: 'FAL-MISSING' },
  ]);

  assert.deepEqual(selection.eligible.map((order) => order.deliveryOrderNumber), ['FAL-1']);
  assert.equal(selection.missingRequested, 1);
});

test('compara referencias remotas por tipo y evita colisiones cruzadas', () => {
  const requested = { companyId: 5, orderId: 'LOCAL-1', orderNumber: 'ORDER-1' };
  assert.equal(falabellaProviderOrderMatchesRequest({
    orderId: 'ORDER-1',
    orderNumber: 'LOCAL-1',
  }, requested), false);
  assert.equal(falabellaProviderOrderMatchesRequest({
    sellerOrderNumber: 'LOCAL-1',
    deliveryOrderNumber: 'ORDER-1',
  }, requested), true);

  const matched = matchFalabellaReadyOrderManifests([
    {
      orderId: 'ORDER-1', orderNumber: 'LOCAL-1', manifestId: 'cross',
      status: 'READY_TO_SHIP',
    },
    {
      sellerOrderNumber: 'LOCAL-1', deliveryOrderNumber: 'ORDER-1', manifestId: 'typed',
      status: 'READY_TO_SHIP',
    },
  ], [
    { id: 'cross', code: 'MF-CROSS', orderNumbers: ['LOCAL-1'] },
    { id: 'typed', code: 'MF-TYPED', orderNumbers: ['ORDER-1'] },
  ], [requested]);
  assert.deepEqual(matched.map((manifest) => manifest.id), ['typed']);
});

test('detecta únicamente manifiestos nuevos relacionados con la creación', () => {
  const before = [{ id: 'old-id', code: 'MF-OLD', orderNumbers: ['100'] }];
  const after = [
    ...before,
    { id: 'new-id', code: 'MF-NEW', orderNumbers: ['200'] },
    { id: 'race-id', code: 'MF-RACE', orderNumbers: ['999'] },
  ];
  const created = findNewFalabellaManifests(
    before,
    after,
    [{ deliveryOrderNumber: '200', status: 'READY_TO_SHIP' }],
    { created: [] },
  );

  assert.deepEqual(created.map((manifest) => manifest.id), ['new-id']);
});

test('usa el código devuelto por Falabella aunque el listado no incluya las órdenes', () => {
  const created = findNewFalabellaManifests(
    [],
    [{ id: 'new-id', code: 'MF-NEW' }],
    [{ deliveryOrderNumber: '200', status: 'READY_TO_SHIP' }],
    { created: [{ code: 'MF-NEW' }] },
  );

  assert.deepEqual(created.map((manifest) => manifest.id), ['new-id']);
});

test('vincula el código guardado en el pedido con el UUID imprimible del manifiesto', () => {
  const manifests = matchFalabellaReadyOrderManifests([
    {
      sellerOrderNumber: 'LOCAL-1',
      deliveryOrderNumber: '3247457609',
      manifestId: 'MFJB/SC8F004/20260806210521738',
      status: 'READY_TO_SHIP',
    },
    {
      sellerOrderNumber: 'LOCAL-2',
      deliveryOrderNumber: '3247457610',
      manifestId: 'MF-OTHER',
      status: 'READY_TO_SHIP',
    },
  ], [
    {
      id: 'f6482173-8435-4c1b-ba6c-b856ef10ea34',
      code: 'MFJB/SC8F004/20260806210521738',
      carrier: 'falabella',
      numberOfItems: 1,
      status: 'Pending',
      createdAt: 'Aug 6, 2026 21:05',
    },
    { id: 'other-uuid', code: 'MF-OTHER', numberOfItems: 1 },
  ], [
    { companyId: 7, orderId: 'LOCAL-1', orderNumber: 'ORDER-1' },
  ]);

  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].id, 'f6482173-8435-4c1b-ba6c-b856ef10ea34');
  assert.equal(manifests[0].code, 'MFJB/SC8F004/20260806210521738');
  assert.deepEqual(manifests[0].orders, [{
    orderId: 'LOCAL-1',
    orderNumber: 'ORDER-1',
    deliveryOrderNumber: '3247457609',
  }]);
});
