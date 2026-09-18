import { applyInventoryMovement } from './inventory-service.js';
import { httpError, inTransaction, positiveInt } from './utils.js';

export const RETURN_INCIDENT_CONDITIONS = ['not_arrived', 'unusable'];

const REASON_BY_CONDITION = {
  not_arrived: 'Devolución no recibida',
  unusable: 'Devolución inusable',
};

export function normalizeReturnCondition(value) {
  const condition = String(value ?? '').trim().toLowerCase();
  if (!RETURN_INCIDENT_CONDITIONS.includes(condition)) {
    throw httpError('condition inválida.');
  }
  return condition;
}

/**
 * Unidades que esta devolución reintegró al stock vendible. Se apoya en las
 * aprobaciones automáticas de `return_stock_approvals`, que es el registro
 * auditable de lo que efectivamente entró al almacén.
 */
async function loadRestockedQuantity(db, productId, orderId) {
  const result = await db.query(
    `select o.external_order_number,
       coalesce(sum(rsa.stock_quantity) filter (where rsa.status='approved'), 0) as restocked_quantity
     from orders o
     left join return_stock_approvals rsa
       on rsa.order_id=o.id and rsa.product_id=$2
     where o.id=$1
     group by o.id, o.external_order_number`,
    [orderId, productId],
  );
  if (!result.rows.length) throw httpError('Pedido no encontrado.', 404);
  return {
    orderNumber: result.rows[0].external_order_number || null,
    restockedQuantity: Number(result.rows[0].restocked_quantity || 0),
  };
}

function incidentReason(condition, context, orderId) {
  const label = REASON_BY_CONDITION[condition] || 'Devolución con incidencia';
  return `${label} · pedido ${context.orderNumber || orderId}`;
}

/**
 * Marca una devolución como no recibida o inusable y da de baja del stock
 * vendible las unidades que la devolución había reintegrado. Idempotente por
 * incidencia: reintentar no vuelve a descontar.
 */
export async function setReturnIncident(productIdInput, orderIdInput, conditionInput, actorUserId, db) {
  const productId = positiveInt(productIdInput, 'productId');
  const orderId = positiveInt(orderIdInput, 'orderId');
  const condition = normalizeReturnCondition(conditionInput);
  const actor = actorUserId ? String(actorUserId) : null;
  return inTransaction(db, async (client) => {
    const context = await loadRestockedQuantity(client, productId, orderId);
    if (context.restockedQuantity <= 0) {
      throw httpError('Esta devolución no tiene stock reintegrado.', 400);
    }
    const existing = await client.query(
      `select id, condition, quantity, revision
         from product_return_incidents
        where product_id=$1 and order_id=$2
        for update`,
      [productId, orderId],
    );
    const reason = incidentReason(condition, context, orderId);

    if (!existing.rows.length) {
      const quantity = context.restockedQuantity;
      await applyInventoryMovement(client, {
        productId,
        quantityDelta: -quantity,
        movementType: 'adjustment_out',
        reason,
        actorUserId: actor,
        source: 'return_incident',
        orderId,
        idempotencyKey: `return-incident:product:${productId}:order:${orderId}:out:create`,
        metadata: { condition, quantity, orderNumber: context.orderNumber },
        allowNegative: true,
      });
      const inserted = await client.query(
        `insert into product_return_incidents (
           product_id, order_id, condition, quantity, revision, actor_user_id
         ) values ($1,$2,$3,$4,1,$5)
         on conflict (product_id, order_id) do nothing
         returning id`,
        [productId, orderId, condition, quantity, actor],
      );
      return {
        productId,
        orderId,
        orderNumber: context.orderNumber,
        condition,
        quantity,
        revision: 1,
        restockedQuantity: context.restockedQuantity,
        applied: inserted.rows.length > 0,
      };
    }

    const current = existing.rows[0];
    const storedQuantity = Number(current.quantity);
    const delta = context.restockedQuantity - storedQuantity;
    const nextRevision = Number(current.revision) + 1;
    if (delta !== 0) {
      await applyInventoryMovement(client, {
        productId,
        quantityDelta: -delta,
        movementType: delta > 0 ? 'adjustment_out' : 'adjustment_in',
        reason,
        actorUserId: actor,
        source: 'return_incident',
        orderId,
        idempotencyKey: `return-incident:product:${productId}:order:${orderId}:rev:${nextRevision}`,
        metadata: { condition, quantity: context.restockedQuantity, orderNumber: context.orderNumber },
        allowNegative: true,
      });
    }
    await client.query(
      `update product_return_incidents
          set condition=$1, quantity=$2, revision=$3, actor_user_id=$4, updated_at=now()
        where id=$5`,
      [condition, context.restockedQuantity, nextRevision, actor, current.id],
    );
    return {
      productId,
      orderId,
      orderNumber: context.orderNumber,
      condition,
      quantity: context.restockedQuantity,
      revision: nextRevision,
      restockedQuantity: context.restockedQuantity,
      applied: delta !== 0,
    };
  });
}

/** Quita la incidencia y devuelve las unidades al stock vendible. */
export async function clearReturnIncident(productIdInput, orderIdInput, actorUserId, db) {
  const productId = positiveInt(productIdInput, 'productId');
  const orderId = positiveInt(orderIdInput, 'orderId');
  const actor = actorUserId ? String(actorUserId) : null;
  return inTransaction(db, async (client) => {
    const existing = await client.query(
      `select id, quantity, revision
         from product_return_incidents
        where product_id=$1 and order_id=$2
        for update`,
      [productId, orderId],
    );
    if (!existing.rows.length) return { productId, orderId, cleared: false, quantity: 0 };
    const current = existing.rows[0];
    const quantity = Number(current.quantity);
    await applyInventoryMovement(client, {
      productId,
      quantityDelta: quantity,
      movementType: 'adjustment_in',
      reason: 'Devolución corregida (vuelve al stock vendible)',
      actorUserId: actor,
      source: 'return_incident',
      orderId,
      idempotencyKey: `return-incident:product:${productId}:order:${orderId}:in:incident:${Number(current.id)}`,
      metadata: { quantity },
      allowNegative: true,
    });
    await client.query('delete from product_return_incidents where id=$1', [current.id]);
    return { productId, orderId, cleared: true, quantity };
  });
}
