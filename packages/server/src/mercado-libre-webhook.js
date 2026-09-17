import { mercadoLibreClientForCompany, mercadoLibreGrantFromCompany } from './mercado-libre-tokens.js';
import { ingestMercadoLibreOrder } from './order-adapters/mercadolibre.js';

function text(value) {
  return String(value ?? '').trim();
}

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function parseMercadoLibreResource(resource) {
  const value = text(resource);
  const order = /(?:^|\/)orders\/([^/?#]+)/i.exec(value);
  if (order) return { kind: 'order', id: order[1] };
  const shipment = /(?:^|\/)shipments\/([^/?#]+)/i.exec(value);
  if (shipment) return { kind: 'shipment', id: shipment[1] };
  return null;
}

export function shipmentOrderIds(shipment) {
  const raw = objectRecord(shipment?.raw) || objectRecord(shipment) || {};
  const ids = [];
  const push = (value) => {
    const id = text(value);
    if (id) ids.push(id);
  };
  push(raw.order_id);
  if (Array.isArray(raw.orders)) {
    for (const entry of raw.orders) {
      push(entry?.id || entry);
    }
  }
  return [...new Set(ids)];
}

async function loadCore() {
  return import('@zentofact/core');
}

export async function findCompanyByMercadoLibreUserId(userId, db) {
  const id = text(userId);
  if (!id) return null;
  const target = db || (await loadCore()).pool;
  const result = await target.query(
    `select * from companies
     where activo is not false and nullif(trim(mercado_libre_user_id), '') = $1
     limit 2`,
    [id],
  );
  if (result.rows.length !== 1) return null;
  const row = result.rows[0];
  return {
    id: Number(row.id),
    nombre: row.nombre,
    nombreComercial: row.nombre_comercial,
    razonSocial: row.razon_social,
    mercadoLibreUserId: row.mercado_libre_user_id,
    mercadoLibreSiteId: row.mercado_libre_site_id,
    mercadoLibreAccessToken: row.mercado_libre_access_token,
    mercadoLibreRefreshToken: row.mercado_libre_refresh_token,
    mercadoLibreTokenExpiresAt: row.mercado_libre_token_expires_at,
  };
}

export async function enrichMercadoLibreOrder(client, listed) {
  const order = listed?.orderId && listed?.raw ? listed : await client.getOrder(listed.orderId || listed);
  let shipment = null;
  let billing = null;
  if (order.shippingId) {
    try { shipment = await client.getShipment(order.shippingId); }
    catch { shipment = null; }
  }
  try { billing = await client.getBillingInfo(order.orderId); }
  catch { billing = null; }
  return { order, shipment, billing };
}

export async function ingestMercadoLibreNotification(payload, dependencies = {}) {
  const topic = text(payload?.topic).toLowerCase();
  if (topic && topic !== 'orders_v2' && topic !== 'shipments') {
    return { ignored: topic };
  }
  const parsed = parseMercadoLibreResource(payload?.resource);
  if (!parsed) return { ignored: 'resource' };
  const company = await (dependencies.findCompany || findCompanyByMercadoLibreUserId)(
    payload?.user_id,
    dependencies.db,
  );
  if (!company || !mercadoLibreGrantFromCompany(company)) {
    return { ignored: 'company' };
  }
  const client = await (dependencies.clientForCompany || mercadoLibreClientForCompany)(company, dependencies);
  const displayName = company.nombre || company.nombreComercial || company.razonSocial;
  const ingest = dependencies.ingest || ingestMercadoLibreOrder;
  const orderIds = [];
  if (parsed.kind === 'order') {
    orderIds.push(parsed.id);
  } else {
    const shipment = await client.getShipment(parsed.id);
    orderIds.push(...shipmentOrderIds(shipment));
  }
  const ingested = [];
  for (const orderId of orderIds) {
    const enriched = await enrichMercadoLibreOrder(client, { orderId });
    ingested.push(await ingest({
      companyId: company.id,
      displayName,
      userId: company.mercadoLibreUserId,
      normalized: enriched.order,
      shipment: enriched.shipment,
      billing: enriched.billing,
      siteId: company.mercadoLibreSiteId,
      source: 'webhook',
      eventId: `mercado-libre:${topic || parsed.kind}:${orderId}:${payload?.sent || payload?._id || 'observed'}`,
    }, dependencies.db));
  }
  return { ingested: ingested.length, orderIds };
}

export function acknowledgeMercadoLibreWebhook(payload, dependencies = {}) {
  const run = dependencies.schedule || ((work) => { setImmediate(work); });
  run(() => {
    ingestMercadoLibreNotification(payload, dependencies).catch((error) => {
      console.error(JSON.stringify({
        event: 'mercado_libre.webhook_failed',
        userId: payload?.user_id || null,
        topic: payload?.topic || null,
        resource: payload?.resource || null,
        message: String(error?.message || error),
      }));
    });
  });
  return { ok: true };
}
