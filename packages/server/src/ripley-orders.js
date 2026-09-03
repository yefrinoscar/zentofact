import { RipleyApiClient } from '@zentofact/ripley-api';
import { ensureRipleyOrderAccount, ingestRipleyOrder } from './order-adapters/ripley.js';
import { syncRipleyLogistics } from './ripley-logistics.js';
import { isRipleySyncEnabled } from './system-config.js';

const RIPLEY_PERU_API_URL = 'https://ripleyperu-prod.mirakl.net';

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function clientFor(company, fetchImpl) {
  if (!company?.ripleyApiKey?.trim()) throw new Error('La empresa no tiene configurada la API key de Ripley.');
  return new RipleyApiClient({
    baseUrl: RIPLEY_PERU_API_URL,
    apiKey: company.ripleyApiKey,
    shopId: company.ripleyShopId || undefined,
    fetchImpl,
  });
}

export function ripleySyncWindow(options = {}, lastSuccessfulSyncAt = null) {
  if (options.date) {
    const start = new Date(`${options.date}T00:00:00-05:00`);
    if (Number.isNaN(start.getTime())) throw new Error('Fecha inválida para sincronizar Ripley.');
    const end = new Date(start.getTime() + 24 * 60 * 60_000);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  if (options.startUpdateDate) return { startUpdateDate: new Date(options.startUpdateDate).toISOString() };
  if (lastSuccessfulSyncAt) return { startUpdateDate: new Date(lastSuccessfulSyncAt).toISOString() };
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  return { startUpdateDate: since.toISOString() };
}

export async function syncRipleyOrders(companyIdInput, options = {}, dependencies = {}) {
  const companyId = Number(companyIdInput);
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error('Empresa inválida.');
  const core = dependencies.getCompany && dependencies.db ? null : await loadCore();
  const db = dependencies.db || core.pool;
  const company = await (dependencies.getCompany || core.getCompany)(companyId);
  if (!company?.activo) throw new Error('Empresa no encontrada o inactiva.');
  await db.query(
    `insert into ripley_sync_state (company_id) values ($1)
     on conflict (company_id) do nothing`,
    [companyId],
  );
  const claimed = await db.query(
    `update ripley_sync_state set
       status='running', last_attempt_at=now(), last_started_at=now(), last_error=null, updated_at=now()
     where company_id=$1 and enabled is true
       and (status <> 'running' or last_started_at < now() - interval '15 minutes')
     returning last_successful_sync_at`,
    [companyId],
  );
  if (!claimed.rows.length) return { companyId, status: 'already_running', received: 0, ingested: 0, orderIds: [] };
  try {
    const client = dependencies.client || clientFor(company, dependencies.fetchImpl);
    const account = await ensureRipleyOrderAccount(
      db,
      companyId,
      company.nombre || company.nombreComercial || company.razonSocial,
      company.ripleyShopId,
    );
    const orders = await client.listAllOrders(ripleySyncWindow(options, claimed.rows[0].last_successful_sync_at));
    const results = [];
    for (const normalized of orders) {
      results.push(await ingestRipleyOrder({
        companyId,
        normalized,
        account,
        shopId: company.ripleyShopId,
        source: 'sync',
      }, db));
    }
    const hasSvc = company.ripleySvcBaseUrl?.trim()
      && company.ripleySvcUsername?.trim()
      && company.ripleySvcPassword;
    const logistics = hasSvc
      ? await (dependencies.syncLogistics || syncRipleyLogistics)(company, { db, fetchImpl: dependencies.fetchImpl })
      : { received: 0, matched: 0, status: 'not_configured' };
    await db.query(
      `update ripley_sync_state set status='success', last_finished_at=now(),
         last_successful_sync_at=now(), last_orders_received=$2, last_error=null, updated_at=now()
       where company_id=$1`,
      [companyId, orders.length],
    );
    return {
      companyId,
      status: 'success',
      received: orders.length,
      ingested: results.length,
      orderIds: orders.map((order) => order.orderId),
      logistics,
    };
  } catch (error) {
    await db.query(
      `update ripley_sync_state set status='error', last_finished_at=now(), last_error=$2, updated_at=now()
       where company_id=$1`,
      [companyId, error instanceof Error ? error.message : String(error)],
    ).catch(() => {});
    throw error;
  }
}

export function startRipleySyncScheduler() {
  let running = false;
  const tick = async () => {
    // El flag vive en BD (panel superadmin); la env solo actúa como kill-switch.
    if (!(await isRipleySyncEnabled())) return;
    if (running) return;
    running = true;
    try {
      const core = await loadCore();
      const due = await core.pool.query(
        `select c.id
         from companies c
         left join ripley_sync_state state on state.company_id=c.id
         where c.activo is true and nullif(trim(c.ripley_api_key), '') is not null
           and coalesce(state.enabled, true) is true
           and (
             state.last_attempt_at is null
             or state.last_attempt_at <= now() - make_interval(mins => coalesce(state.sync_interval_minutes, 5))
           )
         order by c.id`,
      );
      for (const row of due.rows) {
        await syncRipleyOrders(row.id).catch((error) => console.error('[RIPLEY SYNC]', row.id, error.message));
      }
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(() => { tick().catch(() => {}); }, 45_000);
  initial.unref?.();
  const poll = setInterval(() => { tick().catch(() => {}); }, 60_000);
  poll.unref?.();
}

export async function syncAllRipleyOrders(options = {}, dependencies = {}) {
  const core = dependencies.listCompanies ? null : await loadCore();
  const companies = (await (dependencies.listCompanies || core.listCompanies)()).filter((company) => (
    company.activo && company.ripleyApiKey?.trim()
  ));
  const results = [];
  for (const company of companies) {
    try {
      const result = await (dependencies.syncOrders || syncRipleyOrders)(company.id, options, dependencies);
      results.push({ companyId: company.id, companyName: company.nombre || company.razonSocial, ok: true, result });
    } catch (error) {
      results.push({
        companyId: company.id,
        companyName: company.nombre || company.razonSocial,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    channel: 'ripley',
    stores: companies.length,
    successful: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    results,
  };
}
