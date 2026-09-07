import { loadCore } from './catalog/utils.js';
import { ensureSystemConfigTable } from './system-config.js';
import {
  DEFAULT_ORDER_SYNC_INTERVAL_MINUTES,
  DEFAULT_ORDER_SYNC_LOOKBACK_DAYS,
  clampOrderSyncIntervalMinutes,
  clampOrderSyncLookbackDays,
} from './order-sync-policy.js';

export const ORDER_SYNC_SETTINGS_KEY = 'order_sync';

export const DEFAULT_ORDER_SYNC_SETTINGS = {
  intervalMinutes: DEFAULT_ORDER_SYNC_INTERVAL_MINUTES,
  lookbackDays: DEFAULT_ORDER_SYNC_LOOKBACK_DAYS,
};

async function target(db) {
  if (db) return db;
  const core = await loadCore();
  return core.pool;
}

export function parseOrderSyncSettings(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    intervalMinutes: clampOrderSyncIntervalMinutes(raw.intervalMinutes),
    lookbackDays: clampOrderSyncLookbackDays(raw.lookbackDays),
  };
}

export async function loadOrderSyncSettings(db) {
  try {
    const client = await target(db);
    await ensureSystemConfigTable(client);
    const result = await client.query(
      'select value from system_settings where key=$1',
      [ORDER_SYNC_SETTINGS_KEY],
    );
    return parseOrderSyncSettings(result.rows[0]?.value);
  } catch {
    return { ...DEFAULT_ORDER_SYNC_SETTINGS };
  }
}

async function applySharedInterval(client, intervalMinutes) {
  await client.query(
    'update order_sync_state set sync_interval_minutes=$1, updated_at=now()',
    [intervalMinutes],
  ).catch(() => {});
  await client.query(
    'update falabella_sync_state set sync_interval_minutes=$1, updated_at=now()',
    [intervalMinutes],
  ).catch(() => {});
  await client.query(
    'update ripley_sync_state set sync_interval_minutes=$1, updated_at=now()',
    [intervalMinutes],
  ).catch(() => {});
}

export async function saveOrderSyncSettings(db, input = {}, actorId) {
  const current = await loadOrderSyncSettings(db);
  const next = parseOrderSyncSettings({
    intervalMinutes: input.intervalMinutes === undefined ? current.intervalMinutes : input.intervalMinutes,
    lookbackDays: input.lookbackDays === undefined ? current.lookbackDays : input.lookbackDays,
  });
  const client = await target(db);
  await ensureSystemConfigTable(client);
  await client.query(
    `insert into system_settings (key, value, updated_at, updated_by)
     values ($1, $2::jsonb, now(), $3)
     on conflict (key) do update set
       value=excluded.value,
       updated_at=now(),
       updated_by=excluded.updated_by`,
    [ORDER_SYNC_SETTINGS_KEY, JSON.stringify(next), actorId == null ? null : String(actorId)],
  );
  await applySharedInterval(client, next.intervalMinutes);
  return next;
}
