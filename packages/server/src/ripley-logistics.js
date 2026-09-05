import { RipleySvcClient } from '@zentofact/ripley-api';

let corePromise;
const sandboxStates = new Map();
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? '').trim();
}

function companyField(company, camel, snake) {
  return text(company?.[camel] || company?.[snake]);
}

function svcClientFor(company, fetchImpl) {
  const baseUrl = companyField(company, 'ripleySvcBaseUrl', 'ripley_svc_base_url');
  const username = companyField(company, 'ripleySvcUsername', 'ripley_svc_username');
  const password = company?.ripleySvcPassword || company?.ripley_svc_password;
  if (!baseUrl || !username || !password) {
    throw new Error('La empresa no tiene configuradas las credenciales productivas de Seller Center Ripley.');
  }
  return new RipleySvcClient({
    baseUrl,
    username,
    password,
    fetchImpl,
  });
}

function pageData(value) {
  const root = object(value);
  return object(root.data && typeof root.data === 'object' ? root.data : root);
}

export function mapRipleySvcFulfillmentStatus(value) {
  const status = text(value).toUpperCase();
  if (status === 'TO_PREPARE') return 'preparing';
  if (status === 'TO_PICKUP') return 'ready_to_ship';
  if (status === 'SHIPPED') return 'shipped';
  if (status === 'RECEIVED') return 'delivered';
  if (status === 'RETURN') return 'returned';
  // Un error de etiqueta requiere atención, pero no significa que la venta haya fallado.
  if (status === 'WITH_ERROR') return 'preparing';
  return null;
}

export async function listAllRipleySvcOrders(client) {
  const orders = [];
  for (let page = 1; ; page += 1) {
    const data = pageData(await client.listLogisticsOrders({ page, limit: 200 }));
    const batch = Array.isArray(data.orders) ? data.orders : [];
    orders.push(...batch);
    const total = Number(data.total);
    if (batch.length < 200 || (Number.isFinite(total) && orders.length >= total)) return orders;
  }
}

export async function syncRipleyLogistics(company, dependencies = {}) {
  const core = dependencies.db ? null : await loadCore();
  const db = dependencies.db || core.pool;
  const client = dependencies.client || svcClientFor(company, dependencies.fetchImpl);
  const remoteOrders = await listAllRipleySvcOrders(client);
  let matched = 0;
  for (const remote of remoteOrders) {
    const orderId = text(remote?.order_id);
    if (!orderId) continue;
    const svcStatus = text(remote?._status_management || remote?.status_management);
    const fulfillment = mapRipleySvcFulfillmentStatus(svcStatus);
    const result = await db.query(
      `update orders o set
         fulfillment_status=coalesce($4, o.fulfillment_status),
         shipping=coalesce(o.shipping, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
           'trackingCode', nullif($5, ''),
           'carrier', nullif($6, '')
         )),
         metadata=coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object('ripleySvc', $7::jsonb),
         updated_at=now()
       from order_channel_accounts account
       join order_channels channel on channel.id=account.channel_id
       where o.channel_account_id=account.id
         and o.company_id=$1 and channel.code='ripley'
         and (o.external_order_id=$2 or o.external_order_number=$2 or o.external_order_number=$3)
       returning o.id`,
      [
        company.id,
        orderId,
        text(remote?.commercial_id),
        fulfillment,
        text(remote?.shipping_tracking || remote?.tracking_code),
        text(remote?.courier || remote?.shipping_company),
        JSON.stringify({
          orderId: text(remote?._id),
          statusManagement: svcStatus,
          orderState: text(remote?.order_state),
          packages: Number(remote?.packages_number ?? remote?.packages ?? 0) || null,
          shippingDeadline: text(remote?.shipping_deadline),
          syncedAt: new Date().toISOString(),
        }),
      ],
    );
    matched += result.rowCount || result.rows?.length || 0;
  }
  return { received: remoteOrders.length, matched };
}

function configuredClient(company, dependencies = {}) {
  return dependencies.client || svcClientFor(company, dependencies.fetchImpl);
}

async function companyFor(companyIdInput, dependencies = {}) {
  const companyId = Number(companyIdInput);
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error('Empresa inválida.');
  const core = dependencies.getCompany ? null : await loadCore();
  const company = await (dependencies.getCompany || core.getCompany)(companyId);
  if (!company?.activo) throw new Error('Empresa no encontrada o inactiva.');
  return company;
}

export async function listRipleySvcLabels(companyId, filters = {}, dependencies = {}) {
  const company = await companyFor(companyId, dependencies);
  if (sandboxRequested(filters)) return sandboxLabels(company, filters);
  const client = configuredClient(company, dependencies);
  return client.listLabels(svcFilters(filters));
}

export async function listRipleySvcManifests(companyId, filters = {}, dependencies = {}) {
  const company = await companyFor(companyId, dependencies);
  if (sandboxRequested(filters)) return sandboxManifests(company, filters);
  const client = configuredClient(company, dependencies);
  return client.listManifests(svcFilters(filters));
}

export async function listRipleySvcEligibleLabels(companyId, filters = {}, dependencies = {}) {
  const company = await companyFor(companyId, dependencies);
  if (sandboxRequested(filters)) return sandboxEligibleLabels(company, filters);
  const client = configuredClient(company, dependencies);
  return client.listManifestEligibleLabels(svcFilters(filters));
}

export async function editRipleySvcPackages(companyId, input = {}, dependencies = {}) {
  const company = await companyFor(companyId, dependencies);
  const packages = Number(input.packages);
  if (!Number.isInteger(packages) || packages < 1) throw new Error('La cantidad de bultos debe ser un entero positivo.');
  if (sandboxRequested(input)) {
    const state = sandboxState(company, input);
    state.label.packages = packages;
    return { sandbox: true, environment: 'simulated', accepted: true, status: 202, label: state.label };
  }
  return configuredClient(company, dependencies).editPackages(text(input.svcOrderId), packages);
}

export async function downloadRipleySvcLabels(companyId, input = {}, dependencies = {}) {
  const company = await companyFor(companyId, dependencies);
  const documentIds = stringList(input.documentIds);
  if (!documentIds.length) throw new Error('Selecciona al menos una etiqueta.');
  if (sandboxRequested(input)) {
    const state = sandboxState(company, input);
    const found = documentIds.filter((id) => id === state.label._id);
    return {
      sandbox: true,
      environment: 'simulated',
      labels_generated: sandboxPdf(`Etiquetas ${found.join(', ')}`),
      orders_without_labels: documentIds.filter((id) => !found.includes(id)),
    };
  }
  return configuredClient(company, dependencies).downloadLabels(documentIds);
}

export async function scheduleRipleySvcManifest(companyId, input = {}, dependencies = {}) {
  const company = await companyFor(companyId, dependencies);
  const labelIds = stringList(input.labelIds);
  const pickupDate = isoDate(input.pickupDate, 'La fecha de recojo es inválida.');
  const warehouseAddress = text(input.warehouseAddress);
  if (!labelIds.length) throw new Error('Selecciona al menos una etiqueta elegible.');
  if (!warehouseAddress) throw new Error('Falta la dirección de recojo.');
  if (sandboxRequested(input)) return sandboxScheduleManifest(company, input, labelIds, pickupDate, warehouseAddress);

  const client = configuredClient(company, dependencies);
  const eligible = pageData(await client.listManifestEligibleLabels({ page: 1, limit: 200, orderId: text(input.orderId) || undefined }));
  const labels = (Array.isArray(eligible.labels) ? eligible.labels : [])
    .filter((label) => labelIds.includes(text(label?._id)))
    .map((label) => ({ _id: text(label?._id), order_id: text(label?.order_id), courier: text(label?.courier) }));
  if (labels.length !== labelIds.length) throw new Error('Una o más etiquetas ya no son elegibles para el manifiesto.');
  return client.scheduleManifest(manifestSchedule(labels, pickupDate, warehouseAddress));
}

export async function getRipleySvcManifest(companyId, manifestId, filters = {}, dependencies = {}) {
  const company = await companyFor(companyId, dependencies);
  if (sandboxRequested(filters)) return sandboxManifest(company, manifestId);
  return configuredClient(company, dependencies).getManifest(text(manifestId));
}

export async function downloadRipleySvcManifest(companyId, manifestId, filters = {}, dependencies = {}) {
  const company = await companyFor(companyId, dependencies);
  if (sandboxRequested(filters)) {
    const manifest = sandboxManifest(company, manifestId);
    return { sandbox: true, environment: 'simulated', pdf: sandboxPdf(`Manifiesto ${manifest._id}`) };
  }
  return configuredClient(company, dependencies).downloadManifest(text(manifestId));
}

export async function detachRipleySvcManifestLabels(companyId, manifestId, input = {}, dependencies = {}) {
  const company = await companyFor(companyId, dependencies);
  const labelIds = stringList(input.labelIds);
  if (!labelIds.length) throw new Error('Selecciona al menos una etiqueta para desvincular.');
  if (sandboxRequested(input)) return sandboxDetachLabels(company, manifestId, labelIds);
  return configuredClient(company, dependencies).detachManifestLabels(text(manifestId), labelIds);
}

function sandboxRequested(filters) {
  return filters.sandbox === true || text(filters.sandbox).toLowerCase() === 'true';
}

function sandboxOrderId(filters) {
  return text(filters.orderId || filters.order_id) || 'SANDBOX-100-A';
}

function sandboxIdentity(company, filters) {
  const orderId = sandboxOrderId(filters);
  const safeOrderId = orderId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80);
  return {
    orderId,
    labelId: `sandbox-label-${company.id}-${safeOrderId}`,
    manifestId: `sandbox-manifest-${company.id}-${safeOrderId}`,
  };
}

function newSandboxState(company, filters) {
  const ids = sandboxIdentity(company, filters);
  const label = {
    _id: ids.labelId,
    order_id: ids.orderId,
    active: true,
    hasError: false,
    packages: 1,
    courier: 'RIPLEY_SANDBOX',
    shop_name: text(company.nombre || company.nombreComercial || company.razonSocial) || 'Seller sandbox',
    manifest: null,
    order_data: {
      order_id: ids.orderId,
      currency_iso_code: 'PEN',
      order_lines: [{ product_sku: 'SANDBOX-SKU-1', product_title: 'Producto de prueba', quantity: 1 }],
    },
  };
  return { companyId: company.id, orderId: ids.orderId, label, manifests: [] };
}

function sandboxState(company, filters) {
  const orderId = sandboxOrderId(filters);
  const key = `${company.id}:${orderId}`;
  if (!sandboxStates.has(key)) sandboxStates.set(key, newSandboxState(company, filters));
  return sandboxStates.get(key);
}

function sandboxLabels(company, filters) {
  const state = sandboxState(company, filters);
  return {
    sandbox: true,
    environment: 'simulated',
    total: 1,
    offset: 0,
    limit: 1,
    labels: [state.label],
  };
}

function sandboxEligibleLabels(company, filters) {
  const label = sandboxState(company, filters).label;
  const labels = label.active && !label.hasError && !label.manifest ? [label] : [];
  return {
    sandbox: true,
    environment: 'simulated',
    total: labels.length,
    page: 1,
    limit: 1,
    labels,
  };
}

function sandboxManifests(company, filters) {
  const manifests = sandboxState(company, filters).manifests;
  return {
    sandbox: true,
    environment: 'simulated',
    total: manifests.length,
    offset: 0,
    limit: 1,
    manifests,
  };
}

function sandboxScheduleManifest(company, input, labelIds, pickupDate, warehouseAddress) {
  const state = sandboxState(company, input);
  if (state.label.manifest || !labelIds.includes(state.label._id)) {
    throw new Error('Una o más etiquetas ya no son elegibles para el manifiesto.');
  }
  const manifestId = sandboxIdentity(company, input).manifestId;
  const manifest = {
    _id: manifestId,
    state: 'open',
    shop_name: text(company.nombre || company.nombreComercial || company.razonSocial) || 'Seller sandbox',
    courier: state.label.courier,
    packages: state.label.packages,
    labels: [state.label._id],
    tracking: [`SANDBOX-${company.id}`],
    _labels: [{ _id: state.label._id, order_id: state.orderId, tracking_code: `SANDBOX-${company.id}`, packages: state.label.packages }],
    pickupDate,
    warehouseAddress,
    created_on: new Date().toISOString(),
  };
  state.label.manifest = manifestId;
  state.manifests.push(manifest);
  return { sandbox: true, environment: 'simulated', manifests: [manifest] };
}

function sandboxManifest(company, manifestId) {
  for (const state of sandboxStates.values()) {
    if (state.companyId !== company.id) continue;
    const manifest = state.manifests.find((item) => item._id === text(manifestId));
    if (manifest) return { sandbox: true, environment: 'simulated', ...manifest };
  }
  throw new Error('Manifiesto sandbox no encontrado.');
}

function sandboxDetachLabels(company, manifestId, labelIds) {
  for (const state of sandboxStates.values()) {
    if (state.companyId !== company.id) continue;
    const manifest = state.manifests.find((item) => item._id === text(manifestId));
    if (!manifest) continue;
    manifest.labels = manifest.labels.filter((id) => !labelIds.includes(id));
    manifest._labels = manifest._labels.filter((label) => !labelIds.includes(label._id));
    manifest.packages = manifest._labels.reduce((total, label) => total + Number(label.packages || 0), 0);
    if (labelIds.includes(state.label._id)) state.label.manifest = null;
    return { sandbox: true, environment: 'simulated', manifest };
  }
  throw new Error('Manifiesto sandbox no encontrado.');
}

function manifestSchedule(labels, pickupDate, warehouseAddress) {
  return {
    scheduleableFromToday: { totalLabels: labels.length, labels, pickupDate },
    scheduleableFromTomorrow: { totalLabels: 0, labels: [], pickupDate: nextDate(pickupDate) },
    warehouseAddress,
  };
}

function nextDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isoDate(value, message) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) throw new Error(message);
  return normalized;
}

function stringList(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function sandboxPdf(title) {
  return Buffer.from(`%PDF-1.4\n% ${title}\n%%EOF`, 'utf8').toString('base64');
}

function svcFilters(filters) {
  return {
    page: filters.page == null || filters.page === '' ? undefined : Number(filters.page),
    limit: filters.limit == null || filters.limit === '' ? undefined : Number(filters.limit),
    orderId: text(filters.orderId || filters.order_id) || undefined,
    find: text(filters.find) || undefined,
  };
}
