// Inbox operativo: lee el estado actual y el leído/descartado por usuario.
import { Pool } from 'pg';
import { FAILED_EMISSION_ALERT_AFTER_ATTEMPTS } from './auto-emission-alert.js';
import { userHasPermission } from './permissions.js';
import {
  applyNotificationState,
  collectLiveNotifications,
  filterNotificationsForUser,
  parseNotificationIds,
  publicNotification,
  sortNotifications,
  unreadNotificationCount,
} from './notifications-policy.js';

let defaultPool;

function getPool() {
  if (!defaultPool) {
    defaultPool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
  }
  return defaultPool;
}

function target(db) {
  return db || getPool();
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireUserId(user) {
  const id = String(user?.id || '').trim();
  if (!id) throw httpError('No autenticado', 401);
  return id;
}

async function safeSource(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.warn('[notifications]', label, error?.message || error);
    return null;
  }
}

export async function ensureTables(db) {
  await target(db).query(`
    create table if not exists operator_notification_state (
      user_id text not null,
      notification_id text not null,
      read_at timestamptz,
      dismissed_at timestamptz,
      updated_at timestamptz not null default now(),
      primary key (user_id, notification_id)
    );
    create index if not exists idx_operator_notification_state_user
      on operator_notification_state (user_id, updated_at desc);
  `);
}

async function failedEmissionSummary(db) {
  const result = await target(db).query(
    `select count(*)::int as count, max(updated_at) as updated_at
     from emission_jobs
     where coalesce(kind, 'invoice') = 'invoice'
       and (
         status = 'failed'
         or (status = 'pending' and attempts >= $1)
       )`,
    [FAILED_EMISSION_ALERT_AFTER_ATTEMPTS],
  );
  const row = result.rows[0] || {};
  return {
    count: Number(row.count || 0),
    updatedAt: row.updated_at || null,
  };
}

async function lowStockInsumos(db) {
  const result = await target(db).query(
    `select id, name, unit, quantity_on_hand, reorder_point, status, updated_at
     from insumos
     where status = 'active'
       and reorder_point is not null
       and quantity_on_hand <= reorder_point
     order by quantity_on_hand asc, name asc
     limit 20`,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    unit: row.unit,
    quantityOnHand: Number(row.quantity_on_hand),
    reorderPoint: row.reorder_point == null ? null : Number(row.reorder_point),
    status: row.status,
    updatedAt: row.updated_at,
  }));
}

async function loadStateById(userId, ids, db) {
  const stateById = new Map();
  if (!ids.length) return stateById;
  const result = await target(db).query(
    `select notification_id, read_at, dismissed_at
     from operator_notification_state
     where user_id = $1
       and notification_id = any($2::text[])`,
    [userId, ids],
  );
  for (const row of result.rows) {
    stateById.set(String(row.notification_id), {
      readAt: row.read_at || null,
      dismissedAt: row.dismissed_at || null,
    });
  }
  return stateById;
}

async function collectVisibleNotifications(user, db) {
  requireUserId(user);
  const [failedEmissions, lowInsumos, overdueBandeja] = await Promise.all([
    safeSource('emission', () => failedEmissionSummary(db)),
    safeSource('insumos', () => lowStockInsumos(db)),
    safeSource('bandeja', async () => {
      const { countOpenOverdueOrders } = await import('./logistics-inbox.js');
      return countOpenOverdueOrders(db);
    }),
  ]);
  const live = collectLiveNotifications({
    failedEmissions: failedEmissions || { count: 0 },
    lowInsumos: lowInsumos || [],
    overdueBandeja: overdueBandeja || { count: 0 },
  });
  const scoped = filterNotificationsForUser(live, user, userHasPermission);
  const stateById = await loadStateById(requireUserId(user), scoped.map((item) => item.id), db);
  return sortNotifications(applyNotificationState(scoped, stateById));
}

export async function listForUser(user, db) {
  const items = await collectVisibleNotifications(user, db);
  return {
    items: items.map(publicNotification),
    unreadCount: unreadNotificationCount(items),
  };
}

async function upsertState(userId, ids, fields, db) {
  if (!ids.length) return;
  const client = target(db);
  for (const id of ids) {
    await client.query(
      `insert into operator_notification_state (user_id, notification_id, read_at, dismissed_at, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (user_id, notification_id) do update
         set read_at = coalesce(operator_notification_state.read_at, excluded.read_at),
             dismissed_at = coalesce(operator_notification_state.dismissed_at, excluded.dismissed_at),
             updated_at = now()`,
      [userId, id, fields.readAt, fields.dismissedAt],
    );
  }
}

export async function markRead(user, input = {}, db) {
  const userId = requireUserId(user);
  const visible = await collectVisibleNotifications(user, db);
  const requested = input.all === true
    ? visible.filter((item) => item.unread).map((item) => item.id)
    : parseNotificationIds(input.ids ?? input.id);
  const allowed = new Set(visible.map((item) => item.id));
  const ids = requested.filter((id) => allowed.has(id));
  await upsertState(userId, ids, { readAt: new Date().toISOString(), dismissedAt: null }, db);
  return listForUser(user, db);
}

export async function dismiss(user, id, db) {
  const userId = requireUserId(user);
  const ids = parseNotificationIds(id);
  if (!ids.length) throw httpError('Aviso inválido');
  const visible = await collectVisibleNotifications(user, db);
  const allowed = new Set(visible.map((item) => item.id));
  const matched = ids.filter((entry) => allowed.has(entry));
  if (!matched.length) throw httpError('Aviso inválido');
  await upsertState(userId, matched, {
    readAt: new Date().toISOString(),
    dismissedAt: new Date().toISOString(),
  }, db);
  return listForUser(user, db);
}
