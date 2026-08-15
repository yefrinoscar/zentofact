const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_RECONCILE_AFTER_MS = 60_000;

function providerErrorStatus(result) {
  const providerStatus = Number(result?.status || 0);
  if (providerStatus === 401 || providerStatus === 429 || providerStatus >= 500) return 502;
  return providerStatus >= 400 ? providerStatus : 400;
}

function timeoutError() {
  const error = new Error('Falabella no respondió dentro del tiempo permitido. Verificaremos el estado antes de permitir otro intento.');
  error.name = 'TimeoutError';
  return error;
}

async function withTimeout(operation, parentSignal, timeoutMs) {
  const controller = new AbortController();
  let rejectBoundary;
  const boundary = new Promise((_, reject) => { rejectBoundary = reject; });
  const abortFromParent = () => {
    const reason = parentSignal?.reason instanceof Error
      ? parentSignal.reason
      : new Error('La solicitud fue cancelada.');
    controller.abort(reason);
    rejectBoundary(reason);
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => {
    const error = timeoutError();
    controller.abort(error);
    rejectBoundary(error);
  }, timeoutMs);
  try {
    return await Promise.race([operation(controller.signal), boundary]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

async function claimOperation(pool, companyId, orderId) {
  const result = await pool.query(
    `/* ready-to-ship:claim */
     insert into falabella_ready_to_ship_operations (
       company_id, order_id, state, attempts, started_at, updated_at
     )
     select company_id, order_id, 'processing', 1, now(), now()
     from falabella_orders
     where company_id=$1 and order_id=$2
       and coalesce(status, '') !~* '(^|\\|)(shipped|delivered)(\\||$)'
     on conflict (company_id, order_id) do update set
       state='processing', attempts=falabella_ready_to_ship_operations.attempts + 1,
       started_at=now(), updated_at=now(), finished_at=null, last_error=null, result='{}'::jsonb
     where falabella_ready_to_ship_operations.state='failed'
     returning state, attempts`,
    [companyId, orderId],
  );
  return result.rows[0] || null;
}

async function readOperationState(pool, companyId, orderId, staleAfterMs) {
  const result = await pool.query(
    `/* ready-to-ship:state */
     select fo.status as order_status, operation.state as operation_state,
       operation.updated_at,
       coalesce(operation.updated_at < now() - ($3::double precision * interval '1 millisecond'), false) as stale
     from falabella_orders fo
     left join falabella_ready_to_ship_operations operation
       on operation.company_id=fo.company_id and operation.order_id=fo.order_id
     where fo.company_id=$1 and fo.order_id=$2`,
    [companyId, orderId, staleAfterMs],
  );
  return result.rows[0] || null;
}

async function claimReconciliation(pool, companyId, orderId, reconcileAfterMs) {
  const result = await pool.query(
    `/* ready-to-ship:reconcile-claim */
     update falabella_ready_to_ship_operations
     set state='reconciling', updated_at=now()
     where company_id=$1 and order_id=$2
       and state in ('unknown', 'processing', 'reconciling')
       and updated_at < now() - ($3::double precision * interval '1 millisecond')
     returning state`,
    [companyId, orderId, reconcileAfterMs],
  );
  return result.rows[0] || null;
}

async function markUnknown(pool, companyId, orderId, error) {
  await pool.query(
    `/* ready-to-ship:unknown */
     update falabella_ready_to_ship_operations
     set state='unknown', updated_at=now(), last_error=$3
     where company_id=$1 and order_id=$2 and state in ('processing', 'reconciling')`,
    [companyId, orderId, String(error?.message || error || 'Resultado desconocido').slice(0, 1000)],
  );
}

async function markFailed(pool, companyId, orderId, error) {
  await pool.query(
    `/* ready-to-ship:fail */
     update falabella_ready_to_ship_operations
     set state='failed', updated_at=now(), finished_at=now(), last_error=$3
     where company_id=$1 and order_id=$2 and state in ('processing', 'reconciling')
     returning state`,
    [companyId, orderId, String(error || 'Falabella rechazó la operación.').slice(0, 1000)],
  );
}

async function markCompleted(pool, companyId, orderId, result) {
  const providerStatus = ['shipped', 'delivered'].includes(result?.providerStatus)
    ? result.providerStatus
    : 'ready_to_ship';
  await pool.query(
    `/* ready-to-ship:complete */
     with updated_order as (
       update falabella_orders
       set status=case
             when coalesce(status, '') ~* '(^|\\|)delivered(\\||$)' then status
             when coalesce(status, '') ~* '(^|\\|)shipped(\\||$)' and $5::text <> 'delivered' then status
             else $5::text
           end,
           raw_data=jsonb_set(
             coalesce(raw_data, '{}'::jsonb),
             '{Statuses}',
             to_jsonb((case
               when coalesce(status, '') ~* '(^|\\|)delivered(\\||$)' then status
               when coalesce(status, '') ~* '(^|\\|)shipped(\\||$)' and $5::text <> 'delivered' then status
               else $5::text
             end)::text),
             true
           ),
           last_seen_at=now(), synchronized_at=now()
       where company_id=$1 and order_id=$2
       returning company_id, order_id, order_number, status,
         falabella_created_at, falabella_updated_at, first_seen_at
     ), updated_lifecycle as (
       insert into falabella_order_lifecycle (
         company_id, order_id, order_number, current_status, pending_at,
         ready_to_ship_at, shipped_at, last_provider_update_at, first_observed_at, last_observed_at
       )
       select company_id, order_id, order_number,
         case
           when coalesce(status, '') ~* '(^|\\|)delivered(\\||$)' then status
           when coalesce(status, '') ~* '(^|\\|)shipped(\\||$)' and $5::text <> 'delivered' then status
           else $5::text
         end,
         coalesce(falabella_created_at, first_seen_at),
         case
           when $5::text <> 'ready_to_ship'
             or coalesce(status, '') ~* '(^|\\|)(shipped|delivered)(\\||$)'
             or $3::boolean then null
           else now()
         end,
         case
           when coalesce(status, '') ~* '(^|\\|)(shipped|delivered)(\\||$)' then coalesce(falabella_updated_at, now())
           else null
         end,
         case when $3::boolean then falabella_updated_at else now() end,
         first_seen_at, now()
       from updated_order
       on conflict (company_id, order_id) do update set
         current_status=excluded.current_status,
         pending_at=coalesce(falabella_order_lifecycle.pending_at, excluded.pending_at),
         ready_to_ship_at=coalesce(falabella_order_lifecycle.ready_to_ship_at, excluded.ready_to_ship_at),
         shipped_at=coalesce(falabella_order_lifecycle.shipped_at, excluded.shipped_at),
         last_provider_update_at=excluded.last_provider_update_at,
         last_observed_at=now()
       returning id
     )
     update falabella_ready_to_ship_operations
     set state='succeeded', updated_at=now(), finished_at=now(), last_error=null, result=$4::jsonb
     where company_id=$1 and order_id=$2
     returning state`,
    [companyId, orderId, Boolean(result?.alreadyReady), JSON.stringify(result || {}), providerStatus],
  );
}

function inProgress(state = 'processing') {
  const verifying = state === 'unknown' || state === 'reconciling';
  return {
    kind: 'in_progress',
    status: 409,
    error: verifying
      ? 'Falabella no confirmó el resultado todavía. Espera un minuto; el siguiente intento verificará el estado sin repetir la operación.'
      : 'Este pedido ya se está marcando como listo para envío.',
  };
}

async function reconcileUnknown({
  pool,
  companyId,
  orderId,
  reconcile,
  signal,
  providerTimeoutMs,
  reconcileAfterMs,
}) {
  if (!reconcile) return inProgress('unknown');
  const claimed = await claimReconciliation(pool, companyId, orderId, reconcileAfterMs);
  if (!claimed) return inProgress('reconciling');
  try {
    const result = await withTimeout(
      (timeoutSignal) => reconcile({ companyId, orderId, signal: timeoutSignal }),
      signal,
      providerTimeoutMs,
    );
    if (result?.error || result?.ok === false) {
      await markUnknown(pool, companyId, orderId, result?.error || 'Falabella no pudo confirmar el estado.');
      return { kind: 'error', status: providerErrorStatus(result), error: result?.error || 'Falabella no pudo confirmar el estado.' };
    }
    if (result?.ready) {
      const completed = { ok: true, alreadyReady: true, reconciled: true, ...(result || {}) };
      await markCompleted(pool, companyId, orderId, completed);
      return { kind: 'success', result: completed };
    }
    const error = 'Falabella confirmó que el pedido todavía no está listo. Vuelve a intentarlo para iniciar una nueva operación.';
    await markFailed(pool, companyId, orderId, error);
    return { kind: 'error', status: 409, error };
  } catch (error) {
    await markUnknown(pool, companyId, orderId, error);
    return { kind: 'error', status: 504, error: timeoutError().message };
  }
}

export async function markFalabellaOrderReadyToShip({
  pool,
  companyId,
  orderId,
  setReadyToShip,
  reconcile,
  signal,
  providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  reconcileAfterMs = DEFAULT_RECONCILE_AFTER_MS,
}) {
  const normalizedCompanyId = Number(companyId);
  const normalizedOrderId = String(orderId || '').trim();
  if (!Number.isInteger(normalizedCompanyId) || normalizedCompanyId <= 0 || !normalizedOrderId) {
    return { kind: 'error', status: 400, error: 'Pedido Falabella inválido.' };
  }

  const claim = await claimOperation(pool, normalizedCompanyId, normalizedOrderId);
  if (!claim) {
    const state = await readOperationState(pool, normalizedCompanyId, normalizedOrderId, reconcileAfterMs);
    if (!state) return { kind: 'error', status: 404, error: 'Pedido Falabella no encontrado.' };
    if (/(^|\|)(shipped|delivered)(\||$)/i.test(String(state.order_status || ''))) {
      return {
        kind: 'error',
        status: 409,
        error: 'El pedido ya fue enviado a Falabella. Sincroniza la bandeja para ver su estado actual.',
      };
    }
    if (state.operation_state === 'succeeded') {
      return { kind: 'success', result: { ok: true, alreadyReady: true } };
    }
    if (
      state.operation_state === 'unknown'
      || (['processing', 'reconciling'].includes(state.operation_state) && state.stale)
    ) {
      return reconcileUnknown({
        pool,
        companyId: normalizedCompanyId,
        orderId: normalizedOrderId,
        reconcile,
        signal,
        providerTimeoutMs,
        reconcileAfterMs,
      });
    }
    return inProgress(state.operation_state);
  }

  try {
    const result = await withTimeout(
      (timeoutSignal) => setReadyToShip({
        companyId: normalizedCompanyId,
        orderId: normalizedOrderId,
        signal: timeoutSignal,
      }),
      signal,
      providerTimeoutMs,
    );
    if (result?.error || result?.ok === false) {
      const error = result?.error || 'Falabella rechazó la operación.';
      if (result?.outcomeUnknown) {
        await markUnknown(pool, normalizedCompanyId, normalizedOrderId, error);
        return {
          kind: 'error',
          status: providerErrorStatus(result),
          error: `${error} Se verificará el estado antes de permitir otro intento.`,
        };
      }
      await markFailed(pool, normalizedCompanyId, normalizedOrderId, error);
      return { kind: 'error', status: providerErrorStatus(result), error };
    }
    await markCompleted(pool, normalizedCompanyId, normalizedOrderId, result);
    return { kind: 'success', result };
  } catch (error) {
    await markUnknown(pool, normalizedCompanyId, normalizedOrderId, error);
    return {
      kind: 'error',
      status: error?.name === 'TimeoutError' ? 504 : 502,
      error: error?.name === 'TimeoutError'
        ? error.message
        : 'La conexión con Falabella terminó sin confirmar el resultado. Verificaremos el estado antes de permitir otro intento.',
    };
  }
}
