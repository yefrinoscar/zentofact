// Avance de despacho de pedidos de la tienda web (canal `external`) desde la
// Bandeja: Confirmar → Listo → Enviado (solo envío) → Entregado / Recogido.
// Zentofact es el único dueño de este avance; cada paso deja order_events y el
// trigger de orders publica el evento de integración correspondiente.

import { stockPhase } from '../catalog/stock-phase.js';

export const STORE_STEPS = ['confirm', 'ready', 'ship', 'deliver'];
export const STORE_CARRIERS = ['shaloom', 'olva', 'marvisuar', 'dinsides', 'nosotros', 'otro'];

const STEP_TARGET = {
  confirm: 'preparing',
  ready: 'ready_to_ship',
  ship: 'shipped',
  deliver: 'delivered',
};
const STATUS_RANK = { pending: 0, preparing: 1, ready_to_ship: 2, shipped: 3, delivered: 4 };
const STEP_TIMESTAMP = {
  confirm: 'confirmedAt',
  ready: 'readyAt',
  ship: 'shippedAt',
  deliver: 'deliveredAt',
};

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function cleanText(value, max) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Decide la transición sin tocar la base: valida el paso y arma el metadata
 * nuevo. `alreadyDone` cuando el pedido ya está en ese paso o más adelante.
 */
export function planStoreStep(order, input = {}, now = new Date()) {
  const step = String(input.step || '').trim().toLowerCase();
  if (!STORE_STEPS.includes(step)) throw new Error('Paso inválido.');
  if (order.order_status === 'cancelled' || order.fulfillment_status === 'cancelled') {
    throw new Error('El pedido está cancelado.');
  }
  const current = String(order.fulfillment_status || '');
  if (!(current in STATUS_RANK)) throw new Error('Este pedido ya no se puede avanzar.');
  const pickup = String(order.shipping?.type || order.metadata?.delivery || '').trim().toLowerCase() === 'recojo';
  if (step === 'ship' && pickup) throw new Error('Un pedido de recojo no se envía: márcalo como recogido.');
  const target = STEP_TARGET[step];
  if (STATUS_RANK[current] >= STATUS_RANK[target]) {
    return { step, target, alreadyDone: true };
  }
  if (step === 'deliver' && !pickup && current !== 'shipped') {
    throw new Error('Marca el pedido como enviado antes de entregarlo.');
  }
  const progress = { ...(order.metadata?.storeFulfillment || {}) };
  const stamp = now.toISOString();
  // Al saltar pasos, los anteriores quedan con la misma hora.
  for (const key of STORE_STEPS) {
    if (STATUS_RANK[STEP_TARGET[key]] > STATUS_RANK[target]) break;
    if (key === 'ship' && pickup) continue;
    if (STATUS_RANK[STEP_TARGET[key]] > STATUS_RANK[current] && !progress[STEP_TIMESTAMP[key]]) {
      progress[STEP_TIMESTAMP[key]] = stamp;
    }
  }
  if (step === 'ship') {
    const carrier = cleanText(input.carrier, 40)?.toLowerCase();
    if (!carrier || !STORE_CARRIERS.includes(carrier)) throw new Error('Elige el transportista.');
    const trackingUrl = cleanText(input.trackingUrl, 500);
    if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) throw new Error('La URL de seguimiento debe empezar con http:// o https://.');
    progress.carrier = carrier;
    progress.trackingNumber = cleanText(input.trackingNumber, 120);
    progress.trackingUrl = trackingUrl;
  }
  return {
    step,
    target,
    alreadyDone: false,
    orderStatus: step === 'deliver' ? 'completed' : step === 'confirm' ? 'confirmed' : order.order_status,
    storeFulfillment: progress,
  };
}

export async function markStoreOrderStep(input = {}, dependencies = {}) {
  const orderId = Number(input.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new Error('Pedido inválido.');
  const pool = dependencies.db || (await loadCore()).pool;
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const owns = client !== pool;
  try {
    if (owns) await client.query('begin');
    const existing = (await client.query(
      `select o.*, ch.code as channel_code, a.id as account_id, a.company_id as account_company_id,
         a.settings as account_settings
       from orders o
       join order_channel_accounts a on a.id=o.channel_account_id
       join order_channels ch on ch.id=a.channel_id
       where o.id=$1 for update of o`,
      [orderId],
    )).rows[0];
    if (!existing) throw new Error('Pedido no encontrado.');
    if (existing.channel_code !== 'external') throw new Error('Solo los pedidos de la tienda web avanzan aquí.');
    const plan = planStoreStep(existing, input, dependencies.now ? dependencies.now() : new Date());
    if (plan.alreadyDone) {
      if (owns) await client.query('commit');
      return { ok: true, orderId, fulfillmentStatus: existing.fulfillment_status, alreadyDone: true };
    }
    const persisted = (await client.query(
      `update orders set fulfillment_status=$2, order_status=$3,
         metadata = metadata || jsonb_build_object('storeFulfillment', $4::jsonb),
         updated_at=now()
       where id=$1 returning *`,
      [orderId, plan.target, plan.orderStatus, JSON.stringify(plan.storeFulfillment)],
    )).rows[0];
    await (dependencies.stockPhase || stockPhase)({
      db: client,
      existing,
      persisted,
      account: {
        id: Number(existing.account_id),
        channelCode: existing.channel_code,
        companyId: Number(existing.account_company_id),
        settings: existing.account_settings || {},
      },
      source: 'user',
      actorUserId: input.markedBy || null,
    });
    await client.query(
      `insert into order_events (order_id, event_type, source, actor_user_id, idempotency_key,
         previous_values, new_values, payload)
       values ($1, $2, 'user', $3, $4, $5, $6, $7)
       on conflict (order_id, idempotency_key) do nothing`,
      [
        orderId,
        `order.store_${plan.step}`,
        input.markedBy || null,
        `order.store_step:${plan.step}:${orderId}`,
        JSON.stringify({ fulfillmentStatus: existing.fulfillment_status }),
        JSON.stringify({ fulfillmentStatus: plan.target }),
        JSON.stringify({ storeFulfillment: plan.storeFulfillment, markedBy: input.markedBy || null }),
      ],
    );
    if (owns) await client.query('commit');
    return { ok: true, orderId, fulfillmentStatus: plan.target, alreadyDone: false };
  } catch (error) {
    if (owns) await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    if (owns) client.release();
  }
}
