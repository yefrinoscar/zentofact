import { createHash } from 'node:crypto';
import { stockPhase } from './catalog/stock-phase.js';

export const DOCUMENT_REQUIREMENTS = ['disabled', 'optional', 'required'];
export const DOCUMENT_TYPE_POLICIES = ['automatic', 'boleta', 'factura', 'customer_choice'];
export const ORDER_STATUSES = ['new', 'confirmed', 'completed', 'cancelled', 'failed'];
export const PAYMENT_STATUSES = ['unknown', 'pending', 'paid', 'partially_refunded', 'refunded', 'failed'];
export const FULFILLMENT_STATUSES = [
  'unmapped', 'pending', 'preparing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'returned', 'failed',
];
export const ORDER_ITEMS_STATUSES = ['pending', 'complete', 'error'];
export const DOCUMENT_STATUSES = ['not_requested', 'pending', 'issued', 'accepted', 'rejected', 'cancelled'];
export const MANUAL_SHIPPING_CARRIERS = ['marvisuar', 'shaloom', 'dinsides'];

let corePromise;

function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function positiveInt(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} inválido.`);
  return parsed;
}

function optionalPositiveInt(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return positiveInt(value, field);
}

function requiredText(value, field, max = 200) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} es obligatorio.`);
  return normalized.slice(0, max);
}

function optionalText(value, max = 500) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function enumValue(value, allowed, field, fallback) {
  const normalized = String(value ?? fallback ?? '').trim().toLowerCase();
  if (!allowed.includes(normalized)) throw new Error(`${field} inválido.`);
  return normalized;
}

function channelCode(value) {
  const normalized = requiredText(value, 'channelCode', 50).toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,49}$/.test(normalized)) throw new Error('channelCode inválido.');
  return normalized;
}

function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assertManualEnvioCarrier(shipping, source) {
  if (String(source || '').trim().toLowerCase() !== 'manual') return;
  const type = String(shipping?.type || '').trim().toLowerCase();
  if (type !== 'envio') return;
  const carrier = String(shipping?.carrier || '').trim().toLowerCase();
  if (!MANUAL_SHIPPING_CARRIERS.includes(carrier)) {
    throw new Error('El envío requiere un repartidor: Marvisuar, Shaloom o Dinsides.');
  }
}

function jsonValue(value, fallback = {}) {
  if (value === undefined) return fallback;
  JSON.stringify(value);
  return value;
}

function titleCaseSeller(value) {
  return String(value || '')
    .toLocaleLowerCase('es')
    .replace(/(^|[\s/-])(\S)/g, (_, sep, char) => sep + char.toLocaleUpperCase('es'));
}

function shortSellerName(row) {
  const candidates = [row.nombre_comercial, row.nombre, row.razon_social]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => value
      .replace(/^(?:importaciones|inversiones|tiendas|la tienda del)\s+/i, '')
      .replace(/\s+(?:per[uú]|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|s\.?a\.?c\.?)$/i, '')
      .trim());
  const name = candidates.sort((left, right) => left.length - right.length)[0];
  return name ? titleCaseSeller(name) : `Empresa ${row.company_id}`;
}

function nullableNumber(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} inválido.`);
  return parsed;
}

function nullableDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} inválido.`);
  return parsed.toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function payloadHash(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function normalizeAccountRow(row, { includeCredentialReference = false } = {}) {
  if (!row) return null;
  const normalized = {
    id: Number(row.id),
    companyId: Number(row.company_id),
    channelId: Number(row.channel_id),
    channelCode: row.channel_code,
    channelName: row.channel_name,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    autoCreateOrders: row.auto_create_orders,
    documentRequirement: row.document_requirement,
    documentTypePolicy: row.document_type_policy,
    hasCredentialReference: Boolean(row.credential_reference),
    settings: row.settings || {},
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeCredentialReference) normalized.credentialReference = row.credential_reference || null;
  return normalized;
}

export function resolveDocumentDecision(input = {}) {
  const requirement = enumValue(
    input.documentRequirement,
    DOCUMENT_REQUIREMENTS,
    'documentRequirement',
    'optional',
  );
  const policy = enumValue(
    input.documentTypePolicy,
    DOCUMENT_TYPE_POLICIES,
    'documentTypePolicy',
    'automatic',
  );
  const requested = input.requestedDocumentType == null
    ? null
    : enumValue(input.requestedDocumentType, ['boleta', 'factura'], 'requestedDocumentType');

  if (requirement === 'disabled') {
    return { enabled: false, required: false, type: null, needsCustomerChoice: false };
  }

  let type = null;
  if (policy === 'boleta' || policy === 'factura') type = policy;
  else if (policy === 'automatic') type = requested || 'boleta';
  else type = requested;

  return {
    enabled: true,
    required: requirement === 'required',
    type,
    needsCustomerChoice: policy === 'customer_choice' && !type,
  };
}

export async function listOrderChannels(db) {
  const target = db || (await loadCore()).pool;
  const result = await target.query(
    `select id, code, name, default_auto_create_orders, capabilities, active, created_at, updated_at
     from order_channels order by name, id`,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    defaultAutoCreateOrders: row.default_auto_create_orders,
    capabilities: row.capabilities || {},
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createOrderChannel(input, db) {
  const target = db || (await loadCore()).pool;
  const code = channelCode(input.channelCode || input.code);
  const name = requiredText(input.name, 'name', 120);
  const capabilities = jsonObject(input.capabilities);
  const result = await target.query(
    `insert into order_channels (code, name, default_auto_create_orders, capabilities, active)
     values ($1,$2,$3,$4,$5)
     on conflict (code) do update set
       name=excluded.name,
       default_auto_create_orders=excluded.default_auto_create_orders,
       capabilities=excluded.capabilities,
       active=excluded.active,
       updated_at=now()
     returning id, code, name, default_auto_create_orders, capabilities, active, created_at, updated_at`,
    [code, name, Boolean(input.defaultAutoCreateOrders), JSON.stringify(capabilities), input.active !== false],
  );
  const row = result.rows[0];
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    defaultAutoCreateOrders: row.default_auto_create_orders,
    capabilities: row.capabilities || {},
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function channelByCode(db, code) {
  const result = await db.query(
    `select id, code, name, default_auto_create_orders, active
     from order_channels where code=$1`,
    [channelCode(code)],
  );
  const row = result.rows[0];
  if (!row || row.active === false) throw new Error('Canal no encontrado o inactivo.');
  return row;
}

const ACCOUNT_RETURNING = `
  id, company_id, channel_id, external_account_id, display_name,
  auto_create_orders, document_requirement, document_type_policy,
  credential_reference, settings, active, created_at, updated_at
`;

async function accountWithChannel(db, accountId, options) {
  const result = await db.query(
    `select a.*, ch.code as channel_code, ch.name as channel_name
     from order_channel_accounts a
     join order_channels ch on ch.id=a.channel_id
     where a.id=$1`,
    [positiveInt(accountId, 'channelAccountId')],
  );
  return normalizeAccountRow(result.rows[0], options);
}

export async function ensureOrderChannelAccount(input, db) {
  const target = db || (await loadCore()).pool;
  const companyId = positiveInt(input.companyId, 'companyId');
  const channel = await channelByCode(target, input.channelCode);
  const externalAccountId = requiredText(input.externalAccountId || 'default', 'externalAccountId', 200);
  const displayName = requiredText(input.displayName || channel.name, 'displayName', 200);
  const result = await target.query(
    `insert into order_channel_accounts (
       company_id, channel_id, external_account_id, display_name,
       auto_create_orders, document_requirement, document_type_policy, settings
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (company_id, channel_id, external_account_id) do update set
       display_name=coalesce(nullif(order_channel_accounts.display_name, ''), excluded.display_name),
       updated_at=now()
     returning ${ACCOUNT_RETURNING}`,
    [
      companyId,
      channel.id,
      externalAccountId,
      displayName,
      input.autoCreateOrders ?? channel.default_auto_create_orders,
      enumValue(input.documentRequirement, DOCUMENT_REQUIREMENTS, 'documentRequirement', 'optional'),
      enumValue(input.documentTypePolicy, DOCUMENT_TYPE_POLICIES, 'documentTypePolicy', 'automatic'),
      JSON.stringify(jsonObject(input.settings)),
    ],
  );
  return accountWithChannel(target, result.rows[0].id);
}

export async function configureOrderChannelAccount(input, db) {
  const target = db || (await loadCore()).pool;
  const companyId = positiveInt(input.companyId, 'companyId');
  const channel = await channelByCode(target, input.channelCode);
  const externalAccountId = requiredText(input.externalAccountId || 'default', 'externalAccountId', 200);
  const displayName = requiredText(input.displayName || channel.name, 'displayName', 200);
  const requirement = enumValue(
    input.documentRequirement,
    DOCUMENT_REQUIREMENTS,
    'documentRequirement',
    'optional',
  );
  const typePolicy = enumValue(
    input.documentTypePolicy,
    DOCUMENT_TYPE_POLICIES,
    'documentTypePolicy',
    'automatic',
  );
  const result = await target.query(
    `insert into order_channel_accounts (
       company_id, channel_id, external_account_id, display_name,
       auto_create_orders, document_requirement, document_type_policy,
       credential_reference, settings, active
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (company_id, channel_id, external_account_id) do update set
       display_name=excluded.display_name,
       auto_create_orders=excluded.auto_create_orders,
       document_requirement=excluded.document_requirement,
       document_type_policy=excluded.document_type_policy,
       credential_reference=excluded.credential_reference,
       settings=excluded.settings,
       active=excluded.active,
       updated_at=now()
     returning ${ACCOUNT_RETURNING}`,
    [
      companyId,
      channel.id,
      externalAccountId,
      displayName,
      input.autoCreateOrders ?? channel.default_auto_create_orders,
      requirement,
      typePolicy,
      optionalText(input.credentialReference, 500),
      JSON.stringify(jsonObject(input.settings)),
      input.active !== false,
    ],
  );
  return accountWithChannel(target, result.rows[0].id);
}

export async function updateOrderChannelAccount(accountId, input, db) {
  const target = db || (await loadCore()).pool;
  const current = await accountWithChannel(target, accountId, { includeCredentialReference: true });
  if (!current) throw new Error('Cuenta de canal no encontrada.');
  const result = await target.query(
    `update order_channel_accounts set
       display_name=$2,
       auto_create_orders=$3,
       document_requirement=$4,
       document_type_policy=$5,
       credential_reference=$6,
       settings=$7,
       active=$8,
       updated_at=now()
     where id=$1
     returning ${ACCOUNT_RETURNING}`,
    [
      current.id,
      requiredText(input.displayName ?? current.displayName, 'displayName', 200),
      input.autoCreateOrders ?? current.autoCreateOrders,
      enumValue(
        input.documentRequirement,
        DOCUMENT_REQUIREMENTS,
        'documentRequirement',
        current.documentRequirement,
      ),
      enumValue(
        input.documentTypePolicy,
        DOCUMENT_TYPE_POLICIES,
        'documentTypePolicy',
        current.documentTypePolicy,
      ),
      input.credentialReference === undefined
        ? current.credentialReference
        : optionalText(input.credentialReference, 500),
      JSON.stringify(input.settings === undefined ? current.settings : jsonObject(input.settings)),
      input.active ?? current.active,
    ],
  );
  return accountWithChannel(target, result.rows[0].id);
}

export async function listOrderChannelAccounts(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const values = [];
  const where = [];
  const companyId = optionalPositiveInt(filters.companyId, 'companyId');
  if (companyId) {
    values.push(companyId);
    where.push(`a.company_id=$${values.length}`);
  }
  if (filters.channelCode) {
    values.push(channelCode(filters.channelCode));
    where.push(`ch.code=$${values.length}`);
  }
  if (filters.active !== undefined && filters.active !== '') {
    values.push(String(filters.active).toLowerCase() !== 'false');
    where.push(`a.active=$${values.length}`);
  }
  const result = await target.query(
    `select a.*, ch.code as channel_code, ch.name as channel_name
     from order_channel_accounts a
     join order_channels ch on ch.id=a.channel_id
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by a.company_id, ch.name, a.display_name, a.id`,
    values,
  );
  return result.rows.map(normalizeAccountRow);
}

const TRACKED_ORDER_COLUMNS = {
  external_order_number: 'externalOrderNumber',
  order_status: 'orderStatus',
  payment_status: 'paymentStatus',
  fulfillment_status: 'fulfillmentStatus',
  document_status: 'documentStatus',
  provider_status: 'providerStatus',
  items_status: 'itemsStatus',
  items_error: 'itemsError',
  requested_document_type: 'requestedDocumentType',
  currency: 'currency',
  subtotal: 'subtotal',
  shipping_amount: 'shippingAmount',
  discount_amount: 'discountAmount',
  total: 'total',
  customer: 'customer',
  shipping: 'shipping',
  metadata: 'metadata',
  ordered_at: 'orderedAt',
  promised_shipping_at: 'promisedShippingAt',
  provider_updated_at: 'providerUpdatedAt',
};

function comparable(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return stableJson(value);
  return String(value);
}

function changeSet(previous, current) {
  const before = {};
  const after = {};
  for (const [column, property] of Object.entries(TRACKED_ORDER_COLUMNS)) {
    if (comparable(previous?.[column]) === comparable(current[column])) continue;
    before[property] = previous?.[column] ?? null;
    after[property] = current[column] ?? null;
  }
  return { before, after };
}

function isManualWithoutSeller(input) {
  return String(input.source || '').trim().toLowerCase() === 'manual' && input.companyId == null;
}

function normalizeOrderInput(input, account) {
  const requestedDocumentType = input.requestedDocumentType == null
    ? null
    : enumValue(input.requestedDocumentType, ['boleta', 'factura'], 'requestedDocumentType');
  const decision = resolveDocumentDecision({
    documentRequirement: account.documentRequirement,
    documentTypePolicy: account.documentTypePolicy,
    requestedDocumentType,
  });
  const suppliedDocumentStatus = input.documentStatus == null
    ? null
    : enumValue(input.documentStatus, DOCUMENT_STATUSES, 'documentStatus');
  const documentStatus = account.documentRequirement === 'disabled'
    ? 'not_requested'
    : suppliedDocumentStatus || (decision.required || requestedDocumentType ? 'pending' : 'not_requested');

  return {
    companyId: isManualWithoutSeller(input) ? null : positiveInt(input.companyId ?? account.companyId, 'companyId'),
    channelAccountId: account.id,
    externalOrderId: requiredText(input.externalOrderId, 'externalOrderId', 300),
    externalOrderNumber: requiredText(
      input.externalOrderNumber || input.externalOrderId,
      'externalOrderNumber',
      300,
    ),
    orderStatus: enumValue(input.orderStatus, ORDER_STATUSES, 'orderStatus', 'new'),
    paymentStatus: enumValue(input.paymentStatus, PAYMENT_STATUSES, 'paymentStatus', 'unknown'),
    fulfillmentStatus: enumValue(
      input.fulfillmentStatus,
      FULFILLMENT_STATUSES,
      'fulfillmentStatus',
      'pending',
    ),
    documentStatus,
    providerStatus: optionalText(input.providerStatus, 300),
    itemsStatus: input.itemsComplete === true
      ? 'complete'
      : input.itemsError
        ? 'error'
        : 'pending',
    itemsError: optionalText(input.itemsError, 2000),
    requestedDocumentType: account.documentRequirement === 'disabled' ? null : requestedDocumentType,
    currency: requiredText(input.currency || 'PEN', 'currency', 10).toUpperCase(),
    subtotal: nullableNumber(input.subtotal, 'subtotal'),
    shippingAmount: nullableNumber(input.shippingAmount, 'shippingAmount'),
    discountAmount: nullableNumber(input.discountAmount, 'discountAmount'),
    total: nullableNumber(input.total, 'total'),
    customer: jsonObject(input.customer),
    shipping: jsonObject(input.shipping),
    metadata: jsonObject(input.metadata),
    orderedAt: nullableDate(input.orderedAt, 'orderedAt'),
    promisedShippingAt: nullableDate(input.promisedShippingAt, 'promisedShippingAt'),
    providerUpdatedAt: nullableDate(input.providerUpdatedAt, 'providerUpdatedAt'),
  };
}

function normalizeItem(item, index) {
  const rawProductId = item?.productId ?? item?.metadata?.productId;
  const productIdNumber = Number(rawProductId);
  return {
    externalItemId: requiredText(
      item?.externalItemId || item?.id || `line-${index + 1}`,
      'externalItemId',
      300,
    ),
    sku: optionalText(item?.sku, 300),
    providerSku: optionalText(item?.providerSku, 300),
    description: String(item?.description || '').trim().slice(0, 2000),
    quantity: nullableNumber(item?.quantity ?? 1, 'quantity'),
    unitPrice: nullableNumber(item?.unitPrice, 'unitPrice'),
    discountAmount: nullableNumber(item?.discountAmount, 'discountAmount'),
    taxAmount: nullableNumber(item?.taxAmount, 'taxAmount'),
    total: nullableNumber(item?.total, 'total'),
    providerStatus: optionalText(item?.providerStatus, 300),
    metadata: jsonObject(item?.metadata),
    rawData: jsonValue(item?.rawData, {}),
    productId: Number.isInteger(productIdNumber) && productIdNumber > 0 ? productIdNumber : null,
  };
}

function normalizeOrderRow(row) {
  if (!row) return null;
  const normalized = {
    id: Number(row.id),
    companyId: row.company_id == null ? null : Number(row.company_id),
    channelAccountId: Number(row.channel_account_id),
    channelCode: row.channel_code,
    channelName: row.channel_name,
    channelAccountName: row.channel_account_name,
    externalOrderId: row.external_order_id,
    externalOrderNumber: row.external_order_number,
    orderStatus: row.order_status,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    documentStatus: row.document_status,
    providerStatus: row.provider_status,
    itemsStatus: row.items_status || 'pending',
    itemsError: row.items_error || null,
    documentRequirement: row.document_requirement,
    documentTypePolicy: row.document_type_policy,
    requestedDocumentType: row.requested_document_type,
    currency: row.currency,
    subtotal: row.subtotal == null ? null : Number(row.subtotal),
    shippingAmount: row.shipping_amount == null ? null : Number(row.shipping_amount),
    discountAmount: row.discount_amount == null ? null : Number(row.discount_amount),
    total: row.total == null ? null : Number(row.total),
    customer: row.customer || {},
    shipping: row.shipping || {},
    metadata: row.metadata || {},
    orderedAt: row.ordered_at,
    promisedShippingAt: row.promised_shipping_at,
    providerUpdatedAt: row.provider_updated_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || null,
  };
  normalized.documentDecision = resolveDocumentDecision(normalized);
  return normalized;
}

async function ingestOrderInTransaction(input, db) {
  const account = await accountWithChannel(db, input.channelAccountId);
  if (!account || account.active === false) throw new Error('Cuenta de canal no encontrada o inactiva.');
  if (input.companyId != null && Number(input.companyId) !== account.companyId) {
    throw new Error('La cuenta de canal no pertenece a la empresa indicada.');
  }
  if (input.automatic === true && !account.autoCreateOrders) {
    return { skipped: true, reason: 'auto_create_disabled', channelAccountId: account.id };
  }

  const externalOrderId = requiredText(input.externalOrderId, 'externalOrderId', 300);
  const existingResult = await db.query(
    `select * from orders
     where channel_account_id=$1 and external_order_id=$2
     for update`,
    [account.id, externalOrderId],
  );
  const existing = existingResult.rows[0] || null;
  const policyAccount = existing ? {
    ...account,
    documentRequirement: existing.document_requirement,
    documentTypePolicy: existing.document_type_policy,
  } : account;
  const order = normalizeOrderInput({
    ...input,
    externalOrderId,
    requestedDocumentType: input.requestedDocumentType ?? existing?.requested_document_type,
  }, policyAccount);
  assertManualEnvioCarrier(order.shipping, input.source);
  const requestKey = optionalText(input.eventId || input.idempotencyKey, 500);
  if (existing && requestKey) {
    const replay = await db.query(
      'select 1 from order_events where order_id=$1 and idempotency_key=$2 limit 1',
      [existing.id, requestKey],
    );
    if (replay.rows.length) {
      return {
        order: normalizeOrderRow({
          ...existing,
          channel_code: account.channelCode,
          channel_name: account.channelName,
          channel_account_name: account.displayName,
        }),
        created: false,
        changed: false,
        stale: false,
        snapshotInserted: false,
        replayed: true,
      };
    }
  }
  const isStale = Boolean(
    existing?.provider_updated_at
      && order.providerUpdatedAt
      && new Date(order.providerUpdatedAt).getTime() < new Date(existing.provider_updated_at).getTime(),
  );
  const rawPayload = input.rawPayload === undefined ? null : jsonValue(input.rawPayload);
  const snapshotHash = rawPayload === null ? null : payloadHash(rawPayload);

  let persisted;
  if (isStale) {
    persisted = existing;
  } else {
    const result = await db.query(
      `insert into orders (
         company_id, channel_account_id, external_order_id, external_order_number,
         order_status, payment_status, fulfillment_status, document_status, provider_status,
         document_requirement, document_type_policy, requested_document_type,
         currency, subtotal, shipping_amount, discount_amount, total,
         customer, shipping, metadata, ordered_at, promised_shipping_at, provider_updated_at,
         items_status, items_error, created_by
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
       )
       on conflict (channel_account_id, external_order_id) do update set
         external_order_number=excluded.external_order_number,
         order_status=excluded.order_status,
         payment_status=excluded.payment_status,
         fulfillment_status=excluded.fulfillment_status,
         document_status=case
           when orders.document_status in ('issued','accepted','rejected','cancelled')
             then orders.document_status
           else excluded.document_status
         end,
         provider_status=excluded.provider_status,
         items_status=case
           when excluded.items_status='complete' then 'complete'
           when orders.items_status='complete' then 'complete'
           else excluded.items_status
         end,
         items_error=case
           when excluded.items_status='complete' or orders.items_status='complete' then null
           else excluded.items_error
         end,
         requested_document_type=coalesce(excluded.requested_document_type, orders.requested_document_type),
         currency=excluded.currency,
         subtotal=coalesce(excluded.subtotal, orders.subtotal),
         shipping_amount=coalesce(excluded.shipping_amount, orders.shipping_amount),
         discount_amount=coalesce(excluded.discount_amount, orders.discount_amount),
         total=coalesce(excluded.total, orders.total),
         customer=orders.customer || excluded.customer,
         shipping=orders.shipping || excluded.shipping,
         metadata=orders.metadata || excluded.metadata,
         ordered_at=coalesce(excluded.ordered_at, orders.ordered_at),
         promised_shipping_at=coalesce(excluded.promised_shipping_at, orders.promised_shipping_at),
         provider_updated_at=coalesce(excluded.provider_updated_at, orders.provider_updated_at),
         created_by=coalesce(orders.created_by, excluded.created_by),
         last_seen_at=now(),
         updated_at=now()
       returning *`,
      [
        order.companyId,
        order.channelAccountId,
        order.externalOrderId,
        order.externalOrderNumber,
        order.orderStatus,
        order.paymentStatus,
        order.fulfillmentStatus,
        order.documentStatus,
        order.providerStatus,
        account.documentRequirement,
        account.documentTypePolicy,
        order.requestedDocumentType,
        order.currency,
        order.subtotal,
        order.shippingAmount,
        order.discountAmount,
        order.total,
        JSON.stringify(order.customer),
        JSON.stringify(order.shipping),
        JSON.stringify(order.metadata),
        order.orderedAt,
        order.promisedShippingAt,
        order.providerUpdatedAt,
        order.itemsStatus,
        order.itemsError,
        optionalText(input.actorUserId, 300),
      ],
    );
    persisted = result.rows[0];
  }
  if (!persisted) throw new Error('No se pudo guardar el pedido.');

  let snapshotInserted = false;
  if (rawPayload !== null) {
    const snapshot = await db.query(
      `insert into order_snapshots (
         order_id, payload_hash, raw_payload, provider_updated_at, correlation_id
       ) values ($1,$2,$3,$4,$5)
       on conflict (order_id, payload_hash) do nothing
       returning id`,
      [
        persisted.id,
        snapshotHash,
        JSON.stringify(rawPayload),
        order.providerUpdatedAt,
        optionalText(input.correlationId, 500),
      ],
    );
    snapshotInserted = snapshot.rows.length > 0;
  }

  if (!isStale) {
    const items = Array.isArray(input.items) ? input.items.map(normalizeItem) : [];
    const seenIds = [];
    const upsertedItems = [];
    for (const item of items) {
      seenIds.push(item.externalItemId);
      const itemResult = await db.query(
        `insert into order_items (
           order_id, external_item_id, sku, provider_sku, description, quantity,
           unit_price, discount_amount, tax_amount, total, provider_status, metadata, raw_data,
           product_id
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (order_id, external_item_id) do update set
           sku=excluded.sku,
           provider_sku=excluded.provider_sku,
           description=excluded.description,
           quantity=excluded.quantity,
           unit_price=excluded.unit_price,
           discount_amount=excluded.discount_amount,
           tax_amount=excluded.tax_amount,
           total=excluded.total,
           provider_status=excluded.provider_status,
           metadata=order_items.metadata || excluded.metadata,
           raw_data=excluded.raw_data,
           product_id=coalesce(excluded.product_id, order_items.product_id),
           updated_at=now()
         returning id, external_item_id, sku, provider_sku, quantity, provider_status,
           product_id, listing_id, main_sku, stock_state,
           stock_applied_quantity, stock_revision`,
        [
          persisted.id,
          item.externalItemId,
          item.sku,
          item.providerSku,
          item.description,
          item.quantity,
          item.unitPrice,
          item.discountAmount,
          item.taxAmount,
          item.total,
          item.providerStatus,
          JSON.stringify(item.metadata),
          JSON.stringify(item.rawData),
          item.productId,
        ],
      );
      if (itemResult.rows[0]) upsertedItems.push(itemResult.rows[0]);
    }
    let doomedItems = [];
    if (input.itemsComplete === true) {
      if (seenIds.length) {
        doomedItems = (await db.query(
          `select id, external_item_id, sku, provider_sku, quantity, product_id, listing_id,
             main_sku, stock_state, stock_applied_quantity, stock_revision
           from order_items
           where order_id=$1 and not (external_item_id = any($2::text[]))
           for update`,
          [persisted.id, seenIds],
        )).rows;
      } else {
        doomedItems = (await db.query(
          `select id, external_item_id, sku, provider_sku, quantity, product_id, listing_id,
             main_sku, stock_state, stock_applied_quantity, stock_revision
           from order_items where order_id=$1 for update`,
          [persisted.id],
        )).rows;
      }
    }
    await stockPhase({
      db,
      existing,
      persisted,
      account,
      upsertedItems,
      doomedItems,
      source: enumValue(input.source, ['provider', 'webhook', 'sync', 'user', 'system', 'api', 'file', 'manual'], 'source', 'api'),
      actorUserId: optionalText(input.actorUserId, 300),
      enabled: input.catalogInventoryEnabled,
      allowNegative: input.catalogAllowNegative,
    });
    if (input.itemsComplete === true && doomedItems.length) {
      await db.query('delete from order_items where id = any($1::bigint[])', [doomedItems.map((item) => item.id)]);
    }
  }

  const changes = changeSet(existing, persisted);
  const hasChanges = !existing || Object.keys(changes.after).length > 0;
  if (hasChanges || isStale) {
    const eventType = isStale ? 'order.stale_observed' : existing ? 'order.updated' : 'order.created';
    const eventKey = requestKey
      || `${eventType}:${snapshotHash || payloadHash(changes.after)}`;
    await db.query(
      `insert into order_events (
         order_id, event_type, source, actor_user_id, idempotency_key, correlation_id,
         previous_values, new_values, payload, provider_occurred_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (order_id, idempotency_key) do nothing`,
      [
        persisted.id,
        eventType,
        enumValue(input.source, ['provider', 'webhook', 'sync', 'user', 'system', 'api', 'file', 'manual'], 'source', 'api'),
        optionalText(input.actorUserId, 300),
        eventKey,
        optionalText(input.correlationId, 500),
        JSON.stringify(changes.before),
        JSON.stringify(changes.after),
        JSON.stringify(jsonObject(input.eventPayload)),
        nullableDate(input.providerOccurredAt || order.providerUpdatedAt, 'providerOccurredAt'),
      ],
    );
  }

  return {
    order: normalizeOrderRow({
      ...persisted,
      channel_code: account.channelCode,
      channel_name: account.channelName,
      channel_account_name: account.displayName,
    }),
    created: !existing,
    changed: hasChanges,
    stale: isStale,
    snapshotInserted,
  };
}

export async function ingestOrder(input, db) {
  if (db) return ingestOrderInTransaction(input, db);
  const { pool } = await loadCore();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await ingestOrderInTransaction(input, client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listOrders(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const values = [];
  const where = [];
  const companyId = optionalPositiveInt(filters.companyId, 'companyId');
  const channelAccountId = optionalPositiveInt(filters.channelAccountId, 'channelAccountId');
  const connectedOnly = filters.connectedOnly === true
    || String(filters.connectedOnly || '').toLowerCase() === 'true';
  if (connectedOnly) {
    where.push('c.activo=true');
    where.push('a.active=true');
    where.push(`case ch.code
      when 'falabella' then nullif(trim(c.falabella_api_user_id), '') is not null
        and nullif(trim(c.falabella_api_key), '') is not null
      when 'ripley' then nullif(trim(c.ripley_api_key), '') is not null
      else true end`);
  }
  if (companyId) {
    values.push(companyId);
    where.push(`o.company_id=$${values.length}`);
  }
  if (channelAccountId) {
    values.push(channelAccountId);
    where.push(`o.channel_account_id=$${values.length}`);
  }
  if (filters.channelCode) {
    values.push(channelCode(filters.channelCode));
    where.push(`ch.code=$${values.length}`);
  }
  if (filters.orderStatus) {
    values.push(enumValue(filters.orderStatus, ORDER_STATUSES, 'orderStatus'));
    where.push(`o.order_status=$${values.length}`);
  }
  if (filters.fulfillmentStatus) {
    values.push(enumValue(filters.fulfillmentStatus, FULFILLMENT_STATUSES, 'fulfillmentStatus'));
    where.push(`o.fulfillment_status=$${values.length}`);
  }
  if (filters.documentStatus) {
    values.push(enumValue(filters.documentStatus, DOCUMENT_STATUSES, 'documentStatus'));
    where.push(`o.document_status=$${values.length}`);
  }
  if (filters.search) {
    values.push(String(filters.search).trim().slice(0, 120));
    where.push(`(
      o.external_order_id ilike '%' || $${values.length} || '%'
      or o.external_order_number ilike '%' || $${values.length} || '%'
      or coalesce(o.customer->>'name', '') ilike '%' || $${values.length} || '%'
      or coalesce(o.customer->>'documentNumber', '') ilike '%' || $${values.length} || '%'
    )`);
  }
  if (filters.createdBy) {
    values.push(requiredText(filters.createdBy, 'createdBy', 300));
    where.push(`o.created_by=$${values.length}`);
  }
  if (filters.salesOnly === true || String(filters.salesOnly || '').toLowerCase() === 'true') {
    where.push(`o.order_status not in ('cancelled', 'failed')`);
    where.push(`o.payment_status not in ('refunded', 'failed')`);
    where.push(`o.fulfillment_status not in ('cancelled', 'returned', 'failed')`);
  }
  for (const [filterName, operator] of [['from', '>='], ['to', '<=']]) {
    const value = String(filters[filterName] || '').trim();
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${filterName} inválido.`);
    values.push(value);
    where.push(`(coalesce(o.ordered_at, o.created_at) at time zone 'America/Lima')::date ${operator} $${values.length}::date`);
  }
  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 500);
  const offset = Math.max(Number(filters.offset || 0), 0);
  values.push(limit, offset);
  const result = await target.query(
    `select o.*, ch.code as channel_code, ch.name as channel_name,
       a.display_name as channel_account_name,
       count(*) over()::int as total_count
     from orders o
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     left join companies c on c.id=o.company_id
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by o.ordered_at desc nulls last, o.id desc
     limit $${values.length - 1} offset $${values.length}`,
    values,
  );
  return {
    orders: result.rows.map(normalizeOrderRow),
    totalCount: Number(result.rows[0]?.total_count || 0),
    limit,
    offset,
  };
}

export async function getSalesPulse(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const date = String(filters.date || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date inválida.');

  const [sellerResult, productResult, channelResult] = await Promise.all([
    target.query(
    `select c.id as company_id, c.nombre_comercial, c.nombre, c.razon_social,
       count(o.id)::int as orders_count,
       coalesce(sum(o.total), 0)::numeric as sales_total,
       count(o.id) filter (where o.channel_account_id in (
         select a.id from order_channel_accounts a
         join order_channels ch on ch.id=a.channel_id
         where ch.code='manual'
       ))::int as manual_orders_count,
       max(coalesce(o.ordered_at, o.created_at)) as last_sale_at
     from companies c
     left join orders o on o.company_id=c.id
       and o.order_status not in ('cancelled', 'failed')
       and o.payment_status not in ('refunded', 'failed')
       and o.fulfillment_status not in ('cancelled', 'returned', 'failed')
       and (coalesce(o.ordered_at, o.created_at) at time zone 'America/Lima')::date
         = coalesce(nullif($1, '')::date, (now() at time zone 'America/Lima')::date)
     where c.activo is true
     group by c.id, c.nombre_comercial, c.nombre, c.razon_social
     order by count(o.id) desc, coalesce(sum(o.total), 0) desc, c.nombre`,
    [date],
    ),
    target.query(
      `select coalesce(nullif(oi.main_sku, ''), nullif(oi.sku, ''), nullif(oi.provider_sku, ''), 'Sin SKU') as sku,
         coalesce(nullif(p.name, ''), nullif(oi.description, ''), 'Producto sin nombre') as product_name,
         min(coalesce(
           nullif(p.image_url, ''),
           nullif(psku.image_url, ''),
           nullif(listing.metadata->'images'->>0, ''),
           nullif(listing.metadata->'images'->0->>'Url', ''),
           nullif(listing.metadata->'images'->0->>'url', ''),
           nullif(listing.metadata->>'imageUrl', ''),
           nullif(oi.raw_data->>'Image', ''),
           nullif(oi.raw_data->>'ImageUrl', ''),
           nullif(oi.raw_data->>'ImageURL', ''),
           nullif(oi.raw_data->>'ProductImage', ''),
           nullif(oi.raw_data->>'MainImage', '')
         )) as image_url,
         min(coalesce(
           nullif(trim(listing.shop_sku), ''),
           nullif(trim(oi.provider_sku), ''),
           nullif(trim(oi.raw_data->>'ShopSku'), ''),
           nullif(trim(oi.raw_data->>'ShopSKU'), '')
         )) as shop_sku,
         sum(coalesce(oi.quantity, 0))::numeric as units_sold,
         sum(sum(coalesce(oi.quantity, 0))) over()::numeric as total_units_sold,
         count(distinct o.id)::int as orders_count,
         coalesce(sum(coalesce(oi.total, oi.unit_price * oi.quantity, 0)), 0)::numeric as sales_total,
         count(distinct o.company_id)::int as sellers_count,
         array_agg(distinct ch.code order by ch.code) as channel_codes
       from orders o
       join order_items oi on oi.order_id=o.id
       join order_channel_accounts a on a.id=o.channel_account_id
       join order_channels ch on ch.id=a.channel_id
       left join products p on p.id=oi.product_id
       left join products psku
         on psku.main_sku = coalesce(nullif(oi.main_sku, ''), nullif(oi.sku, ''))
       left join product_listings listing on listing.id = oi.listing_id
       where o.order_status not in ('cancelled', 'failed')
         and o.payment_status not in ('refunded', 'failed')
         and o.fulfillment_status not in ('cancelled', 'returned', 'failed')
         and (coalesce(o.ordered_at, o.created_at) at time zone 'America/Lima')::date
           = coalesce(nullif($1, '')::date, (now() at time zone 'America/Lima')::date)
       group by 1, 2
       order by units_sold desc, sales_total desc, product_name
       limit 80`,
      [date],
    ),
    target.query(
      `select ch.code, ch.name,
         count(o.id)::int as orders_count,
         coalesce(sum(o.total), 0)::numeric as sales_total
       from orders o
       join order_channel_accounts a on a.id=o.channel_account_id
       join order_channels ch on ch.id=a.channel_id
       where o.order_status not in ('cancelled', 'failed')
         and o.payment_status not in ('refunded', 'failed')
         and o.fulfillment_status not in ('cancelled', 'returned', 'failed')
         and (coalesce(o.ordered_at, o.created_at) at time zone 'America/Lima')::date
           = coalesce(nullif($1, '')::date, (now() at time zone 'America/Lima')::date)
       group by ch.code, ch.name
       order by orders_count desc, sales_total desc`,
      [date],
    ),
  ]);

  const sellers = sellerResult.rows.map((row) => ({
    companyId: Number(row.company_id),
    companyName: shortSellerName(row),
    ordersCount: Number(row.orders_count || 0),
    salesTotal: Number(row.sales_total || 0),
    manualOrdersCount: Number(row.manual_orders_count || 0),
    lastSaleAt: row.last_sale_at || null,
  }));
  const sellersWithSales = sellers.filter((seller) => seller.ordersCount > 0).length;
  const topProducts = productResult.rows.map((row) => ({
    sku: row.sku,
    name: row.product_name,
    imageUrl: row.image_url || null,
    shopSku: row.shop_sku || null,
    unitsSold: Number(row.units_sold || 0),
    ordersCount: Number(row.orders_count || 0),
    salesTotal: Number(row.sales_total || 0),
    sellersCount: Number(row.sellers_count || 0),
    channelCodes: Array.isArray(row.channel_codes) ? row.channel_codes : [],
  }));
  const channels = channelResult.rows.map((row) => ({
    code: row.code,
    name: row.name,
    ordersCount: Number(row.orders_count || 0),
    salesTotal: Number(row.sales_total || 0),
  }));

  return {
    date: date || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()),
    ordersCount: sellers.reduce((sum, seller) => sum + seller.ordersCount, 0),
    salesTotal: sellers.reduce((sum, seller) => sum + seller.salesTotal, 0),
    unitsSold: Number(productResult.rows[0]?.total_units_sold || 0),
    sellersWithSales,
    sellersWithoutSales: sellers.length - sellersWithSales,
    sellers,
    topProducts,
    channels,
  };
}

const SALES_EXCLUSIONS = `
  o.order_status not in ('cancelled', 'failed')
  and o.payment_status not in ('refunded', 'failed')
  and o.fulfillment_status not in ('cancelled', 'returned', 'failed')
`;

function limaDateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(value);
}

function addCalendarDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function periodStats(orders, total, commissionPercent) {
  const salesTotal = Number(total) || 0;
  return {
    orders: Number(orders) || 0,
    total: salesTotal,
    commission: estimatedCommission(salesTotal, commissionPercent),
  };
}

export function estimatedCommission(total, percent) {
  const amount = Number(total) || 0;
  const rate = Number(percent) || 0;
  if (amount <= 0 || rate <= 0) return 0;
  return Math.round(amount * rate) / 100;
}

export async function getSalespersonHome(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const userId = requiredText(filters.userId, 'userId', 300);
  const commissionPercent = Number(filters.commissionPercent) || 0;
  const today = limaDateKey();
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = String(filters.from || '').trim() || addCalendarDays(today, -29);
  const to = String(filters.to || '').trim() || today;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('from inválido.');
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('to inválido.');

  const kpi = await target.query(
    `select
       count(*) filter (where d.lima_date = $2::date)::int as today_orders,
       coalesce(sum(o.total) filter (where d.lima_date = $2::date), 0)::numeric as today_total,
       count(*) filter (where d.lima_date >= $3::date)::int as month_orders,
       coalesce(sum(o.total) filter (where d.lima_date >= $3::date), 0)::numeric as month_total
     from orders o
     cross join lateral (
       select (coalesce(o.ordered_at, o.created_at) at time zone 'America/Lima')::date as lima_date
     ) d
     where o.created_by=$1
       and ${SALES_EXCLUSIONS}`,
    [userId, today, monthStart],
  );
  const listed = await listOrders({
    createdBy: userId,
    from,
    to,
    limit: filters.limit || 50,
    salesOnly: true,
  }, target);
  const row = kpi.rows[0] || {};
  return {
    today: periodStats(row.today_orders, row.today_total, commissionPercent),
    month: periodStats(row.month_orders, row.month_total, commissionPercent),
    orders: listed.orders,
    commissionPercent,
  };
}

export async function getOrder(orderId, db) {
  const target = db || (await loadCore()).pool;
  const id = positiveInt(orderId, 'orderId');
  const [orderResult, itemsResult, eventsResult, documentsResult, snapshotsResult] = await Promise.all([
    target.query(
      `select o.*, ch.code as channel_code, ch.name as channel_name,
         a.display_name as channel_account_name
       from orders o
       join order_channel_accounts a on a.id=o.channel_account_id
       join order_channels ch on ch.id=a.channel_id
       where o.id=$1`,
      [id],
    ),
    target.query(
      `select id, external_item_id, sku, provider_sku, description, quantity,
         unit_price, discount_amount, tax_amount, total, provider_status, metadata, raw_data,
         product_id, listing_id, main_sku, stock_state, stock_applied_quantity, stock_revision,
         created_at, updated_at
       from order_items where order_id=$1 order by id`,
      [id],
    ),
    target.query(
      `select id, event_type, source, actor_user_id, idempotency_key, correlation_id,
         previous_values, new_values, payload, provider_occurred_at, received_at, created_at
       from order_events where order_id=$1 order by created_at, id`,
      [id],
    ),
    target.query(
      `select od.id, od.document_kind, od.boleta_id, od.factura_id, od.credit_note_id,
         coalesce(b.numero_completo, f.numero_completo, cn.numero_completo) as document_number,
         coalesce(b.estado_sunat, f.estado_sunat, cn.estado_sunat) as document_status,
         od.created_at
       from order_documents od
       left join boletas b on b.id=od.boleta_id
       left join facturas f on f.id=od.factura_id
       left join credit_notes cn on cn.id=od.credit_note_id
       where od.order_id=$1 order by od.created_at, od.id`,
      [id],
    ),
    target.query(
      `select id, payload_hash, raw_payload, provider_updated_at, correlation_id, observed_at
       from order_snapshots where order_id=$1 order by observed_at desc, id desc`,
      [id],
    ),
  ]);
  const order = normalizeOrderRow(orderResult.rows[0]);
  if (!order) return null;
  return {
    ...order,
    items: itemsResult.rows.map((row) => ({
      id: Number(row.id),
      externalItemId: row.external_item_id,
      sku: row.sku,
      providerSku: row.provider_sku,
      description: row.description,
      quantity: Number(row.quantity),
      unitPrice: row.unit_price == null ? null : Number(row.unit_price),
      discountAmount: row.discount_amount == null ? null : Number(row.discount_amount),
      taxAmount: row.tax_amount == null ? null : Number(row.tax_amount),
      total: row.total == null ? null : Number(row.total),
      providerStatus: row.provider_status,
      productId: row.product_id == null ? null : Number(row.product_id),
      listingId: row.listing_id == null ? null : Number(row.listing_id),
      mainSku: row.main_sku,
      stockState: row.stock_state,
      stockAppliedQuantity: Number(row.stock_applied_quantity || 0),
      stockRevision: Number(row.stock_revision || 0),
      metadata: row.metadata || {},
      rawData: row.raw_data || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    events: eventsResult.rows.map((row) => ({
      id: Number(row.id),
      eventType: row.event_type,
      source: row.source,
      actorUserId: row.actor_user_id,
      idempotencyKey: row.idempotency_key,
      correlationId: row.correlation_id,
      previousValues: row.previous_values || {},
      newValues: row.new_values || {},
      payload: row.payload || {},
      providerOccurredAt: row.provider_occurred_at,
      receivedAt: row.received_at,
      createdAt: row.created_at,
    })),
    documents: documentsResult.rows.map((row) => ({
      id: Number(row.id),
      kind: row.document_kind,
      boletaId: row.boleta_id,
      facturaId: row.factura_id,
      creditNoteId: row.credit_note_id,
      number: row.document_number,
      status: row.document_status,
      createdAt: row.created_at,
    })),
    snapshots: snapshotsResult.rows.map((row) => ({
      id: Number(row.id),
      payloadHash: row.payload_hash,
      rawPayload: row.raw_payload || {},
      providerUpdatedAt: row.provider_updated_at,
      correlationId: row.correlation_id,
      observedAt: row.observed_at,
    })),
  };
}

const RECORDABLE_PAYMENT_METHODS = ['efectivo', 'yape_plin', 'transferencia'];

export async function updateOrderPayment(orderId, input = {}, db) {
  const target = db || (await loadCore()).pool;
  const id = positiveInt(orderId, 'orderId');
  const paymentStatus = enumValue(input.paymentStatus, PAYMENT_STATUSES, 'paymentStatus', 'paid');
  const paymentMethod = requiredText(input.paymentMethod, 'paymentMethod', 50).toLowerCase();
  if (!RECORDABLE_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error('paymentMethod inválido.');
  }
  const receivedBy = optionalText(input.receivedBy, 200);
  const paymentProof = input.paymentProof && typeof input.paymentProof === 'object'
    ? input.paymentProof
    : null;

  const current = await target.query(
    `select o.*, ch.code as channel_code, ch.name as channel_name,
       a.display_name as channel_account_name
     from orders o
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     where o.id=$1`,
    [id],
  );
  const existing = current.rows[0];
  if (!existing) return null;

  const patch = {
    paymentMethod,
    paidAt: new Date().toISOString(),
  };
  if (receivedBy) patch.receivedBy = receivedBy;
  if (paymentProof) patch.paymentProof = paymentProof;

  const updated = await target.query(
    `update orders
     set payment_status=$2,
         metadata=coalesce(metadata, '{}'::jsonb) || $3::jsonb,
         updated_at=now()
     where id=$1
     returning *`,
    [id, paymentStatus, JSON.stringify(patch)],
  );
  const persisted = updated.rows[0];
  if (!persisted) return null;

  await target.query(
    `insert into order_events (
       order_id, event_type, source, actor_user_id, idempotency_key,
       previous_values, new_values, payload
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      'order.payment_recorded',
      'user',
      optionalText(input.actorUserId, 300),
      `order.payment_recorded:${id}:${persisted.updated_at}`,
      JSON.stringify({ paymentStatus: existing.payment_status }),
      JSON.stringify({ paymentStatus, paymentMethod }),
      JSON.stringify({ paymentMethod, receivedBy: receivedBy || null }),
    ],
  );

  return normalizeOrderRow({
    ...persisted,
    channel_code: existing.channel_code,
    channel_name: existing.channel_name,
    channel_account_name: existing.channel_account_name,
  });
}
