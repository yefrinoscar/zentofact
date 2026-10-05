import { randomUUID } from 'node:crypto';
import { applyInventoryMovement } from './inventory-service.js';
import { drainStockQueue } from './stock-jobs.js';
import { httpError, inTransaction, loadCore, positiveInt, text } from './utils.js';

// Resolución de descuentos con stock corto: mover unidades desde otro producto
// maestro (normalmente un duplicado creado por la importación) al producto que
// necesita el descuento, y reencolar los pedidos cubiertos. No toca
// publicaciones ni marketplaces; la auditoría vive en inventory_transfers y en
// los dos movimientos (transfer_out / transfer_in).

const REASON_CODES = ['import_duplicate', 'stock_on_other_product', 'count_correction', 'other'];
const REASON_LABELS = {
  import_duplicate: 'Duplicado de importación',
  stock_on_other_product: 'Stock registrado en otro producto',
  count_correction: 'Corrección de conteo',
  other: 'Otro',
};
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_WAITING_JOBS = 50;
const MAX_CANDIDATES = 20;

const ORDER_COMPANY_NAME = `coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social)`;

// Jobs que esperan unidades de un producto: líneas cortas de pedidos abiertos.
const WAITING_JOBS_SQL = `
  select j.id as job_id, j.status, j.attempts, j.last_error,
         coalesce(nullif(j.order_number, ''), o.external_order_number) as order_number,
         o.id as order_id, o.ordered_at, o.order_status, o.fulfillment_status,
         ${ORDER_COMPANY_NAME} as company_name, ch.code as channel_code,
         sum(greatest(oi.quantity - coalesce(oi.stock_applied_quantity, 0), 0))::int as missing
    from order_items oi
    join orders o on o.id = oi.order_id
    join inventory_stock_jobs j on j.order_id = o.id
    left join companies c on c.id = o.company_id
    left join order_channel_accounts a on a.id = o.channel_account_id
    left join order_channels ch on ch.id = a.channel_id
   where oi.stock_state = 'skipped_insufficient'
     and oi.product_id = $1
     and j.status in ('failed', 'skipped', 'pending', 'processing')
     and coalesce(o.order_status, '') not in ('cancelled', 'failed')
     and coalesce(o.fulfillment_status, '') not in ('cancelled', 'returned')
   group by j.id, j.status, j.attempts, j.last_error, j.order_number,
            o.id, o.ordered_at, o.order_status, o.fulfillment_status,
            c.nombre_comercial, c.nombre, c.razon_social, ch.code
   order by o.ordered_at asc nulls last, j.id asc
   limit ${MAX_WAITING_JOBS}`;

async function target(db) {
  return db || (await loadCore()).pool;
}

function transferCode() {
  let code = 'TRF-';
  for (let index = 0; index < 4; index += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function availableFrom(row) {
  return Number(row.quantity_on_hand || 0) - Number(row.quantity_reserved || 0) - Number(row.quantity_pending_return || 0);
}

function mapInventory(row) {
  return {
    onHand: Number(row.quantity_on_hand || 0),
    reserved: Number(row.quantity_reserved || 0),
    pendingReturn: Number(row.quantity_pending_return || 0),
    available: availableFrom(row),
  };
}

function mapTransfer(row) {
  return {
    id: Number(row.id),
    code: row.code,
    quantity: Number(row.quantity),
    reasonCode: row.reason_code,
    note: row.note || null,
    actorUserId: row.actor_user_id,
    stockJobId: row.stock_job_id == null ? null : Number(row.stock_job_id),
    requeuedJobIds: (row.requeued_job_ids || []).map(Number),
    createdAt: row.created_at,
  };
}

// Un job queda cubierto solo cuando sus unidades faltantes caben completas en
// el stock disponible del destino. El orden es FIFO por pedido.
export function computeCoverage({ availableAfter, jobs }) {
  let remaining = Math.max(Number(availableAfter) || 0, 0);
  const covered = [];
  const uncovered = [];
  for (const job of jobs) {
    const missing = Math.max(Number(job.missing) || 0, 0);
    if (missing > 0 && remaining >= missing) {
      covered.push({ ...job });
      remaining -= missing;
    } else {
      uncovered.push({ ...job, shortBy: Math.max(missing - remaining, 0) });
    }
  }
  return { covered, uncovered, leftover: remaining };
}

function mapWaitingJob(row) {
  return {
    jobId: Number(row.job_id),
    orderId: row.order_id == null ? null : Number(row.order_id),
    orderNumber: row.order_number || null,
    companyName: row.company_name || null,
    channelCode: row.channel_code || null,
    status: row.status,
    attempts: Number(row.attempts || 0),
    missing: Number(row.missing || 0),
    orderedAt: row.ordered_at,
  };
}

async function loadProduct(client, productId) {
  const result = await client.query(
    `select p.id, p.main_sku, p.name, p.image_url,
            i.quantity_on_hand, i.quantity_reserved, i.quantity_pending_return
       from products p
       left join product_inventory i on i.product_id = p.id
      where p.id = $1`,
    [productId],
  );
  if (!result.rows.length) throw httpError('Producto no encontrado.', 404);
  return result.rows[0];
}

async function listWaitingJobs(client, productId) {
  if (!productId) return [];
  const result = await client.query(WAITING_JOBS_SQL, [productId]);
  return result.rows.map(mapWaitingJob);
}

async function committedUnitsFor(client, productId) {
  const jobs = await listWaitingJobs(client, productId);
  return { units: jobs.reduce((sum, job) => sum + job.missing, 0), jobs };
}

function normalizeReason(input) {
  const reasonCode = String(input.reasonCode || '').trim().toLowerCase();
  if (!REASON_CODES.includes(reasonCode)) throw httpError('Motivo de transferencia inválido.', 400);
  const note = text(input.note, 'note', 500, { nullable: true });
  if (reasonCode === 'other' && !note) throw httpError('Describe el motivo de la transferencia.', 400);
  return { reasonCode, note };
}

function movementReason(reasonCode, note) {
  const label = REASON_LABELS[reasonCode] || reasonCode;
  return note ? `${label} · ${note}` : label;
}

// Diagnóstico del job: líneas cortas, inventario del producto y pedidos que
// esperan el mismo maestro.
export async function getJobShortage(jobIdInput, orderItemIdInput, db) {
  const jobId = positiveInt(jobIdInput, 'jobId');
  const client = await target(db);
  const jobResult = await client.query(
    `select j.id, j.status, j.attempts, j.source, j.last_error, j.result, j.order_id,
            j.order_number, j.updated_at,
            o.external_order_number, o.ordered_at, o.order_status, o.fulfillment_status,
            ${ORDER_COMPANY_NAME} as company_name, ch.code as channel_code
       from inventory_stock_jobs j
       left join orders o on o.id = j.order_id
       left join companies c on c.id = o.company_id
       left join order_channel_accounts a on a.id = o.channel_account_id
       left join order_channels ch on ch.id = a.channel_id
      where j.id = $1`,
    [jobId],
  );
  if (!jobResult.rows.length) throw httpError('Job no encontrado.', 404);
  const jobRow = jobResult.rows[0];

  let lines = [];
  if (jobRow.order_id != null) {
    const linesResult = await client.query(
      `select oi.id as order_item_id, oi.quantity, oi.stock_state,
              coalesce(oi.stock_applied_quantity, 0) as applied,
              greatest(oi.quantity - coalesce(oi.stock_applied_quantity, 0), 0)::int as missing,
              oi.product_id, oi.main_sku, oi.sku as seller_sku, oi.provider_sku,
              oi.listing_id, l.shop_sku,
              p.name as title, p.image_url,
              i.quantity_on_hand, i.quantity_reserved, i.quantity_pending_return
         from order_items oi
         left join products p on p.id = oi.product_id
         left join product_inventory i on i.product_id = oi.product_id
         left join product_listings l on l.id = oi.listing_id
        where oi.order_id = $1
        order by oi.id`,
      [jobRow.order_id],
    );
    lines = linesResult.rows.map((row) => ({
      orderItemId: Number(row.order_item_id),
      quantity: Number(row.quantity),
      applied: Number(row.applied),
      missing: Number(row.missing),
      stockState: row.stock_state,
      sellerSku: row.seller_sku || null,
      shopSku: row.shop_sku || row.provider_sku || null,
      listingId: row.listing_id == null ? null : Number(row.listing_id),
      product: row.product_id == null ? null : {
        id: Number(row.product_id),
        mainSku: row.main_sku || null,
        title: row.title || null,
        imageUrl: row.image_url || null,
      },
      inventory: row.product_id == null ? null : mapInventory(row),
    }));
  }

  const requestedItemId = orderItemIdInput == null || orderItemIdInput === '' ? null : Number(orderItemIdInput);
  const selected = lines.find((line) => line.orderItemId === requestedItemId)
    || lines.find((line) => line.missing > 0 && !['applied', 'reversed'].includes(line.stockState))
    || lines[0]
    || null;
  const waiting = selected?.product?.id ? await listWaitingJobs(client, selected.product.id) : [];

  return {
    job: {
      id: Number(jobRow.id),
      status: jobRow.status,
      attempts: Number(jobRow.attempts || 0),
      source: jobRow.source || null,
      lastError: jobRow.last_error || null,
    },
    order: {
      id: jobRow.order_id == null ? null : Number(jobRow.order_id),
      orderNumber: jobRow.order_number || jobRow.external_order_number || null,
      companyName: jobRow.company_name || null,
      channelCode: jobRow.channel_code || null,
      fulfillmentStatus: jobRow.fulfillment_status || null,
      orderedAt: jobRow.ordered_at || null,
    },
    lines,
    selectedOrderItemId: selected?.orderItemId || null,
    waiting,
    missingForProduct: waiting.reduce((sum, entry) => sum + entry.missing, 0),
  };
}

// Candidatos de origen: duplicados por Shop SKU o SKU del seller, más búsqueda
// manual. Nunca incluye el producto destino.
export async function listTransferCandidates(targetProductIdInput, options = {}, db) {
  const targetProductId = positiveInt(targetProductIdInput, 'productId');
  const client = await target(db);
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), MAX_CANDIDATES);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const query = text(options.q, 'q', 200, { nullable: true });

  const targetProduct = await loadProduct(client, targetProductId);
  const targetListings = await client.query(
    `select seller_sku, shop_sku from product_listings where product_id = $1 and status = 'active'`,
    [targetProductId],
  );
  const targetShopSkus = [...new Set(targetListings.rows.map((row) => row.shop_sku).filter(Boolean))];
  const targetSellerSkus = [...new Set(targetListings.rows.map((row) => row.seller_sku).filter(Boolean))];

  let rows = [];
  let totalCount = 0;
  if (query) {
    const search = `%${query}%`;
    const result = await client.query(
      `select p.id, p.main_sku, p.name, p.image_url,
              i.quantity_on_hand, i.quantity_reserved, i.quantity_pending_return,
              count(*) over()::int as total_count
         from products p
         left join product_inventory i on i.product_id = p.id
        where p.id <> $1
          and (
            p.main_sku ilike $2
            or p.name ilike $2
            or exists (
              select 1 from product_listings l
               where l.product_id = p.id and (l.seller_sku ilike $2 or l.shop_sku ilike $2)
            )
          )
        order by (coalesce(i.quantity_on_hand, 0) - coalesce(i.quantity_reserved, 0) - coalesce(i.quantity_pending_return, 0)) desc,
                 p.id desc
        limit $3 offset $4`,
      [targetProductId, search, limit, offset],
    );
    rows = result.rows;
    totalCount = Number(result.rows[0]?.total_count || 0);
  } else {
    const result = await client.query(
      `select p.id, p.main_sku, p.name, p.image_url,
              i.quantity_on_hand, i.quantity_reserved, i.quantity_pending_return
         from products p
         left join product_inventory i on i.product_id = p.id
        where p.id <> $1
          and exists (
            select 1 from product_listings l
             where l.product_id = p.id and l.status = 'active'
               and (
                 (l.shop_sku is not null and l.shop_sku = any($2::text[]))
                 or (l.seller_sku is not null and l.seller_sku = any($3::text[]))
               )
          )
        order by (coalesce(i.quantity_on_hand, 0) - coalesce(i.quantity_reserved, 0) - coalesce(i.quantity_pending_return, 0)) desc,
                 p.id desc
        limit $4`,
      [targetProductId, targetShopSkus, targetSellerSkus, limit],
    );
    rows = result.rows.map((row) => ({ ...row, sim: null }));
    // Título similar (pg_trgm): los duplicados de importación no siempre
    // comparten SKU, pero suelen tener el mismo nombre.
    if (targetProduct.name) {
      try {
        const similar = await client.query(
          `select p.id, p.main_sku, p.name, p.image_url,
                  i.quantity_on_hand, i.quantity_reserved, i.quantity_pending_return,
                  similarity(p.name, $2) as sim
             from products p
             left join product_inventory i on i.product_id = p.id
            where p.id <> $1 and p.name is not null and similarity(p.name, $2) >= 0.55
            order by sim desc, p.id desc
            limit 5`,
          [targetProductId, targetProduct.name],
        );
        const known = new Set(rows.map((row) => Number(row.id)));
        for (const row of similar.rows) {
          if (!known.has(Number(row.id))) rows.push({ ...row, sim: Number(row.sim) });
        }
      } catch (error) {
        console.warn('[stock-transfers] sugerencias por título no disponibles:', error?.message || error);
      }
    }
    totalCount = rows.length;
  }

  const candidateIds = rows.map((row) => Number(row.id));
  const listingsByProduct = new Map();
  const committedByProduct = new Map();
  if (candidateIds.length) {
    const listings = await client.query(
      `select l.product_id, l.seller_sku, l.shop_sku, ch.code as channel_code,
              ${ORDER_COMPANY_NAME} as company_name
         from product_listings l
         left join order_channel_accounts a on a.id = l.channel_account_id
         left join order_channels ch on ch.id = a.channel_id
         left join companies c on c.id = l.company_id
        where l.product_id = any($1::bigint[]) and l.status = 'active'
        order by l.product_id, l.id`,
      [candidateIds],
    );
    for (const row of listings.rows) {
      const key = Number(row.product_id);
      if (!listingsByProduct.has(key)) listingsByProduct.set(key, []);
      listingsByProduct.get(key).push({
        sellerSku: row.seller_sku || null,
        shopSku: row.shop_sku || null,
        channelCode: row.channel_code || null,
        companyName: row.company_name || null,
      });
    }
    const committed = await client.query(
      `select oi.product_id, sum(greatest(oi.quantity - coalesce(oi.stock_applied_quantity, 0), 0))::int as units,
              count(distinct j.id)::int as jobs
         from order_items oi
         join orders o on o.id = oi.order_id
         join inventory_stock_jobs j on j.order_id = o.id
        where oi.stock_state = 'skipped_insufficient'
          and oi.product_id = any($1::bigint[])
          and j.status in ('failed', 'skipped', 'pending', 'processing')
          and coalesce(o.order_status, '') not in ('cancelled', 'failed')
          and coalesce(o.fulfillment_status, '') not in ('cancelled', 'returned')
        group by oi.product_id`,
      [candidateIds],
    );
    for (const row of committed.rows) {
      committedByProduct.set(Number(row.product_id), { units: Number(row.units || 0), jobs: Number(row.jobs || 0) });
    }
  }

  const candidates = rows.map((row) => {
    const productId = Number(row.id);
    const listings = listingsByProduct.get(productId) || [];
    const reasons = [];
    if (listings.some((listing) => listing.shopSku && targetShopSkus.includes(listing.shopSku))) {
      reasons.push({ kind: 'same_shop_sku', label: 'Mismo Shop SKU' });
    }
    if (listings.some((listing) => listing.sellerSku && targetSellerSkus.includes(listing.sellerSku))) {
      reasons.push({ kind: 'same_seller_sku', label: 'Mismo SKU del seller' });
    }
    if (row.sim != null && Number(row.sim) >= 0.55) {
      reasons.push({ kind: 'similar_title', label: `Título similar ${Math.round(Number(row.sim) * 100)} %` });
    }
    const inventory = mapInventory(row);
    const committed = committedByProduct.get(productId) || { units: 0, jobs: 0 };
    return {
      productId,
      mainSku: row.main_sku || null,
      title: row.name || null,
      imageUrl: row.image_url || null,
      inventory,
      committed,
      reasons,
      listings,
      selectable: inventory.available > 0,
      disabledReason: inventory.available > 0 ? null : 'Sin stock disponible',
    };
  });

  const reasonPriority = { same_shop_sku: 0, same_seller_sku: 1, similar_title: 2 };
  candidates.sort((left, right) => {
    const leftPriority = Math.min(...left.reasons.map((reason) => reasonPriority[reason.kind] ?? 9), 9);
    const rightPriority = Math.min(...right.reasons.map((reason) => reasonPriority[reason.kind] ?? 9), 9);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return right.inventory.available - left.inventory.available;
  });

  return {
    target: {
      productId: targetProductId,
      mainSku: targetProduct.main_sku || null,
      title: targetProduct.name || null,
      inventory: mapInventory(targetProduct),
    },
    candidates,
    totalCount,
    limit,
    offset,
  };
}

// Vista previa sin escritura: disponible antes/después, pedidos cubiertos y
// avisos (stock comprometido del origen, disponible insuficiente).
export async function previewTransfer(input = {}, db) {
  const sourceProductId = positiveInt(input.sourceProductId, 'sourceProductId');
  const targetProductId = positiveInt(input.targetProductId, 'targetProductId');
  if (sourceProductId === targetProductId) throw httpError('El origen y el destino deben ser distintos.', 400);
  const quantity = positiveInt(input.quantity, 'quantity');
  const client = await target(db);

  const [sourceRow, targetRow] = await Promise.all([
    loadProduct(client, sourceProductId),
    loadProduct(client, targetProductId),
  ]);
  const sourceInventory = mapInventory(sourceRow);
  const targetInventory = mapInventory(targetRow);
  const waiting = await listWaitingJobs(client, targetProductId);
  const committed = await committedUnitsFor(client, sourceProductId);

  const missingBefore = waiting.reduce((sum, job) => sum + job.missing, 0);
  const availableAfter = targetInventory.available + quantity;
  const coverage = computeCoverage({ availableAfter, jobs: waiting });
  const errors = [];
  if (quantity > sourceInventory.available) {
    errors.push({
      code: 'exceeds_available',
      message: `${sourceRow.main_sku || 'El origen'} solo tiene ${sourceInventory.available} u disponibles.`,
    });
  }
  const requiresAcknowledgeCommitted = quantity > Math.max(sourceInventory.available - committed.units, 0)
    && input.acknowledgeCommitted !== true;
  const currentJobId = input.stockJobId == null || input.stockJobId === '' ? null : Number(input.stockJobId);

  return {
    source: {
      productId: sourceProductId,
      mainSku: sourceRow.main_sku || null,
      availableBefore: sourceInventory.available,
      availableAfter: sourceInventory.available - quantity,
      committedUnits: committed.units,
      committedJobs: committed.jobs.map((job) => ({
        jobId: job.jobId, orderNumber: job.orderNumber, missing: job.missing,
      })),
    },
    target: {
      productId: targetProductId,
      mainSku: targetRow.main_sku || null,
      availableBefore: targetInventory.available,
      availableAfter,
      missingBefore,
      missingAfter: Math.max(missingBefore - quantity, 0),
    },
    covered: coverage.covered.map((job) => ({
      jobId: job.jobId, orderNumber: job.orderNumber, companyName: job.companyName,
      channelCode: job.channelCode, quantity: job.missing, status: job.status,
    })),
    uncovered: coverage.uncovered.map((job) => ({
      jobId: job.jobId, orderNumber: job.orderNumber, companyName: job.companyName,
      channelCode: job.channelCode, quantity: job.missing, status: job.status, shortBy: job.shortBy,
    })),
    currentJobCovered: currentJobId == null
      ? null
      : coverage.covered.some((job) => job.jobId === currentJobId),
    requiresAcknowledgeCommitted,
    errors,
  };
}

async function requeueCoveredJobs(client, covered) {
  const requeued = [];
  const skipped = [];
  for (const job of covered) {
    if (job.status === 'failed' || job.status === 'skipped') {
      const updated = await client.query(
        `update inventory_stock_jobs
            set status='pending', attempts=0, last_error=null, next_attempt_at=null, updated_at=now()
          where id=$1 and status in ('failed', 'skipped')
          returning id, order_number, status`,
        [job.jobId],
      );
      if (updated.rows.length) {
        requeued.push({ jobId: Number(updated.rows[0].id), orderNumber: updated.rows[0].order_number, status: updated.rows[0].status });
      } else {
        skipped.push({ jobId: job.jobId, reason: 'job_changed' });
      }
    } else if (job.status === 'pending' || job.status === 'processing') {
      requeued.push({ jobId: job.jobId, orderNumber: job.orderNumber, status: job.status });
    } else {
      skipped.push({ jobId: job.jobId, reason: 'job_changed' });
    }
  }
  return { requeued, skipped };
}

// Transferencia atómica: registro + dos movimientos + reencolado de pedidos
// cubiertos en una sola transacción. Idempotente por Idempotency-Key.
export async function createTransfer(input = {}, actorUserId, db) {
  const sourceProductId = positiveInt(input.sourceProductId, 'sourceProductId');
  const targetProductId = positiveInt(input.targetProductId, 'targetProductId');
  if (sourceProductId === targetProductId) throw httpError('El origen y el destino deben ser distintos.', 400);
  const quantity = positiveInt(input.quantity, 'quantity');
  const { reasonCode, note } = normalizeReason(input);
  const idempotencyKey = text(input.idempotencyKey || `transfer:${randomUUID()}`, 'idempotencyKey', 500);
  const stockJobId = input.stockJobId == null || input.stockJobId === '' ? null : positiveInt(input.stockJobId, 'stockJobId');
  const retry = input.retry !== false;
  const acknowledgeCommitted = input.acknowledgeCommitted === true;

  const result = await inTransaction(db, async (client) => {
    const existing = await client.query(
      'select * from inventory_transfers where idempotency_key=$1 limit 1',
      [idempotencyKey],
    );
    if (existing.rows.length) {
      const row = existing.rows[0];
      const jobs = await client.query(
        `select id, order_number, status from inventory_stock_jobs where id = any($1::bigint[])`,
        [row.requeued_job_ids || []],
      );
      return {
        transfer: mapTransfer(row),
        requeued: jobs.rows.map((job) => ({ jobId: Number(job.id), orderNumber: job.order_number, status: job.status })),
        skipped: [],
        replayed: true,
      };
    }

    await client.query(
      `insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
       values ($1, 0, 0), ($2, 0, 0) on conflict (product_id) do nothing`,
      [sourceProductId, targetProductId],
    );
    // Bloqueo ordenado por product_id para evitar deadlocks entre transferencias cruzadas.
    const locked = await client.query(
      `select product_id, quantity_on_hand, quantity_reserved, quantity_pending_return
         from product_inventory
        where product_id = any($1::bigint[])
        order by product_id
          for update`,
      [[sourceProductId, targetProductId]],
    );
    const sourceRow = locked.rows.find((row) => Number(row.product_id) === sourceProductId);
    const targetRow = locked.rows.find((row) => Number(row.product_id) === targetProductId);
    if (!sourceRow || !targetRow) throw httpError('Producto no encontrado.', 404);

    const sourceInventory = mapInventory(sourceRow);
    if (quantity > sourceInventory.available) {
      const error = httpError(`Solo hay ${sourceInventory.available} u disponibles en el origen.`, 409);
      error.code = 'insufficient_stock';
      error.details = { available: sourceInventory.available };
      throw error;
    }

    const committed = await committedUnitsFor(client, sourceProductId);
    if (quantity > Math.max(sourceInventory.available - committed.units, 0) && !acknowledgeCommitted) {
      const error = httpError('El origen tiene pedidos esperando stock.', 409);
      error.code = 'source_committed';
      error.details = {
        committedUnits: committed.units,
        jobs: committed.jobs.map((job) => ({ jobId: job.jobId, orderNumber: job.orderNumber, missing: job.missing })),
      };
      throw error;
    }

    if (stockJobId != null) {
      const job = await client.query(
        'select id from inventory_stock_jobs where id=$1 for update',
        [stockJobId],
      );
      if (!job.rows.length) throw httpError('Job no encontrado.', 404);
    }

    const [sourceProduct, targetProduct] = await Promise.all([
      loadProduct(client, sourceProductId),
      loadProduct(client, targetProductId),
    ]);

    let transferRow = null;
    for (let attempt = 0; attempt < 5 && !transferRow; attempt += 1) {
      try {
        const inserted = await client.query(
          `insert into inventory_transfers (
             code, source_product_id, target_product_id, quantity, reason_code, note,
             actor_user_id, stock_job_id, idempotency_key, acknowledged_committed
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           returning *`,
          [
            transferCode(), sourceProductId, targetProductId, quantity, reasonCode,
            note || null, actorUserId ? String(actorUserId) : 'system', stockJobId,
            idempotencyKey, acknowledgeCommitted,
          ],
        );
        transferRow = inserted.rows[0];
      } catch (error) {
        if (error?.code === '23505' && String(error?.constraint || '').includes('idempotency')) {
          const raced = await client.query('select * from inventory_transfers where idempotency_key=$1', [idempotencyKey]);
          if (raced.rows.length) {
            return { transfer: mapTransfer(raced.rows[0]), requeued: [], skipped: [], replayed: true };
          }
        }
        if (error?.code !== '23505') throw error;
      }
    }
    if (!transferRow) throw httpError('No se pudo generar el código de la transferencia.', 500);

    const movementMetadata = {
      transferId: Number(transferRow.id),
      transferCode: transferRow.code,
      stockJobId,
    };
    const reason = movementReason(reasonCode, note);
    const out = await applyInventoryMovement(client, {
      productId: sourceProductId,
      quantityDelta: -quantity,
      movementType: 'transfer_out',
      reason,
      actorUserId,
      source: 'transfer',
      idempotencyKey: `transfer:${idempotencyKey}:out`,
      metadata: { ...movementMetadata, counterpartProductId: targetProductId, counterpartMainSku: targetProduct.main_sku || null },
    });
    const incoming = await applyInventoryMovement(client, {
      productId: targetProductId,
      quantityDelta: quantity,
      movementType: 'transfer_in',
      reason,
      actorUserId,
      source: 'transfer',
      idempotencyKey: `transfer:${idempotencyKey}:in`,
      metadata: { ...movementMetadata, counterpartProductId: sourceProductId, counterpartMainSku: sourceProduct.main_sku || null },
    });

    let requeued = [];
    let skipped = [];
    if (retry) {
      const waiting = await listWaitingJobs(client, targetProductId);
      const coverage = computeCoverage({
        availableAfter: targetInventoryOf(targetRow) + quantity,
        jobs: waiting,
      });
      ({ requeued, skipped } = await requeueCoveredJobs(client, coverage.covered));
      await client.query(
        'update inventory_transfers set requeued_job_ids=$2 where id=$1',
        [transferRow.id, requeued.map((job) => job.jobId)],
      );
    }

    return {
      transfer: {
        ...mapTransfer(transferRow),
        source: {
          productId: sourceProductId,
          mainSku: sourceProduct.main_sku || null,
          onHandBefore: sourceInventory.onHand,
          onHandAfter: out.quantityOnHand,
          movementId: out.movement?.id ?? null,
        },
        target: {
          productId: targetProductId,
          mainSku: targetProduct.main_sku || null,
          onHandBefore: targetInventoryOf(targetRow),
          onHandAfter: incoming.quantityOnHand,
          movementId: incoming.movement?.id ?? null,
        },
      },
      requeued,
      skipped,
      replayed: false,
    };
  });

  if (!result.replayed && result.requeued.length) {
    drainStockQueue({ limit: 4 }).catch((error) => {
      console.error('[stock-transfers] no se pudo drenar la cola:', error?.message || error);
    });
  }
  return result;
}

function targetInventoryOf(row) {
  return Number(row.quantity_on_hand || 0);
}

// Reencolado masivo con la misma semántica que retryJob.
export async function requeueStockJobs(input = {}, db) {
  const ids = Array.isArray(input.jobIds)
    ? [...new Set(input.jobIds.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
    : [];
  if (!ids.length) throw httpError('Indica los pedidos a reintentar.', 400);
  if (ids.length > 50) throw httpError('Puedes reintentar hasta 50 pedidos por vez.', 400);
  const client = await target(db);
  const updated = await client.query(
    `update inventory_stock_jobs
        set status='pending', attempts=0, last_error=null, next_attempt_at=null, updated_at=now()
      where id = any($1::bigint[]) and status in ('failed', 'skipped')
      returning id, order_number, status`,
    [ids],
  );
  const requeuedIds = new Set(updated.rows.map((row) => Number(row.id)));
  return {
    requeued: updated.rows.map((row) => ({
      jobId: Number(row.id), orderNumber: row.order_number, status: row.status,
    })),
    skipped: ids.filter((id) => !requeuedIds.has(id)).map((id) => ({ jobId: id, reason: 'job_changed' })),
  };
}
