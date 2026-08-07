import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimFalabellaManifestJobs,
  completeFalabellaManifestJob,
  enqueueFalabellaManifestJob,
  failFalabellaManifestJob,
  falabellaManifestJobFingerprint,
  getFalabellaManifestJob,
  heartbeatFalabellaManifestJob,
  mapFalabellaManifestJob,
  normalizeFalabellaManifestJobOrders,
  recoverStaleFalabellaManifestJobs,
  sanitizeFalabellaManifestJobResult,
} from './falabella-manifest-jobs.js';

const NOW = '2026-08-07T17:00:00.000Z';

function row(overrides = {}) {
  return {
    id: '41',
    fingerprint: 'a'.repeat(64),
    status: 'pending',
    orders: [{ companyId: 7, orderId: '10', orderNumber: 'A' }],
    stage: 'en cola',
    attempts: 0,
    result: null,
    error: null,
    created_at: NOW,
    started_at: null,
    completed_at: null,
    updated_at: NOW,
    ...overrides,
  };
}

function recordingDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rows };
    },
  };
}

test('normaliza, ordena y deduplica la selección usada por el fingerprint', () => {
  const input = [
    { companyId: '8', orderId: ' 20 ', orderNumber: ' B ' },
    { companyId: 7, orderId: 10, orderNumber: ' A ' },
    { companyId: 7, orderId: '10', orderNumber: 'A' },
  ];
  assert.deepEqual(normalizeFalabellaManifestJobOrders(input), [
    { companyId: 7, orderId: '10', orderNumber: 'A' },
    { companyId: 8, orderId: '20', orderNumber: 'B' },
  ]);
  assert.equal(
    falabellaManifestJobFingerprint(input),
    falabellaManifestJobFingerprint([...input].reverse()),
  );
  assert.notEqual(
    falabellaManifestJobFingerprint(input),
    falabellaManifestJobFingerprint([{ companyId: 9, orderId: '10', orderNumber: 'A' }]),
  );
  assert.match(falabellaManifestJobFingerprint(input), /^[a-f0-9]{64}$/);
});

test('rechaza selecciones inválidas sin consultar servicios externos', () => {
  assert.throws(() => normalizeFalabellaManifestJobOrders([]), /al menos un pedido/);
  assert.throws(() => normalizeFalabellaManifestJobOrders([{ companyId: 0, orderId: '1' }]), /companyId/);
  assert.throws(() => normalizeFalabellaManifestJobOrders([{ companyId: 1 }]), /no tiene identidad/);
  assert.throws(() => normalizeFalabellaManifestJobOrders([null]), /posición 1/);
});

test('sanitiza binarios, base64 y secretos al persistir o mapear resultados', () => {
  const circular = { ok: true };
  circular.self = circular;
  const sanitized = sanitizeFalabellaManifestJobResult({
    ok: true,
    base64: 'pdf',
    document: { filename: 'm.pdf', base64: 'pdf' },
    diagnostic: { screenshotBase64: 'image', pageTitle: 'Seller Center' },
    token: 'secret',
    bytes: Buffer.from('pdf'),
    circular,
  });
  assert.deepEqual(sanitized, {
    ok: true,
    document: { filename: 'm.pdf' },
    diagnostic: { pageTitle: 'Seller Center' },
    circular: { ok: true },
  });

  const mapped = mapFalabellaManifestJob(row({
    status: 'completed',
    result: JSON.stringify({ ok: true, screenshot_base64: 'hidden' }),
    started_at: new Date(NOW),
  }));
  assert.equal(mapped.id, '41');
  assert.equal(mapped.startedAt, NOW);
  assert.deepEqual(mapped.result, { ok: true });
});

test('enqueue usa fingerprint/JSON canónicos y reutiliza sólo jobs activos', async () => {
  for (const status of ['pending', 'processing']) {
    const db = recordingDb([row({ status, stage: `estado ${status}`, attempts: 3, inserted: false })]);
    const enqueued = await enqueueFalabellaManifestJob([
      { companyId: 8, orderId: '20' },
      { companyId: 7, orderId: '10' },
    ], db);
    assert.equal(enqueued.reused, true);
    assert.equal(enqueued.job.status, status);
    assert.equal(enqueued.job.stage, `estado ${status}`);
    assert.match(db.calls[0].sql, /on conflict \(fingerprint\) where status in \('pending', 'processing'\) do update/);
    assert.match(db.calls[0].sql, /returning \*, \(xmax = 0\) as inserted/);
    assert.match(db.calls[0].sql, /fingerprint=falabella_manifest_jobs\.fingerprint/);
    assert.deepEqual(JSON.parse(db.calls[0].params[1]), [
      { companyId: 7, orderId: '10' },
      { companyId: 8, orderId: '20' },
    ]);
  }
});

test('enqueue crea una fila pending nueva después de completed o failed', async () => {
  for (const previousStatus of ['completed', 'failed']) {
    const insertedDb = recordingDb([row({
      id: previousStatus === 'completed' ? '42' : '43',
      status: 'pending',
      attempts: 0,
      stage: 'en cola',
      inserted: true,
    })]);
    const inserted = await enqueueFalabellaManifestJob([{ companyId: 7, orderId: '10' }], insertedDb);
    assert.equal(inserted.reused, false);
    assert.equal(inserted.job.status, 'pending');
    assert.equal(inserted.job.attempts, 0);
  }

  const reusedDb = recordingDb([row({ inserted: false })]);
  const reused = await enqueueFalabellaManifestJob([{ companyId: 7, orderId: '10' }], reusedDb);
  assert.equal(reused.reused, true);
});

test('un segundo clic después de crear genera un job nuevo y conserva el resultado full-cache', async () => {
  const firstCompletedDb = recordingDb([row({
    id: '41', status: 'completed', attempts: 1, stage: 'completado',
    result: { createdManifests: 1 }, completed_at: NOW,
  })]);
  const first = await completeFalabellaManifestJob(
    { id: 41, attempts: 1 },
    { createdManifests: 1, results: [{ requestedOrders: 2, createdManifests: 1 }] },
    firstCompletedDb,
  );
  assert.equal(first.result.createdManifests, 1);

  const secondEnqueueDb = recordingDb([row({
    id: '42', status: 'pending', attempts: 0, stage: 'en cola', inserted: true,
  })]);
  const second = await enqueueFalabellaManifestJob(
    [{ companyId: 7, orderId: '10' }, { companyId: 7, orderId: '11' }],
    secondEnqueueDb,
  );
  assert.equal(second.reused, false);
  assert.equal(second.job.id, '42');
  assert.equal(second.job.status, 'pending');

  const fullCacheResult = {
    companies: 1,
    failedCompanies: 0,
    createdManifests: 0,
    createdOrders: 0,
    source: 'local_cache',
    results: [{
      companyId: 7,
      requestedOrders: 2,
      alreadyManifestedOrders: 2,
      createdManifests: 0,
      existingManifestIds: ['uuid-1'],
    }],
  };
  const secondCompletedDb = recordingDb([row({
    id: '42', status: 'completed', attempts: 1, stage: 'completado',
    result: fullCacheResult, completed_at: NOW,
  })]);
  const secondCompleted = await completeFalabellaManifestJob(
    { id: 42, attempts: 1 }, fullCacheResult, secondCompletedDb,
  );
  assert.equal(secondCompleted.result.createdManifests, 0);
  assert.equal(secondCompleted.result.results[0].alreadyManifestedOrders, 2);
  assert.deepEqual(secondCompleted.result.results[0].existingManifestIds, ['uuid-1']);
});

test('obtiene un job por ID y lo mapea sin exponer campos internos', async () => {
  const db = recordingDb([row({ status: 'processing', attempts: 2 })]);
  const job = await getFalabellaManifestJob('41', db);
  assert.equal(job.id, '41');
  assert.equal(job.status, 'processing');
  assert.equal(job.attempts, 2);
  assert.deepEqual(db.calls[0].params, [41]);
  assert.match(db.calls[0].sql, /from falabella_manifest_jobs where id=\$1 limit 1/);

  const missing = await getFalabellaManifestJob(42, recordingDb([]));
  assert.equal(missing, null);
});

test('claim es atómico y usa FOR UPDATE SKIP LOCKED', async () => {
  const db = recordingDb([row({ status: 'processing', attempts: 1, stage: 'iniciando', started_at: NOW })]);
  const jobs = await claimFalabellaManifestJobs(3, db);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'processing');
  assert.equal(jobs[0].attempts, 1);
  assert.deepEqual(db.calls[0].params, [3]);
  assert.match(db.calls[0].sql, /for update skip locked/);
  assert.match(db.calls[0].sql, /set status='processing'/);
  assert.match(db.calls[0].sql, /attempts=job\.attempts\+1/);
});

test('recupera jobs processing vencidos a pending sin reiniciar attempts', async () => {
  const db = recordingDb([row({ status: 'pending', attempts: 2, stage: 'en cola (recuperado)' })]);
  const recovered = await recoverStaleFalabellaManifestJobs(120_000, db);
  assert.equal(recovered[0].status, 'pending');
  assert.equal(recovered[0].attempts, 2);
  assert.deepEqual(db.calls[0].params, [120_000]);
  assert.match(db.calls[0].sql, /where status='processing'/);
  assert.match(db.calls[0].sql, /updated_at < now\(\) - \(\$1::int \* interval '1 millisecond'\)/);
});

test('heartbeat renueva sólo el lease vigente y puede actualizar la etapa', async () => {
  const db = recordingDb([row({ status: 'processing', attempts: 3, stage: 'descargando' })]);
  const heartbeat = await heartbeatFalabellaManifestJob({ id: '41', attempts: 3 }, ' descargando ', db);
  assert.equal(heartbeat.stage, 'descargando');
  assert.deepEqual(db.calls[0].params, [41, 3, 'descargando']);
  assert.match(db.calls[0].sql, /set stage=coalesce\(\$3, stage\), updated_at=now\(\)/);
  assert.match(db.calls[0].sql, /where id=\$1 and status='processing' and attempts=\$2/);

  const lost = await heartbeatFalabellaManifestJob(
    { id: 41, attempts: 2 },
    'obsoleto',
    recordingDb([]),
  );
  assert.equal(lost, null);
});

test('complete sanitiza el resultado y protege la transición con el intento reclamado', async () => {
  const db = recordingDb([row({
    status: 'completed', attempts: 2, stage: 'completado',
    result: { createdManifests: 1 }, completed_at: NOW,
  })]);
  const completed = await completeFalabellaManifestJob(
    { id: '41', attempts: 2 },
    { createdManifests: 1, base64: 'omitido', diagnostic: { screenshotBase64: 'omitido' } },
    db,
  );
  assert.equal(completed.status, 'completed');
  assert.deepEqual(JSON.parse(db.calls[0].params[2]), {
    createdManifests: 1,
    diagnostic: {},
  });
  assert.match(db.calls[0].sql, /where id=\$1 and status='processing' and attempts=\$2/);
});

test('fail limita el error, sanitiza resultado parcial y exige el intento reclamado', async () => {
  const db = recordingDb([row({
    status: 'failed', attempts: 4, stage: 'error', error: 'falló',
    result: { createdManifests: 1 }, completed_at: NOW,
  })]);
  const failed = await failFalabellaManifestJob(
    { id: 41, attempts: 4 },
    new Error('falló'),
    { createdManifests: 1, document: { base64: 'omitido' }, accessToken: 'omitido' },
    db,
  );
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'falló');
  assert.deepEqual(failed.result, { createdManifests: 1 });
  assert.deepEqual(db.calls[0].params, [41, 4, 'falló', JSON.stringify({
    createdManifests: 1,
    document: {},
  })]);
  assert.match(db.calls[0].sql, /set status='failed'/);
  assert.match(db.calls[0].sql, /result=\$4::jsonb/);
  assert.match(db.calls[0].sql, /where id=\$1 and status='processing' and attempts=\$2/);
});

test('complete/fail devuelven null si el lease ya no pertenece al worker', async () => {
  const db = recordingDb([]);
  assert.equal(await completeFalabellaManifestJob({ id: 41, attempts: 1 }, { ok: true }, db), null);
  assert.equal(await failFalabellaManifestJob({ id: 41, attempts: 1 }, 'error', null, db), null);
});
