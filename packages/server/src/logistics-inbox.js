import { PDFDocument } from 'pdf-lib';
import { appendTicketInventoryPages, composeA4ShippingLabelSheet, ticketCode } from './shipping-label-sheet.js';
import { buildManualLabelSheet } from './manual-shipping-label.js';

const STAGES = new Set(['pending', 'ready', 'shipped']);
const CHANNELS = new Set(['falabella', 'ripley', 'manual']);
const OPEN_STATUSES = new Set(['pending', 'preparing', 'ready_to_ship', 'shipped', 'delivered']);
const MAX_PRINT = 80;

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function positiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function logisticsStage(fulfillmentStatus) {
  const status = String(fulfillmentStatus || '').trim().toLowerCase();
  if (status === 'pending' || status === 'preparing') return 'pending';
  if (status === 'ready_to_ship') return 'ready';
  if (status === 'shipped' || status === 'delivered') return 'shipped';
  return 'other';
}

export function parseLogisticsInboxFilters(input = {}) {
  const companyId = input.companyId === undefined || input.companyId === null || input.companyId === ''
    ? null
    : positiveInt(input.companyId, null, Number.MAX_SAFE_INTEGER);
  if (input.companyId !== undefined && input.companyId !== null && input.companyId !== '' && !companyId) {
    throw new Error('Tienda inválida.');
  }

  const stage = String(input.stage || 'pending').trim().toLowerCase();
  if (!STAGES.has(stage)) throw new Error('Etapa de pedido inválida.');

  const channelCode = String(input.channelCode || '').trim().toLowerCase();
  if (channelCode && !CHANNELS.has(channelCode)) throw new Error('Canal inválido.');

  return {
    companyId,
    stage,
    channelCode: channelCode || null,
    search: String(input.search || '').trim().slice(0, 120),
    limit: positiveInt(input.limit, 80, 300),
    offset: Math.max(Number.isInteger(Number(input.offset)) ? Number(input.offset) : 0, 0),
  };
}

function fulfillmentFilter(stage) {
  if (stage === 'pending') return ['pending', 'preparing'];
  if (stage === 'ready') return ['ready_to_ship'];
  return ['shipped', 'delivered'];
}

function itemImage(row) {
  const raw = row.raw_data || {};
  const meta = row.metadata || {};
  return String(
    raw.Image || raw.ImageUrl || raw.ImageURL || raw.ProductImage || raw.MainImage
    || meta.imageUrl || '',
  ).trim();
}

function normalizeItem(row) {
  return {
    id: Number(row.id),
    sku: row.sku || row.provider_sku || null,
    providerSku: row.provider_sku || null,
    description: row.description || 'Producto',
    quantity: Number(row.quantity) || 1,
    imageUrl: itemImage(row),
  };
}

function normalizeInboxOrder(row) {
  const items = Array.isArray(row.items) ? row.items.map(normalizeItem) : [];
  return {
    id: Number(row.id),
    companyId: row.company_id == null ? null : Number(row.company_id),
    companyName: row.company_name || 'Tienda',
    channelCode: row.channel_code,
    channelName: row.channel_name,
    channelAccountName: row.channel_account_name,
    externalOrderId: row.external_order_id,
    externalOrderNumber: row.external_order_number,
    orderStatus: row.order_status,
    fulfillmentStatus: row.fulfillment_status,
    stage: logisticsStage(row.fulfillment_status),
    providerStatus: row.provider_status,
    currency: row.currency || 'PEN',
    total: row.total == null ? null : Number(row.total),
    customer: row.customer || {},
    shipping: row.shipping || {},
    metadata: row.metadata || {},
    orderedAt: row.ordered_at,
    promisedShippingAt: row.promised_shipping_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemsCount: items.reduce((total, item) => total + item.quantity, 0),
    items,
    labelPrints: Array.isArray(row.label_prints) ? row.label_prints : [],
  };
}

function whereClause(filters, values, { forStage } = {}) {
  const where = [
    `o.order_status not in ('cancelled', 'failed')`,
    `o.fulfillment_status not in ('cancelled', 'returned', 'failed')`,
  ];
  if (filters.companyId) {
    values.push(filters.companyId);
    where.push(`o.company_id=$${values.length}`);
  }
  if (filters.channelCode) {
    values.push(filters.channelCode);
    where.push(`ch.code=$${values.length}`);
  }
  if (filters.search) {
    values.push(filters.search);
    where.push(`(
      o.external_order_id ilike '%' || $${values.length} || '%'
      or o.external_order_number ilike '%' || $${values.length} || '%'
      or coalesce(o.customer->>'name', '') ilike '%' || $${values.length} || '%'
      or coalesce(o.customer->>'phone', '') ilike '%' || $${values.length} || '%'
      or exists (
        select 1 from order_items oi
        where oi.order_id=o.id
          and (
            coalesce(oi.sku, '') ilike '%' || $${values.length} || '%'
            or coalesce(oi.description, '') ilike '%' || $${values.length} || '%'
          )
      )
    )`);
  }
  if (forStage) {
    values.push(fulfillmentFilter(forStage));
    where.push(`o.fulfillment_status = any($${values.length}::text[])`);
    if (forStage === 'shipped') {
      where.push(`coalesce(o.updated_at, o.ordered_at, o.created_at) >= now() - interval '7 days'`);
    }
  }
  return where;
}

export async function listLogisticsInbox(filtersInput = {}, db) {
  const filters = parseLogisticsInboxFilters(filtersInput);
  const target = db || (await loadCore()).pool;

  const countValues = [];
  const countWhere = whereClause(filters, countValues);
  const countResult = await target.query(
    `select
       count(*) filter (where o.fulfillment_status in ('pending', 'preparing'))::int as pending_count,
       count(*) filter (where o.fulfillment_status = 'ready_to_ship')::int as ready_count,
       count(*) filter (
         where o.fulfillment_status in ('shipped', 'delivered')
           and coalesce(o.updated_at, o.ordered_at, o.created_at) >= now() - interval '7 days'
       )::int as shipped_count
     from orders o
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     left join companies c on c.id=o.company_id
     where ${countWhere.join(' and ')}`,
    countValues,
  );

  const listValues = [];
  const listWhere = whereClause(filters, listValues, { forStage: filters.stage });
  listValues.push(filters.limit, filters.offset);
  const listResult = await target.query(
    `select o.id, o.company_id, o.channel_account_id, o.external_order_id, o.external_order_number,
       o.order_status, o.fulfillment_status, o.provider_status, o.currency, o.total,
       o.customer, o.shipping, o.metadata, o.ordered_at, o.promised_shipping_at,
       o.created_at, o.updated_at,
       ch.code as channel_code, ch.name as channel_name,
       a.display_name as channel_account_name,
       coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social, 'Tienda') as company_name,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', oi.id,
           'sku', oi.sku,
           'provider_sku', oi.provider_sku,
           'description', oi.description,
           'quantity', oi.quantity,
           'raw_data', oi.raw_data,
           'metadata', oi.metadata
         ) order by oi.id)
         from order_items oi where oi.order_id=o.id
       ), '[]'::jsonb) as items,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'labelIndex', prints.label_index,
           'printCount', prints.print_count,
           'lastPrintedAt', prints.last_printed_at
         ) order by prints.label_index)
         from falabella_label_prints prints
         where prints.company_id=o.company_id and prints.order_id=o.external_order_id
       ), '[]'::jsonb) as label_prints,
       count(*) over()::int as total_count
     from orders o
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     left join companies c on c.id=o.company_id
     where ${listWhere.join(' and ')}
     order by
       coalesce(o.promised_shipping_at, o.ordered_at, o.created_at) asc,
       o.id asc
     limit $${listValues.length - 1} offset $${listValues.length}`,
    listValues,
  );

  const counts = countResult.rows[0] || {};
  return {
    orders: listResult.rows.map(normalizeInboxOrder),
    counts: {
      pending: Number(counts.pending_count || 0),
      ready: Number(counts.ready_count || 0),
      shipped: Number(counts.shipped_count || 0),
    },
    totalCount: Number(listResult.rows[0]?.total_count || 0),
    limit: filters.limit,
    offset: filters.offset,
    stage: filters.stage,
  };
}

function decodePdf(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  const text = String(value);
  const base64 = text.includes(',') ? text.split(',').pop() : text;
  if (!base64) return null;
  return Buffer.from(base64, 'base64');
}

async function mergePdfBuffers(buffers) {
  const output = await PDFDocument.create();
  for (const buffer of buffers) {
    const source = await PDFDocument.load(buffer);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  return output.save();
}

function packingTicket(order, index) {
  return {
    code: ticketCode(index + 1),
    ticketNumber: index + 1,
    labelIndex: 1,
    labelCount: 1,
    inventory: {
      customerName: String(order.customer?.name || '').trim() || 'Cliente no informado',
      items: (order.items || []).map((item) => ({
        name: item.description,
        sellerSku: item.sku,
        sku: item.sku,
        quantity: item.quantity,
        imageUrl: item.imageUrl,
      })),
    },
  };
}

export function parsePrintSelection(input = {}) {
  const ids = [...new Set(
    (Array.isArray(input.orderIds) ? input.orderIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )];
  if (!ids.length) throw new Error('Selecciona al menos un pedido para imprimir.');
  if (ids.length > MAX_PRINT) throw new Error(`Puedes imprimir hasta ${MAX_PRINT} pedidos por vez.`);
  return {
    orderIds: ids,
    includePacking: input.includePacking !== false,
  };
}

async function loadPrintOrders(orderIds, db) {
  const result = await db.query(
    `select o.id, o.company_id, o.channel_account_id, o.external_order_id, o.external_order_number,
       o.order_status, o.fulfillment_status, o.provider_status, o.currency, o.total,
       o.customer, o.shipping, o.metadata, o.ordered_at, o.promised_shipping_at,
       o.created_at, o.updated_at,
       ch.code as channel_code, ch.name as channel_name,
       a.display_name as channel_account_name,
       coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social, 'Tienda') as company_name,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', oi.id,
           'sku', oi.sku,
           'provider_sku', oi.provider_sku,
           'description', oi.description,
           'quantity', oi.quantity,
           'raw_data', oi.raw_data,
           'metadata', oi.metadata
         ) order by oi.id)
         from order_items oi where oi.order_id=o.id
       ), '[]'::jsonb) as items
     from orders o
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     left join companies c on c.id=o.company_id
     where o.id = any($1::int[])
     order by coalesce(o.promised_shipping_at, o.ordered_at, o.created_at) asc, o.id asc`,
    [orderIds],
  );
  const found = result.rows.map(normalizeInboxOrder);
  if (found.length !== orderIds.length) {
    throw new Error('Uno o más pedidos ya no están disponibles.');
  }
  return found;
}

function svcLabelId(label) {
  return String(label?._id || label?.id || label?.document_id || '').trim();
}

function svcLabels(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  const list = Array.isArray(data.labels) ? data.labels
    : Array.isArray(root.labels) ? root.labels
      : [];
  return list;
}

export async function printLogisticsPack(input = {}, dependencies = {}) {
  const selection = parsePrintSelection(input);
  const core = dependencies.db ? null : await loadCore();
  const db = dependencies.db || core.pool;
  const orders = await loadPrintOrders(selection.orderIds, db);
  const skipped = [];
  const pdfParts = [];
  let labelCount = 0;

  const falabella = orders.filter((order) => order.channelCode === 'falabella');
  if (falabella.length) {
    const getLabel = dependencies.getFalabellaLabel;
    if (!getLabel) throw new Error('No hay generador de etiquetas Falabella.');
    const buffers = [];
    for (const order of falabella) {
      if (!order.companyId) {
        skipped.push({ id: order.id, reason: 'El pedido Falabella no tiene seller.' });
        continue;
      }
      try {
        const label = await getLabel({
          companyId: order.companyId,
          orderId: order.externalOrderId,
          orderNumber: order.externalOrderNumber,
        });
        const buffer = decodePdf(label?.base64 || label?.pdf || label);
        if (!buffer?.length) throw new Error('La etiqueta llegó vacía.');
        buffers.push(buffer);
        labelCount += 1;
      } catch (error) {
        skipped.push({ id: order.id, reason: error.message || 'No se pudo bajar la etiqueta Falabella.' });
      }
    }
    if (buffers.length) pdfParts.push(await composeA4ShippingLabelSheet(buffers));
  }

  const ripley = orders.filter((order) => order.channelCode === 'ripley');
  if (ripley.length) {
    const listLabels = dependencies.listRipleyLabels;
    const downloadLabels = dependencies.downloadRipleyLabels;
    if (!listLabels || !downloadLabels) throw new Error('No hay generador de etiquetas Ripley.');
    for (const order of ripley) {
      if (!order.companyId) {
        skipped.push({ id: order.id, reason: 'El pedido Ripley no tiene seller.' });
        continue;
      }
      try {
        const listed = await listLabels({
          companyId: order.companyId,
          orderId: order.externalOrderId,
        });
        const documentIds = svcLabels(listed).map(svcLabelId).filter(Boolean);
        if (!documentIds.length) throw new Error('Ripley aún no tiene etiqueta.');
        const downloaded = await downloadLabels({
          companyId: order.companyId,
          documentIds,
          orderId: order.externalOrderId,
        });
        const buffer = decodePdf(downloaded?.labels_generated || downloaded?.pdf || downloaded?.base64);
        if (!buffer?.length) throw new Error('La etiqueta Ripley llegó vacía.');
        pdfParts.push(buffer);
        labelCount += documentIds.length;
      } catch (error) {
        skipped.push({ id: order.id, reason: error.message || 'No se pudo bajar la etiqueta Ripley.' });
      }
    }
  }

  const manual = orders.filter((order) => order.channelCode === 'manual');
  if (manual.length) {
    pdfParts.push(await buildManualLabelSheet(manual));
    labelCount += manual.length;
  }

  const unknown = orders.filter((order) => !CHANNELS.has(order.channelCode));
  for (const order of unknown) {
    skipped.push({ id: order.id, reason: `Canal ${order.channelCode} aún no imprime etiqueta.` });
  }

  if (!pdfParts.length && !selection.includePacking) {
    throw new Error('No se pudo armar ninguna etiqueta.');
  }

  const printable = orders.filter((order) => !skipped.some((entry) => entry.id === order.id));
  let packingPageCount = 0;
  if (selection.includePacking && printable.length) {
    const packingPdf = await PDFDocument.create();
    const stats = await appendTicketInventoryPages(
      packingPdf,
      printable.map(packingTicket),
    );
    packingPageCount = stats.inventoryPageCount || 0;
    if (packingPageCount) pdfParts.push(await packingPdf.save());
  }

  if (!pdfParts.length) throw new Error('No hay nada para imprimir en esta selección.');

  const bytes = await mergePdfBuffers(pdfParts);
  const date = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    mimeType: 'application/pdf',
    base64: Buffer.from(bytes).toString('base64'),
    filename: `bandeja-${date}.pdf`,
    orderCount: printable.length,
    labelCount,
    packingPageCount,
    skipped,
  };
}

export async function printLogisticsPackWithDefaults(input = {}, dependencies = {}) {
  const core = dependencies.core || await loadCore();
  const ripleyLogistics = dependencies.ripleyLogistics || await import('./ripley-logistics.js');
  return printLogisticsPack(input, {
    db: dependencies.db || core.pool,
    getFalabellaLabel: dependencies.getFalabellaLabel || (({ companyId, orderId }) => (
      core.falabellaGetShippingLabel({ companyId, orderId, recordPrint: false })
    )),
    listRipleyLabels: dependencies.listRipleyLabels || (({ companyId, orderId }) => (
      ripleyLogistics.listRipleySvcLabels(companyId, { orderId, limit: 25 })
    )),
    downloadRipleyLabels: dependencies.downloadRipleyLabels || (({ companyId, documentIds, orderId }) => (
      ripleyLogistics.downloadRipleySvcLabels(companyId, { documentIds, orderId })
    )),
  });
}

export { OPEN_STATUSES };
