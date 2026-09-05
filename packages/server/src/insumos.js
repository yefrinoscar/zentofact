// Inventario operativo de materiales de empaque y oficina.
// No forma parte del catálogo vendible: un insumo se consume, no se publica.
import { timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { parseAlertEmailInput, parseAlertEmails } from './auto-emission-alert.js';

export const INSUMO_UNITS = ['unidades', 'rollos', 'resmas', 'kg', 'cajas'];
export const INSUMO_ICON_KEYS = [
  'cinta-fill', 'fill-pequeno', 'fill-amarillo', 'cinta-scotch',
  'hojas-bond', 'cartuchos-tinta', 'generic',
];
export const INSUMO_STATUSES = ['active', 'archived'];
export const DEFAULT_INSUMO_CHANGE_PIN = '2324';
export const CINTA_QUANTITY_CAP = 36;
export const FILL_QUANTITY_CAP = 16;
export const FILL_PURCHASE_PACK = 4;
export const INSUMO_SUPPLIER_CODES = Object.freeze({
  'cinta-fill': 'P06',
  'fill-pequeno': 'P31',
});

export const DEFAULT_INSUMOS = [
  { code: 'cinta-fill', name: 'Fill grande', unit: 'rollos', iconKey: 'cinta-fill', reorderPoint: 2 },
  { code: 'fill-pequeno', name: 'Fill pequeño', unit: 'rollos', iconKey: 'fill-pequeno', reorderPoint: 2 },
  { code: 'cinta-scotch', name: 'Cinta scotch', unit: 'rollos', iconKey: 'cinta-scotch', reorderPoint: 3 },
];

export const INSUMO_TZ = 'America/Lima';
export const PURCHASE_LOOKBACK_DAYS = 7;
export const PURCHASE_HORIZONS = Object.freeze({ days: 3, week: 7, month: 30 });

export function limaDateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: INSUMO_TZ }).format(value);
}

export function limaLookbackStart(days = PURCHASE_LOOKBACK_DAYS, now = new Date()) {
  const windowDays = Number(days) > 0 ? Number(days) : PURCHASE_LOOKBACK_DAYS;
  const start = new Date(`${limaDateKey(now)}T00:00:00.000-05:00`);
  start.setTime(start.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000);
  return start;
}

export function purchasePackSizeFor(row = {}) {
  const haystack = [row.code, row.icon_key, row.iconKey, row.name]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  if (haystack.includes('fill')) return FILL_PURCHASE_PACK;
  return 1;
}

export function suggestInsumoPurchases({
  consumedRecent,
  quantityOnHand,
  lookbackDays = PURCHASE_LOOKBACK_DAYS,
  packSize = 1,
  unit = 'rollos',
} = {}) {
  const consumed = Math.max(0, Number(consumedRecent) || 0);
  const onHand = Math.max(0, Number(quantityOnHand) || 0);
  const windowDays = Number(lookbackDays) > 0 ? Number(lookbackDays) : PURCHASE_LOOKBACK_DAYS;
  const size = Number(packSize) > 1 ? Number(packSize) : 1;
  const hasConsumption = consumed > 0;
  const dailyRate = hasConsumption ? consumed / windowDays : 0;
  const buyFor = (horizonDays) => {
    if (!hasConsumption) return 0;
    const rolls = Math.max(0, Math.ceil((dailyRate * horizonDays) - onHand));
    return size > 1 ? Math.ceil(rolls / size) : rolls;
  };
  return {
    lookbackDays: windowDays,
    consumed,
    hasConsumption,
    packSize: size,
    purchaseUnit: size > 1 ? 'cajas' : unit,
    days: buyFor(PURCHASE_HORIZONS.days),
    week: buyFor(PURCHASE_HORIZONS.week),
    month: buyFor(PURCHASE_HORIZONS.month),
  };
}

const SORT_COLUMNS = {
  name: 'i.name',
  quantity: 'i.quantity_on_hand',
  updatedAt: 'i.updated_at',
  unit: 'i.unit',
};

let defaultPool;

function getPool() {
  if (!defaultPool) {
    defaultPool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
  }
  return defaultPool;
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function text(value, field, max = 80, { nullable = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    if (nullable) return null;
    throw httpError(`${field} es obligatorio.`);
  }
  return normalized.slice(0, max);
}

function finiteNumber(value, field, { nullable = false } = {}) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw httpError(`${field} inválido.`);
  return parsed;
}

function positiveInt(value, field = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw httpError(`${field} inválido.`);
  return parsed;
}

function oneOf(value, allowed, field) {
  const normalized = String(value ?? '').trim();
  if (!allowed.includes(normalized)) throw httpError(`${field} inválido.`);
  return normalized;
}

export function quantityCapFor(row = {}) {
  const haystack = [row.code, row.icon_key, row.iconKey, row.name]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  if (haystack.includes('fill')) return FILL_QUANTITY_CAP;
  if (haystack.includes('cinta') || haystack.includes('scotch')) return CINTA_QUANTITY_CAP;
  return null;
}

function assertQuantityWithinCap(row, quantity) {
  const cap = quantityCapFor(row);
  if (cap == null || quantity <= cap) return cap;
  throw httpError(`${row.name} no puede pasar de ${cap}.`);
}

function insumoChangePin() {
  return String(process.env.INSUMO_CHANGE_PIN || DEFAULT_INSUMO_CHANGE_PIN);
}

export function assertInsumoPin(pin) {
  const expected = Buffer.from(insumoChangePin());
  const received = Buffer.from(String(pin ?? '').trim());
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw httpError('PIN incorrecto.', 403);
  }
}

function actorRef(actor) {
  if (actor == null || actor === '') return { id: null, name: null };
  if (typeof actor === 'string') {
    return { id: text(actor, 'actorUserId', 120, { nullable: true }), name: null };
  }
  return {
    id: text(actor.id, 'actorUserId', 120, { nullable: true }),
    name: text(actor.name, 'actorName', 80, { nullable: true }),
  };
}

async function resolveActorName(client, actor) {
  if (actor.name) return actor.name;
  if (!actor.id) return null;
  const found = await client.query('select name from "user" where id = $1 limit 1', [actor.id]);
  return found.rows[0]?.name || null;
}

async function insertMovement(client, { insumoId, quantityDelta, quantityAfter, note, actorId, actorName }) {
  await client.query(
    `insert into insumo_movements (insumo_id, quantity_delta, quantity_after, note, actor_user_id, actor_name)
     values ($1,$2,$3,$4,$5,$6)`,
    [insumoId, quantityDelta, quantityAfter, note, actorId, actorName],
  );
}

function mapMovement(row) {
  return {
    id: Number(row.id),
    insumoId: Number(row.insumo_id),
    insumoName: row.insumo_name,
    insumoCode: row.insumo_code,
    quantityDelta: Number(row.quantity_delta),
    quantityAfter: Number(row.quantity_after),
    note: row.note,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name || null,
    createdAt: row.created_at,
  };
}

export function slugifyInsumoName(name) {
  const slug = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'insumo';
}

export function mapInsumo(row) {
  if (!row) return null;
  const quantityOnHand = Number(row.quantity_on_hand || 0);
  const reorderPoint = row.reorder_point == null ? null : Number(row.reorder_point);
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    unit: row.unit,
    iconKey: row.icon_key,
    quantityOnHand,
    reorderPoint,
    status: row.status,
    lowStock: reorderPoint != null && quantityOnHand <= reorderPoint,
    quantityCap: quantityCapFor(row),
    packSize: purchasePackSizeFor(row),
    supplierCode: INSUMO_SUPPLIER_CODES[row.code] || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

async function inTransaction(db, work) {
  if (db) return work(db);
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function target(db) {
  return db || getPool();
}

export async function ensureTables(db) {
  const client = target(db);
  await client.query(`
    create table if not exists insumos (
      id bigserial primary key,
      code text not null unique,
      name text not null,
      unit text not null,
      icon_key text not null,
      quantity_on_hand numeric(14,4) not null default 0,
      reorder_point numeric(14,4),
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      created_by text,
      updated_by text,
      check (char_length(trim(code)) between 1 and 64),
      check (char_length(trim(name)) between 1 and 80),
      check (unit in ('unidades', 'rollos', 'resmas', 'kg', 'cajas')),
      check (icon_key in ('cinta-fill', 'fill-pequeno', 'fill-amarillo', 'cinta-scotch', 'hojas-bond', 'cartuchos-tinta', 'generic')),
      check (status in ('active', 'archived')),
      check (quantity_on_hand >= 0)
    );
    create index if not exists idx_insumos_status_name on insumos(status, name);
    create table if not exists insumo_movements (
      id bigserial primary key,
      insumo_id bigint not null references insumos(id),
      quantity_delta numeric(14,4) not null,
      quantity_after numeric(14,4) not null,
      note text,
      actor_user_id text,
      actor_name text,
      created_at timestamptz not null default now(),
      check (quantity_delta <> 0)
    );
    create index if not exists idx_insumo_movements_insumo
      on insumo_movements(insumo_id, created_at desc);
    alter table insumo_movements add column if not exists actor_name text;
    create table if not exists insumo_alert_state (
      id integer primary key default 1,
      alert_emails text,
      updated_at timestamptz not null default now()
    );
  `);
  await client.query(
    'insert into insumo_alert_state (id) values (1) on conflict (id) do nothing',
  );

  await client.query(`
    do $$ declare
      constraint_name text;
    begin
      for constraint_name in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        where rel.relname = 'insumos'
          and con.contype = 'c'
          and pg_get_constraintdef(con.oid) ilike '%icon_key%'
      loop
        execute format('alter table insumos drop constraint %I', constraint_name);
      end loop;
    end $$;
  `);

  await client.query(`
    update insumos
       set code = 'cinta-fill', name = 'Fill grande', icon_key = 'cinta-fill', updated_at = now()
     where code = 'papel-fill'
       and not exists (select 1 from insumos where code = 'cinta-fill');
    update insumos
       set name = 'Fill grande', updated_at = now()
     where code = 'cinta-fill' and name in ('Cinta fill', 'Papel fill');
    update insumos
       set code = 'cinta-scotch', name = 'Cinta scotch', icon_key = 'cinta-scotch', updated_at = now()
     where code = 'cinta'
       and not exists (select 1 from insumos where code = 'cinta-scotch');
  `);

  await client.query(`
    alter table insumos add constraint insumos_icon_key_check
      check (icon_key in ('cinta-fill', 'fill-pequeno', 'fill-amarillo', 'cinta-scotch', 'hojas-bond', 'cartuchos-tinta', 'generic'))
  `).catch((error) => {
    if (error?.code !== '42710') throw error;
  });

  await client.query(
    `insert into insumos (code, name, unit, icon_key, quantity_on_hand, reorder_point)
     values
       ('cinta-fill', 'Fill grande', 'rollos', 'cinta-fill', 0, 2),
       ('fill-pequeno', 'Fill pequeño', 'rollos', 'fill-pequeno', 0, 2),
       ('cinta-scotch', 'Cinta scotch', 'rollos', 'cinta-scotch', 0, 3)
     on conflict (code) do update
       set name = excluded.name,
           icon_key = excluded.icon_key
       where insumos.name in ('Papel fill', 'Cinta', 'Cinta fill')
          or insumos.icon_key in ('papel-fill', 'cinta')`,
  );

  await client.query(
    `update insumos
        set status = 'archived', updated_at = now()
      where code in ('hojas-bond', 'cartuchos-tinta', 'fill-amarillo')
        and status = 'active'`,
  );
}

async function uniqueCode(db, base) {
  const existing = await db.query(
    'select code from insumos where code = $1 or code like $2',
    [base, `${base}-%`],
  );
  const taken = new Set(existing.rows.map((row) => row.code));
  if (!taken.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }
  throw httpError('No se pudo generar un código único.');
}

export async function listInsumos(filters = {}, db) {
  const search = String(filters.search || '').trim().slice(0, 80);
  const status = filters.status ? oneOf(filters.status, INSUMO_STATUSES, 'status') : 'active';
  const lowStockOnly = filters.stock === 'low';
  const sortBy = SORT_COLUMNS[filters.sortBy] ? filters.sortBy : 'name';
  const sortDir = String(filters.sortDir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const result = await target(db).query(
    `select i.*,
            count(*) over() as total_count,
            count(*) filter (
              where i.reorder_point is not null and i.quantity_on_hand <= i.reorder_point
            ) over() as low_stock_count
     from insumos i
     where i.status = $1
       and ($2 = '' or i.name ilike '%' || $2 || '%' or i.code ilike '%' || $2 || '%')
       and ($3::boolean is false or (i.reorder_point is not null and i.quantity_on_hand <= i.reorder_point))
     order by ${SORT_COLUMNS[sortBy]} ${sortDir}, i.id asc
     limit $4 offset $5`,
    [status, search, lowStockOnly, limit, offset],
  );
  const items = result.rows.map(mapInsumo);
  const consumed = await consumptionByInsumoIds(items.map((item) => item.id), db);
  return {
    items: items.map((item) => ({
      ...item,
      purchase: suggestInsumoPurchases({
        consumedRecent: consumed.get(item.id) || 0,
        quantityOnHand: item.quantityOnHand,
        packSize: item.packSize,
        unit: item.unit,
      }),
    })),
    totalCount: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    lowStockCount: result.rows[0] ? Number(result.rows[0].low_stock_count) : 0,
    limit,
    offset,
  };
}

async function consumptionByInsumoIds(ids, db) {
  if (!ids.length) return new Map();
  const result = await target(db).query(
    `select insumo_id, coalesce(sum(-quantity_delta), 0) as consumed
     from insumo_movements
     where quantity_delta < 0
       and created_at >= $1
       and insumo_id = any($2::bigint[])
     group by insumo_id`,
    [limaLookbackStart(), ids],
  );
  return new Map(result.rows.map((row) => [Number(row.insumo_id), Number(row.consumed)]));
}

export async function createInsumo(input = {}, actorUserId, db) {
  assertInsumoPin(input.pin);
  const name = text(input.name, 'name', 80);
  const unit = oneOf(input.unit, INSUMO_UNITS, 'unit');
  const iconKey = oneOf(input.iconKey || 'generic', INSUMO_ICON_KEYS, 'iconKey');
  const quantityOnHand = finiteNumber(input.quantityOnHand ?? 0, 'quantityOnHand');
  if (quantityOnHand < 0) throw httpError('La cantidad no puede ser negativa.');
  const reorderPoint = finiteNumber(input.reorderPoint, 'reorderPoint', { nullable: true });
  if (reorderPoint != null && reorderPoint < 0) throw httpError('El punto de reposición no puede ser negativo.');
  const code = slugifyInsumoName(name);
  assertQuantityWithinCap({ code, name, icon_key: iconKey }, quantityOnHand);
  const actor = actorRef(actorUserId);

  return inTransaction(db, async (client) => {
    const duplicate = await client.query(
      'select id from insumos where lower(name) = lower($1) and status = $2 limit 1',
      [name, 'active'],
    );
    if (duplicate.rows.length) throw httpError('Ya existe un insumo con ese nombre.');
    const unique = await uniqueCode(client, code);
    const inserted = await client.query(
      `insert into insumos (code, name, unit, icon_key, quantity_on_hand, reorder_point, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7)
       returning *`,
      [unique, name, unit, iconKey, quantityOnHand, reorderPoint, actor.id],
    );
    if (quantityOnHand !== 0) {
      const actorName = await resolveActorName(client, actor);
      await insertMovement(client, {
        insumoId: inserted.rows[0].id,
        quantityDelta: quantityOnHand,
        quantityAfter: quantityOnHand,
        note: null,
        actorId: actor.id,
        actorName,
      });
    }
    return mapInsumo(inserted.rows[0]);
  });
}

export async function getAlertEmails(db) {
  const result = await target(db).query('select alert_emails from insumo_alert_state where id=1');
  return parseAlertEmails(result.rows[0]?.alert_emails);
}

export async function setAlertEmails(value, db) {
  const emails = parseAlertEmailInput(value);
  await target(db).query(
    `insert into insumo_alert_state (id, alert_emails, updated_at) values (1, $1, now())
     on conflict (id) do update set alert_emails=excluded.alert_emails, updated_at=now()`,
    [emails.join(', ')],
  );
  return { alertEmails: emails };
}

export async function updateInsumo(idInput, input = {}, actorUserId, db) {
  assertInsumoPin(input.pin);
  const id = positiveInt(idInput);
  const actor = actorRef(actorUserId);
  return inTransaction(db, async (client) => {
    const current = await client.query('select * from insumos where id=$1 for update', [id]);
    if (!current.rows.length) throw httpError('Insumo no encontrado.', 404);
    const row = current.rows[0];
    const previous = mapInsumo(row);
    const name = input.name == null ? row.name : text(input.name, 'name', 80);
    const unit = input.unit == null ? row.unit : oneOf(input.unit, INSUMO_UNITS, 'unit');
    const iconKey = input.iconKey == null ? row.icon_key : oneOf(input.iconKey, INSUMO_ICON_KEYS, 'iconKey');
    const reorderPoint = input.reorderPoint === undefined
      ? row.reorder_point
      : finiteNumber(input.reorderPoint, 'reorderPoint', { nullable: true });
    if (reorderPoint != null && Number(reorderPoint) < 0) {
      throw httpError('El punto de reposición no puede ser negativo.');
    }
    const status = input.status == null ? row.status : oneOf(input.status, INSUMO_STATUSES, 'status');
    if (name.toLowerCase() !== String(row.name).toLowerCase()) {
      const duplicate = await client.query(
        'select id from insumos where lower(name) = lower($1) and status = $2 and id <> $3 limit 1',
        [name, 'active', id],
      );
      if (duplicate.rows.length) throw httpError('Ya existe un insumo con ese nombre.');
    }
    const updated = await client.query(
      `update insumos
       set name=$1, unit=$2, icon_key=$3, reorder_point=$4, status=$5, updated_at=now(), updated_by=$6
       where id=$7
       returning *`,
      [name, unit, iconKey, reorderPoint, status, actor.id, id],
    );
    return { insumo: mapInsumo(updated.rows[0]), previous };
  });
}

export async function adjustInsumo(idInput, input = {}, actorUserId, db) {
  assertInsumoPin(input.pin);
  const id = positiveInt(idInput);
  const hasDelta = input.delta !== undefined && input.delta !== null && input.delta !== '';
  const hasAbsolute = input.absoluteTarget !== undefined && input.absoluteTarget !== null && input.absoluteTarget !== '';
  if (hasDelta === hasAbsolute) throw httpError('Envía delta o absoluteTarget, pero no ambos.');
  const note = text(input.note, 'note', 200, { nullable: true });
  const actor = actorRef(actorUserId);

  return inTransaction(db, async (client) => {
    const locked = await client.query('select * from insumos where id=$1 for update', [id]);
    if (!locked.rows.length) throw httpError('Insumo no encontrado.', 404);
    const previous = mapInsumo(locked.rows[0]);
    const current = Number(locked.rows[0].quantity_on_hand);
    const absoluteTarget = hasAbsolute ? finiteNumber(input.absoluteTarget, 'absoluteTarget') : null;
    const delta = hasAbsolute ? absoluteTarget - current : finiteNumber(input.delta, 'delta');
    if (delta === 0) {
      return { applied: false, noChange: true, insumo: previous, previous };
    }
    const projected = current + delta;
    if (projected < 0) {
      throw httpError(`La cantidad no puede quedar negativa. Saldo actual: ${current}.`);
    }
    assertQuantityWithinCap(locked.rows[0], projected);
    const actorName = await resolveActorName(client, actor);
    const updated = await client.query(
      `update insumos
       set quantity_on_hand=$1, updated_at=now(), updated_by=$2
       where id=$3
       returning *`,
      [projected, actor.id, id],
    );
    await insertMovement(client, {
      insumoId: id,
      quantityDelta: delta,
      quantityAfter: projected,
      note,
      actorId: actor.id,
      actorName,
    });
    return { applied: true, noChange: false, insumo: mapInsumo(updated.rows[0]), previous };
  });
}

export async function listInsumoMovements(filters = {}, db) {
  const insumoId = filters.insumoId ? positiveInt(filters.insumoId, 'insumoId') : null;
  const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const result = await target(db).query(
    `select m.id, m.insumo_id, i.name as insumo_name, i.code as insumo_code,
            m.quantity_delta, m.quantity_after, m.note, m.actor_user_id,
            coalesce(nullif(trim(m.actor_name), ''), u.name) as actor_name,
            m.created_at,
            count(*) over() as total_count
     from insumo_movements m
     join insumos i on i.id = m.insumo_id
     left join "user" u on u.id = m.actor_user_id
     where ($1::bigint is null or m.insumo_id = $1)
     order by m.created_at desc, m.id desc
     limit $2 offset $3`,
    [insumoId, limit, offset],
  );
  return {
    items: result.rows.map(mapMovement),
    totalCount: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    limit,
    offset,
  };
}
