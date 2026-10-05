import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: resolve('.env') });

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    order: { type: 'string' },
    limit: { type: 'string' },
  },
});

const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL_POSTGRES;
if (!connectionString) throw new Error('Falta DATABASE_PUBLIC_URL o DATABASE_URL_POSTGRES.');

const { mercadoLibreClientForCompany } = await import('../packages/server/src/mercado-libre-tokens.js');
const {
  mapMercadoLibrePromisedShippingAt,
  mapMercadoLibreShipping,
} = await import('../packages/server/src/order-adapters/mercadolibre.js');

const LIMA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' });
function limaDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : LIMA_DATE.format(date);
}

const orderId = Number(values.order) > 0 ? Number(values.order) : null;
const limit = Math.max(1, Math.min(Number(values.limit) || 200, 1000));

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

// Los pedidos creados antes del 3 oct 2026 quedaron sin mode/logistic_type
// porque el cliente pedía los envíos en el formato nuevo de Mercado Libre,
// que omite esos campos y esconde el botón Imprimir de la bandeja.
const { rows: orders } = await client.query(`
  select o.id, o.company_id, o.external_order_id, o.fulfillment_status,
         o.ordered_at, o.promised_shipping_at,
         o.metadata->>'shippingId' as shipping_id,
         o.metadata->>'shippingMode' as shipping_mode,
         o.metadata->>'logisticType' as logistic_type,
         o.metadata->>'shippingSubstatus' as shipping_substatus,
         o.shipping->>'carrier' as shipping_carrier,
         o.shipping->>'type' as shipping_type,
         o.shipping->>'trackingCode' as shipping_tracking
    from orders o
    join order_channel_accounts account on account.id = o.channel_account_id
    join order_channels channel on channel.id = account.channel_id
   where channel.code = 'mercado_libre'
     and nullif(o.metadata->>'shippingId', '') is not null
     and o.fulfillment_status in ('pending', 'preparing', 'ready_to_ship', 'shipped')
     and ($1::bigint is null or o.id = $1)
   order by o.updated_at desc
   limit $2`, [orderId, limit]);

const { rows: companies } = await client.query(`
  select id, mercado_libre_user_id, mercado_libre_site_id,
         mercado_libre_access_token, mercado_libre_refresh_token,
         mercado_libre_token_expires_at, mercado_libre_app_id,
         mercado_libre_client_secret, mercado_libre_redirect_uri
    from companies
   where nullif(trim(mercado_libre_user_id), '') is not null`);

const companyById = new Map(companies.map((row) => [Number(row.id), {
  id: row.id,
  mercadoLibreUserId: row.mercado_libre_user_id,
  mercadoLibreSiteId: row.mercado_libre_site_id,
  mercadoLibreAccessToken: row.mercado_libre_access_token,
  mercadoLibreRefreshToken: row.mercado_libre_refresh_token,
  mercadoLibreTokenExpiresAt: row.mercado_libre_token_expires_at,
  mercadoLibreAppId: row.mercado_libre_app_id,
  mercadoLibreClientSecret: row.mercado_libre_client_secret,
  mercadoLibreRedirectUri: row.mercado_libre_redirect_uri,
}]));

const clientByCompany = new Map();
async function mercadoLibreClient(company) {
  if (!clientByCompany.has(Number(company.id))) {
    clientByCompany.set(Number(company.id), await mercadoLibreClientForCompany(company));
  }
  return clientByCompany.get(Number(company.id));
}

console.log(`Pedidos Mercado Libre activos con envío: ${orders.length}`);

let updated = 0;
let unchanged = 0;
const failures = [];

for (const order of orders) {
  const company = companyById.get(Number(order.company_id));
  if (!company) {
    failures.push({ id: order.id, reason: 'la empresa no tiene Mercado Libre conectado' });
    continue;
  }
  try {
    const ml = await mercadoLibreClient(company);
    const shipment = await ml.getShipment(order.shipping_id);
    const next = {
      shippingMode: shipment.mode || null,
      logisticType: shipment.logisticType || null,
      shippingSubstatus: shipment.substatus || null,
    };
    // La fecha prometida también se guardó con el fallback (+24 h) mientras el
    // formato nuevo ocultaba shipping_option/lead_time.
    const promisedShippingAt = mapMercadoLibrePromisedShippingAt(shipment, order.ordered_at);
    const currentPromised = order.promised_shipping_at
      ? new Date(order.promised_shipping_at).toISOString()
      : null;
    // El JSON de envío quedó sin tipo ni transportista por el mismo motivo.
    const nextShipping = mapMercadoLibreShipping(shipment);
    const changed = (order.shipping_mode || null) !== next.shippingMode
      || (order.logistic_type || null) !== next.logisticType
      || (order.shipping_substatus || null) !== next.shippingSubstatus
      || currentPromised !== promisedShippingAt
      || (order.shipping_carrier || null) !== (nextShipping.carrier || null)
      || (order.shipping_type || null) !== (nextShipping.type || null)
      || (order.shipping_tracking || null) !== (nextShipping.trackingCode || null);
    const detail = [
      `pedido ${order.id}`,
      order.fulfillment_status,
      `mode ${order.shipping_mode || '—'} → ${next.shippingMode || '—'}`,
      `logistic ${order.logistic_type || '—'} → ${next.logisticType || '—'}`,
      `substatus ${order.shipping_substatus || '—'} → ${next.shippingSubstatus || '—'}`,
      `prometido ${limaDate(order.promised_shipping_at)} → ${limaDate(promisedShippingAt)}`,
      `transportista ${order.shipping_carrier || '—'} → ${nextShipping.carrier || '—'}`,
    ].join(' · ');
    if (!changed) {
      unchanged += 1;
      console.log(`= ${detail}`);
      continue;
    }
    if (values.apply) {
      await client.query(
        `update orders
            set metadata = metadata || $2::jsonb,
                promised_shipping_at = $3,
                shipping = coalesce(shipping, '{}'::jsonb) || jsonb_strip_nulls($4::jsonb)
          where id = $1`,
        [order.id, JSON.stringify(next), promisedShippingAt, JSON.stringify(nextShipping)],
      );
    }
    updated += 1;
    console.log(`✓ ${detail}`);
  } catch (error) {
    failures.push({ id: order.id, reason: String(error?.message || error) });
    console.log(`✗ pedido ${order.id} · ${String(error?.message || error)}`);
  }
}

console.log(`\n${values.apply ? 'Aplicado' : 'Dry-run'}: ${updated} con cambios, ${unchanged} sin cambios, ${failures.length} con error.`);
for (const failure of failures) console.log(`  - pedido ${failure.id}: ${failure.reason}`);
if (!values.apply) console.log('Vuelve a correrlo con --apply para guardar los cambios.');

client.release();
await pool.end();
