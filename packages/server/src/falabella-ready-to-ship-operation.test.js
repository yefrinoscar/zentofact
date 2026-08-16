import assert from 'node:assert/strict';
import test from 'node:test';
import { markFalabellaOrderReadyToShip } from './falabella-ready-to-ship-operation.js';

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

class IncidentPool {
  constructor(max = 10, { operationState = null, stale = false, orderStatus = 'pending' } = {}) {
    this.max = max;
    this.active = 0;
    this.maxObserved = 0;
    this.connectionWaiters = [];
    this.operationState = operationState;
    this.stale = stale;
    this.orderStatus = orderStatus;
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
      const canClaimSucceeded = this.operationState === 'succeeded'
        && !/(^|\|)(ready_to_ship|shipped|delivered)(\||$)/i.test(this.orderStatus);
      if (this.operationState === null || this.operationState === 'failed' || canClaimSucceeded) {
        this.operationState = 'processing';
        return { rows: [{ state: 'processing' }] };
      }
      return { rows: [] };
    }
    if (compact.includes('ready-to-ship:state')) {
      return { rows: [{ order_status: this.orderStatus, operation_state: this.operationState, stale: this.stale }] };
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
    assert.notEqual(settled, 'timeout', 'los duplicados deben resolverse al fallar el claim, sin retener conexiones');
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

test('un timeout aborta la promesa perdedora sin rechazo sin manejar', async () => {
  const leaks = [];
  const onUnhandled = (reason) => { leaks.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const pool = new IncidentPool();
    const outcome = await markFalabellaOrderReadyToShip({
      pool,
      companyId: 7,
      orderId: 'ORDER-UNHANDLED',
      providerTimeoutMs: 15,
      setReadyToShip: ({ signal }) => new Promise((_, reject) => {
        const fail = () => {
          const error = signal.reason instanceof Error ? signal.reason : new Error('aborted');
          queueMicrotask(() => reject(error));
        };
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(outcome.status, 504);
    assert.equal(pool.operationState, 'unknown');
    assert.equal(leaks.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('una cancelación antes del POST deja el pedido reintentable', async () => {
  const pool = new IncidentPool();
  const controller = new AbortController();
  const started = deferred();
  const first = markFalabellaOrderReadyToShip({
    pool,
    companyId: 7,
    orderId: 'ORDER-ABORTED-GET',
    signal: controller.signal,
    setReadyToShip: async ({ signal }) => {
      started.resolve();
      return new Promise((_, reject) => {
        const fail = () => {
          const error = new Error('La solicitud fue cancelada.');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      }).catch((error) => ({ ok: false, error: error.message }));
    },
  });
  await started.promise;
  controller.abort();
  const aborted = await first;
  assert.equal(aborted.kind, 'error');
  assert.equal(aborted.status, 400);
  assert.equal(pool.operationState, 'failed');

  const retried = await markFalabellaOrderReadyToShip({
    pool,
    companyId: 7,
    orderId: 'ORDER-ABORTED-GET',
    setReadyToShip: async () => ({ ok: true, alreadyReady: false }),
  });
  assert.equal(retried.kind, 'success');
  assert.equal(pool.operationState, 'succeeded');
});

test('una reconciliación con error del proveedor no se reporta como timeout', async () => {
  const pool = new IncidentPool(10, { operationState: 'unknown', stale: true });
  const outcome = await markFalabellaOrderReadyToShip({
    pool,
    companyId: 7,
    orderId: 'ORDER-RECONCILE-502',
    reconcileAfterMs: 0,
    setReadyToShip: async () => assert.fail('no debe repetir el POST'),
    reconcile: async () => {
      throw Object.assign(new Error('socket hang up'), { name: 'Error' });
    },
  });

  assert.equal(outcome.kind, 'error');
  assert.equal(outcome.status, 502);
  assert.match(outcome.error, /socket hang up/);
  assert.equal(pool.operationState, 'unknown');
});

test('un succeeded local no es éxito si el pedido ya no está listo', async () => {
  const pool = new IncidentPool(10, { operationState: 'succeeded', orderStatus: 'canceled' });
  let providerCalls = 0;
  const outcome = await markFalabellaOrderReadyToShip({
    pool,
    companyId: 7,
    orderId: 'ORDER-REVERTED',
    setReadyToShip: async () => {
      providerCalls += 1;
      return { ok: true, alreadyReady: false };
    },
  });

  assert.equal(outcome.kind, 'success');
  assert.equal(providerCalls, 1);
  assert.equal(pool.operationState, 'succeeded');
});

test('un succeeded con pedido listo sigue siendo idempotente', async () => {
  const pool = new IncidentPool(10, { operationState: 'succeeded', orderStatus: 'ready_to_ship' });
  let providerCalls = 0;
  const outcome = await markFalabellaOrderReadyToShip({
    pool,
    companyId: 7,
    orderId: 'ORDER-STILL-READY',
    setReadyToShip: async () => {
      providerCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(outcome.kind, 'success');
  assert.equal(outcome.result.alreadyReady, true);
  assert.equal(providerCalls, 0);
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
