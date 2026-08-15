import assert from 'node:assert/strict';
import test from 'node:test';
import { markFalabellaOrderReadyToShip } from './falabella-ready-to-ship-operation.js';

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

class IncidentPool {
  constructor(max = 10, { operationState = null, stale = false } = {}) {
    this.max = max;
    this.active = 0;
    this.maxObserved = 0;
    this.connectionWaiters = [];
    this.lockOwner = null;
    this.lockWaiters = [];
    this.operationState = operationState;
    this.stale = stale;
  }

  async connect() {
    await this.acquireConnection();
    const client = { released: false };
    client.query = async (sql) => {
      const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (compact.startsWith('select pg_advisory_xact_lock')) {
        if (!this.lockOwner) this.lockOwner = client;
        else await new Promise((resolve) => this.lockWaiters.push({ client, resolve }));
      }
      if (compact.startsWith('select status from falabella_orders')) return { rows: [{ status: 'pending' }] };
      if (compact === 'commit' || compact === 'rollback') this.releaseLock(client);
      return { rows: [] };
    };
    client.release = () => {
      if (client.released) return;
      client.released = true;
      this.releaseConnection();
    };
    return client;
  }

  releaseLock(client) {
    if (this.lockOwner !== client) return;
    const next = this.lockWaiters.shift();
    if (next) {
      this.lockOwner = next.client;
      next.resolve();
    } else {
      this.lockOwner = null;
    }
  }

  async query(sql) {
    await this.acquireConnection();
    try {
      return this.runQuery(sql);
    } finally {
      this.releaseConnection();
    }
  }

  async acquireConnection() {
    if (this.active >= this.max) await new Promise((resolve) => this.connectionWaiters.push(resolve));
    this.active += 1;
    this.maxObserved = Math.max(this.maxObserved, this.active);
  }

  releaseConnection() {
    this.active -= 1;
    this.connectionWaiters.shift()?.();
  }

  runQuery(sql) {
    const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (compact.includes('ready-to-ship:claim')) {
      if (this.operationState === null || this.operationState === 'failed') {
        this.operationState = 'processing';
        return { rows: [{ state: 'processing' }] };
      }
      return { rows: [] };
    }
    if (compact.includes('ready-to-ship:state')) {
      return { rows: [{ order_status: 'pending', operation_state: this.operationState, stale: this.stale }] };
    }
    if (compact.includes('ready-to-ship:reconcile-claim')) {
      if (['unknown', 'processing', 'reconciling'].includes(this.operationState) && this.stale) {
        this.operationState = 'reconciling';
        return { rows: [{ state: 'reconciling' }] };
      }
      return { rows: [] };
    }
    if (compact.includes('ready-to-ship:complete')) {
      this.operationState = 'succeeded';
      return { rows: [{ state: 'succeeded' }] };
    }
    if (compact.includes('ready-to-ship:fail')) {
      this.operationState = 'failed';
      return { rows: [{ state: 'failed' }] };
    }
    if (compact.includes('ready-to-ship:unknown')) {
      this.operationState = 'unknown';
      return { rows: [{ state: 'unknown' }] };
    }
    return { rows: [] };
  }
}

test('una llamada Falabella bloqueada no llena las diez conexiones con duplicados del mismo pedido', async () => {
  const pool = new IncidentPool(10);
  const provider = deferred();
  let providerCalls = 0;
  const input = {
    pool,
    companyId: 7,
    orderId: 'ORDER-80-MINUTES',
    setReadyToShip: async () => {
      providerCalls += 1;
      return provider.promise;
    },
  };

  const owner = markFalabellaOrderReadyToShip(input);
  while (providerCalls === 0) await new Promise((resolve) => setImmediate(resolve));
  const duplicates = Array.from({ length: 9 }, () => markFalabellaOrderReadyToShip(input));

  try {
    const settled = await Promise.race([
      Promise.all(duplicates),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ]);
    assert.notEqual(settled, 'timeout', 'los duplicados quedaron esperando el advisory lock');
    assert.equal(providerCalls, 1, 'solo el dueño del claim debe llamar a Falabella');
    assert.equal(pool.active, 0, 'ninguna conexión debe permanecer tomada durante la llamada externa');
    assert.ok(settled.every((outcome) => outcome.kind === 'in_progress'));
  } finally {
    provider.resolve({ ok: true, alreadyReady: false });
    await Promise.allSettled([owner, ...duplicates]);
  }
});

test('un proveedor que ignora la cancelación termina por timeout y queda para reconciliación', async () => {
  const pool = new IncidentPool();
  const outcome = await markFalabellaOrderReadyToShip({
    pool,
    companyId: 7,
    orderId: 'ORDER-TIMEOUT',
    providerTimeoutMs: 5,
    setReadyToShip: async () => new Promise(() => {}),
  });

  assert.equal(outcome.kind, 'error');
  assert.equal(outcome.status, 504);
  assert.equal(pool.operationState, 'unknown');
  assert.equal(pool.active, 0);
});

test('un resultado desconocido se consulta antes de permitir otro POST', async () => {
  const pool = new IncidentPool(10, { operationState: 'unknown', stale: true });
  let providerCalls = 0;
  let reconciliationCalls = 0;
  const outcome = await markFalabellaOrderReadyToShip({
    pool,
    companyId: 7,
    orderId: 'ORDER-UNKNOWN',
    reconcileAfterMs: 0,
    setReadyToShip: async () => {
      providerCalls += 1;
      return { ok: true };
    },
    reconcile: async () => {
      reconciliationCalls += 1;
      return { ok: true, ready: true };
    },
  });

  assert.equal(outcome.kind, 'success');
  assert.equal(outcome.result.reconciled, true);
  assert.equal(providerCalls, 0);
  assert.equal(reconciliationCalls, 1);
  assert.equal(pool.operationState, 'succeeded');
});

test('una reconciliación abandonada se recupera después de vencer', async () => {
  const pool = new IncidentPool(10, { operationState: 'reconciling', stale: true });
  const outcome = await markFalabellaOrderReadyToShip({
    pool,
    companyId: 7,
    orderId: 'ORDER-STALE-RECONCILIATION',
    reconcileAfterMs: 0,
    setReadyToShip: async () => assert.fail('no debe repetir el POST'),
    reconcile: async () => ({ ok: true, ready: true }),
  });

  assert.equal(outcome.kind, 'success');
  assert.equal(outcome.result.reconciled, true);
  assert.equal(pool.operationState, 'succeeded');
});

test('una respuesta no confirmada después del POST no habilita un reintento ciego', async () => {
  const pool = new IncidentPool();
  const outcome = await markFalabellaOrderReadyToShip({
    pool,
    companyId: 7,
    orderId: 'ORDER-UNCONFIRMED',
    setReadyToShip: async () => ({
      ok: false,
      status: 502,
      outcomeUnknown: true,
      error: 'Falabella no confirmó el cambio.',
    }),
  });

  assert.equal(outcome.kind, 'error');
  assert.equal(pool.operationState, 'unknown');
  assert.match(outcome.error, /verificará el estado/i);
});

test('un rechazo confirmado permite un nuevo intento explícito', async () => {
  const pool = new IncidentPool();
  let providerCalls = 0;
  const input = {
    pool,
    companyId: 7,
    orderId: 'ORDER-KNOWN-FAILURE',
    setReadyToShip: async () => {
      providerCalls += 1;
      if (providerCalls === 1) return { ok: false, status: 400, error: 'Paquete rechazado.' };
      return { ok: true, alreadyReady: false };
    },
  };

  const failed = await markFalabellaOrderReadyToShip(input);
  assert.equal(failed.kind, 'error');
  assert.equal(pool.operationState, 'failed');

  const retried = await markFalabellaOrderReadyToShip(input);
  assert.equal(retried.kind, 'success');
  assert.equal(providerCalls, 2);
  assert.equal(pool.operationState, 'succeeded');
});
