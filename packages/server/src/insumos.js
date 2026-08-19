// Inventario operativo de materiales de empaque y oficina.
// No forma parte del catálogo vendible: un insumo se consume, no se publica.
import { Pool } from 'pg';

export const INSUMO_UNITS = ['unidades', 'rollos', 'resmas', 'kg', 'cajas'];
export const INSUMO_ICON_KEYS = [
  'cinta-fill', 'fill-pequeno', 'fill-amarillo', 'cinta-scotch',
  'hojas-bond', 'cartuchos-tinta', 'generic',
];
export const INSUMO_STATUSES = ['active', 'archived'];

export const DEFAULT_INSUMOS = [
  { code: 'cinta-fill', name: 'Fill grande', unit: 'rollos', iconKey: 'cinta-fill', reorderPoint: 2 },
  { code: 'fill-pequeno', name: 'Fill pequeño', unit: 'rollos', iconKey: 'fill-pequeno', reorderPoint: 2 },
  { code: 'cinta-scotch', name: 'Cinta scotch', unit: 'rollos', iconKey: 'cinta-scotch', reorderPoint: 3 },
];

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
      created_at timestamptz not null default now(),
      check (quantity_delta <> 0)
    );
    create index if not exists idx_insumo_movements_insumo
      on insumo_movements(insumo_id, created_at desc);
  `);

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
  return {
    items,
    totalCount: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    lowStockCount: result.rows[0] ? Number(result.rows[0].low_stock_count) : 0,
    limit,
    offset,
  };
}

export async function createInsumo(input = {}, actorUserId, db) {
  const name = text(input.name, 'name', 80);
  const unit = oneOf(input.unit, INSUMO_UNITS, 'unit');
  const iconKey = oneOf(input.iconKey || 'generic', INSUMO_ICON_KEYS, 'iconKey');
  const quantityOnHand = finiteNumber(input.quantityOnHand ?? 0, 'quantityOnHand');
  if (quantityOnHand < 0) throw httpError('La cantidad no puede ser negativa.');
  const reorderPoint = finiteNumber(input.reorderPoint, 'reorderPoint', { nullable: true });
  if (reorderPoint != null && reorderPoint < 0) throw httpError('El punto de reposición no puede ser negativo.');
  const actor = text(actorUserId, 'actorUserId', 120, { nullable: true });

  return inTransaction(db, async (client) => {
    const duplicate = await client.query(
      'select id from insumos where lower(name) = lower($1) and status = $2 limit 1',
      [name, 'active'],
    );
    if (duplicate.rows.length) throw httpError('Ya existe un insumo con ese nombre.');
    const code = await uniqueCode(client, slugifyInsumoName(name));
    const inserted = await client.query(
      `insert into insumos (code, name, unit, icon_key, quantity_on_hand, reorder_point, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7)
       returning *`,
      [code, name, unit, iconKey, quantityOnHand, reorderPoint, actor],
    );
    return mapInsumo(inserted.rows[0]);
  });
}

export async function updateInsumo(idInput, input = {}, actorUserId, db) {
  const id = positiveInt(idInput);
  const actor = text(actorUserId, 'actorUserId', 120, { nullable: true });
  return inTransaction(db, async (client) => {
    const current = await client.query('select * from insumos where id=$1 for update', [id]);
    if (!current.rows.length) throw httpError('Insumo no encontrado.', 404);
    const row = current.rows[0];
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
      [name, unit, iconKey, reorderPoint, status, actor, id],
    );
    return mapInsumo(updated.rows[0]);
  });
}

export async function adjustInsumo(idInput, input = {}, actorUserId, db) {
  const id = positiveInt(idInput);
  const hasDelta = input.delta !== undefined && input.delta !== null && input.delta !== '';
  const hasAbsolute = input.absoluteTarget !== undefined && input.absoluteTarget !== null && input.absoluteTarget !== '';
  if (hasDelta === hasAbsolute) throw httpError('Envía delta o absoluteTarget, pero no ambos.');
  const note = text(input.note, 'note', 200, { nullable: true });
  const actor = text(actorUserId, 'actorUserId', 120, { nullable: true });

  return inTransaction(db, async (client) => {
    const locked = await client.query('select * from insumos where id=$1 for update', [id]);
    if (!locked.rows.length) throw httpError('Insumo no encontrado.', 404);
    const current = Number(locked.rows[0].quantity_on_hand);
    const absoluteTarget = hasAbsolute ? finiteNumber(input.absoluteTarget, 'absoluteTarget') : null;
    const delta = hasAbsolute ? absoluteTarget - current : finiteNumber(input.delta, 'delta');
    if (delta === 0) {
      return { applied: false, noChange: true, insumo: mapInsumo(locked.rows[0]) };
    }
    const projected = current + delta;
    if (projected < 0) {
      throw httpError(`La cantidad no puede quedar negativa. Saldo actual: ${current}.`);
    }
    const updated = await client.query(
      `update insumos
       set quantity_on_hand=$1, updated_at=now(), updated_by=$2
       where id=$3
       returning *`,
      [projected, actor, id],
    );
    await client.query(
      `insert into insumo_movements (insumo_id, quantity_delta, quantity_after, note, actor_user_id)
       values ($1,$2,$3,$4,$5)`,
      [id, delta, projected, note, actor],
    );
    return { applied: true, noChange: false, insumo: mapInsumo(updated.rows[0]) };
  });
}
