import { PDFDocument } from 'pdf-lib';
import { appendTicketInventoryPages, composeA4ShippingLabelSheet, ticketCode } from './shipping-label-sheet.js';
import { buildManualLabelSheet } from './manual-shipping-label.js';

const STAGES = new Set(['pending', 'ready', 'shipped']);
const CHANNELS = new Set(['falabella', 'ripley', 'manual']);
const URGENCIES = new Set(['overdue', 'today', 'tomorrow', 'later']);
const LIMA = 'America/Lima';
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

  const urgency = String(input.urgency || '').trim().toLowerCase();
  if (urgency && !URGENCIES.has(urgency)) throw new Error('Prioridad inválida.');

  return {
    companyId,
    stage,
    channelCode: channelCode || null,
    urgency: urgency || null,
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
    row.image_url
    || raw.Image || raw.ImageUrl || raw.ImageURL || raw.ProductImage || raw.MainImage
    || meta.imageUrl || '',
  ).trim();
}

function normalizeItem(row) {
  return {
    id: Number(row.id),
    sku: row.sku || row.provider_sku || null,
    providerSku: row.provider_sku || null,
    shopSku: row.shop_sku || null,
    description: row.description || row.product_name || 'Producto',
    quantity: Number(row.quantity) || 1,
    imageUrl: itemImage(row),
  };
}

// Registro de impresión: la bandeja propia manda; las etiquetas Falabella
// impresas desde /pedidos cuentan como respaldo.
function normalizeLabelPrint(row) {
  if (row.label_print && typeof row.label_print === 'object' && row.label_print.print_count != null) {
    return {
      printCount: Number(row.label_print.print_count) || 0,
      lastPrintedAt: row.label_print.last_printed_at || null,
    };
  }
  const prints = Array.isArray(row.label_prints) ? row.label_prints : [];
  if (!prints.length) return null;
  return {
    printCount: prints.reduce((total, print) => total + (Number(print.printCount) || 0), 0),
    lastPrintedAt: prints
      .map((print) => print.lastPrintedAt)
      .filter(Boolean)
      .sort()
      .pop() || null,
  };
}

export function urgencyForDeadline(value, now = new Date()) {
  if (!value) return 'later';
  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) return 'later';
  if (deadline.getTime() < now.getTime()) return 'overdue';
  const dayOf = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: LIMA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const deadlineDay = dayOf(deadline);
  if (deadlineDay === dayOf(now)) return 'today';
  if (deadlineDay === dayOf(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return 'tomorrow';
  return 'later';
}

// Los marketplaces mandan una línea por unidad; el operador quiere ver
// "Bastón x6", no seis filas iguales.
export function groupLogisticsItems(items) {
  const groups = new Map();
  for (const item of items) {
    const key = String(item.sku || item.description || item.id).trim().toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.lineCount += 1;
      if (!existing.imageUrl && item.imageUrl) existing.imageUrl = item.imageUrl;
      if (!existing.shopSku && item.shopSku) existing.shopSku = item.shopSku;
      continue;
    }
    groups.set(key, { ...item, lineCount: 1 });
  }
  return [...groups.values()];
}

function normalizeInboxOrder(row) {
  const items = groupLogisticsItems(Array.isArray(row.items) ? row.items.map(normalizeItem) : []);
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
    urgency: urgencyForDeadline(row.promised_shipping_at),
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
    labelPrint: normalizeLabelPrint(row),
  };
}

const URGENCY_SQL = {
  overdue: `o.promised_shipping_at is not null and o.promised_shipping_at < now()`,
  today: `o.promised_shipping_at >= now()
    and (o.promised_shipping_at at time zone '${LIMA}')::date = (now() at time zone '${LIMA}')::date`,
  tomorrow: `o.promised_shipping_at >= now()
    and (o.promised_shipping_at at time zone '${LIMA}')::date = (now() at time zone '${LIMA}')::date + 1`,
  later: `o.promised_shipping_at is not null
    and o.promised_shipping_at >= now()
    and (o.promised_shipping_at at time zone '${LIMA}')::date > (now() at time zone '${LIMA}')::date + 1`,
};

const DATED_UPCOMING_SQL = `o.promised_shipping_at is not null and o.promised_shipping_at >= now()`;

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
    } else {
      where.push(DATED_UPCOMING_SQL);
      if (filters.urgency) where.push(`(${URGENCY_SQL[filters.urgency]})`);
    }
  }
  return where;
}

const ITEMS_SQL = `coalesce((
  select jsonb_agg(jsonb_build_object(
    'id', oi.id,
    'sku', oi.sku,
    'provider_sku', oi.provider_sku,
    'shop_sku', coalesce(
      nullif(trim(listing.shop_sku), ''),
      nullif(trim(oi.raw_data->>'ShopSku'), ''),
      nullif(trim(oi.raw_data->>'ShopSKU'), '')
    ),
    'description', oi.description,
    'product_name', p.name,
    'quantity', oi.quantity,
    'image_url', coalesce(
      nullif(p.image_url, ''),
      nullif(psku.image_url, ''),
      nullif(listing.metadata->'images'->>0, ''),
      nullif(listing.metadata->'images'->0->>'Url', ''),
      nullif(listing.metadata->'images'->0->>'url', ''),
      nullif(listing.metadata->>'imageUrl', '')
    ),
    'raw_data', oi.raw_data,
    'metadata', oi.metadata
  ) order by oi.id)
  from order_items oi
  left join products p on p.id=oi.product_id
  left join products psku
    on psku.main_sku = coalesce(nullif(oi.main_sku, ''), nullif(oi.sku, ''))
  left join product_listings listing on listing.id = oi.listing_id
  where oi.order_id=o.id
), '[]'::jsonb) as items`;

const LABEL_PRINT_SQL = `(
  select jsonb_build_object(
    'print_count', lp.print_count,
    'last_printed_at', lp.last_printed_at
  )
  from logistics_label_prints lp
  where lp.order_id=o.id
) as label_print`;

export async function listLogisticsInbox(filtersInput = {}, db) {
  const filters = parseLogisticsInboxFilters(filtersInput);
  const target = db || (await loadCore()).pool;

  const countValues = [];
  const countWhere = whereClause(filters, countValues);
  const countResult = await target.query(
    `select
       count(*) filter (where o.fulfillment_status in ('pending', 'preparing') and ${DATED_UPCOMING_SQL})::int as pending_count,
       count(*) filter (where o.fulfillment_status = 'ready_to_ship' and ${DATED_UPCOMING_SQL})::int as ready_count,
       count(*) filter (
         where o.fulfillment_status in ('shipped', 'delivered')
           and coalesce(o.updated_at, o.ordered_at, o.created_at) >= now() - interval '7 days'
       )::int as shipped_count,
       count(*) filter (where o.fulfillment_status in ('pending', 'preparing', 'ready_to_ship') and ${URGENCY_SQL.overdue})::int as overdue_count,
       count(*) filter (where o.fulfillment_status in ('pending', 'preparing', 'ready_to_ship') and ${URGENCY_SQL.today})::int as today_count,
       count(*) filter (where o.fulfillment_status in ('pending', 'preparing', 'ready_to_ship') and ${URGENCY_SQL.tomorrow})::int as tomorrow_count,
       count(*) filter (where o.fulfillment_status in ('pending', 'preparing', 'ready_to_ship') and ${URGENCY_SQL.later})::int as later_count
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
       ${ITEMS_SQL},
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'labelIndex', prints.label_index,
           'printCount', prints.print_count,
           'lastPrintedAt', prints.last_printed_at
         ) order by prints.label_index)
         from falabella_label_prints prints
         where prints.company_id=o.company_id and prints.order_id=o.external_order_id
       ), '[]'::jsonb) as label_prints,
       ${LABEL_PRINT_SQL},
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
      urgency: {
        overdue: Number(counts.overdue_count || 0),
        today: Number(counts.today_count || 0),
        tomorrow: Number(counts.tomorrow_count || 0),
        later: Number(counts.later_count || 0),
      },
    },
    totalCount: Number(listResult.rows[0]?.total_count || 0),
    limit: filters.limit,
    offset: filters.offset,
    stage: filters.stage,
  };
}

function decodePdf(value) {
  if (!value) return null;
  let buffer = null;
  if (Buffer.isBuffer(value)) buffer = value;
  else if (value instanceof Uint8Array) buffer = Buffer.from(value);
  else {
    const text = String(value);
    const base64 = text.includes(',') ? text.split(',').pop() : text;
    if (!base64) return null;
    buffer = Buffer.from(base64, 'base64');
  }
  if (!buffer?.length) return null;
  const header = buffer.subarray(0, 8).toString('utf8');
  if (!header.includes('%PDF')) return null;
  return buffer;
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
       ${ITEMS_SQL}
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

async function recordLabelPrints(db, orderIds, printedBy) {
  await db.query(
    `insert into logistics_label_prints (order_id, print_count, first_printed_at, last_printed_at, last_printed_by)
     select id, 1, now(), now(), $2 from unnest($1::bigint[]) as ids(id)
     on conflict (order_id) do update set
       print_count = logistics_label_prints.print_count + 1,
       last_printed_at = now(),
       last_printed_by = excluded.last_printed_by`,
    [orderIds, printedBy ? String(printedBy).slice(0, 120) : null],
  );
}

function svcPayload(value) {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
}

function svcLabelId(label) {
  return String(label?.document_id || label?.documentId || label?._id || label?.id || '').trim();
}

function svcLabels(payload) {
  const data = svcPayload(payload);
  const root = payload && typeof payload === 'object' ? payload : {};
  if (Array.isArray(data.labels)) return data.labels;
  if (Array.isArray(root.labels)) return root.labels;
  return [];
}

function labelsForOrder(payload, orderId) {
  const wanted = String(orderId || '').trim();
  const labels = svcLabels(payload);
  if (!wanted) return labels;
  const matching = labels.filter((label) => {
    const labelOrder = String(
      label?.order_id || label?.orderId || label?.order_data?.order_id || '',
    ).trim();
    return !labelOrder || labelOrder === wanted;
  });
  return matching.length ? matching : labels;
}

function svcPdfValue(value, keys = ['labels_generated', 'pdf', 'base64', 'document']) {
  if (typeof value === 'string' && value.trim()) return value;
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key];
  }
  if (value.data && value.data !== value) return svcPdfValue(value.data, keys);
  return null;
}

export function ripleyOrderLookupIds(order = {}) {
  return [...new Set([
    order.externalOrderId,
    order.externalOrderNumber,
    order.metadata?.commercialId,
    order.metadata?.ripleySvc?.orderId,
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

function printFailureMessage(skipped) {
  if (skipped.length === 1) return skipped[0].reason;
  if (skipped.length) return skipped.map((entry) => entry.reason).filter(Boolean).join(' ');
  return 'No hay nada para imprimir en esta selección.';
}

async function downloadRipleyOrderLabel(order, listLabels, downloadLabels) {
  const lookupIds = ripleyOrderLookupIds(order);
  if (!lookupIds.length) throw new Error('El pedido Ripley no tiene número para buscar la etiqueta.');
  let lastEmpty = 'Ripley aún no tiene etiqueta.';
  for (const orderId of lookupIds) {
    try {
      const listed = await listLabels({
        companyId: order.companyId,
        orderId,
      });
      const documentIds = labelsForOrder(listed, orderId).map(svcLabelId).filter(Boolean);
      if (!documentIds.length) continue;
      const downloaded = await downloadLabels({
        companyId: order.companyId,
        documentIds,
        orderId,
      });
      const buffer = decodePdf(svcPdfValue(downloaded));
      if (!buffer?.length) throw new Error('La etiqueta Ripley llegó vacía.');
      return { buffer, labelCount: documentIds.length };
    } catch (error) {
      const reason = error.message || lastEmpty;
      if (/credenciales|llegó vacía/i.test(reason)) throw error;
      lastEmpty = reason;
    }
  }
  throw new Error(lastEmpty);
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
        const downloaded = await downloadRipleyOrderLabel(order, listLabels, downloadLabels);
        pdfParts.push(downloaded.buffer);
        labelCount += downloaded.labelCount;
      } catch (error) {
        const reason = error.message || 'No se pudo bajar la etiqueta Ripley.';
        console.warn(JSON.stringify({
          event: 'logistics.print.ripley_skipped',
          orderId: order.id,
          externalOrderId: order.externalOrderId,
          reason,
        }));
        try {
          pdfParts.push(await buildManualLabelSheet([order]));
          labelCount += 1;
          skipped.push({
            id: order.id,
            reason: `${reason} Se imprimió una etiqueta ZentoFact.`,
            printed: true,
          });
        } catch {
          skipped.push({ id: order.id, reason });
        }
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
    throw new Error(printFailureMessage(skipped));
  }

  const printable = orders.filter((order) => {
    const skip = skipped.find((entry) => entry.id === order.id);
    if (!skip) return CHANNELS.has(order.channelCode);
    return skip.printed === true;
  });
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

  if (!pdfParts.length) throw new Error(printFailureMessage(skipped));

  const bytes = await mergePdfBuffers(pdfParts);
  if (printable.length && dependencies.recordPrints !== false) {
    await recordLabelPrints(db, printable.map((order) => order.id), input.printedBy);
  }
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
