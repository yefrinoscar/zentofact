// Configuración del sistema por ambiente, controlada desde el panel superadmin.
// El valor operativo vive en la BD (system_settings); la variable de entorno
// solo actúa como kill-switch de emergencia: si está explícitamente en false,
// apaga el flag sin importar lo que diga la BD. Apagar no borra datos.
import { loadCore } from './catalog/utils.js';

export const SYSTEM_CONFIG_CACHE_TTL_MS = 5_000;
const AUGUST_INVENTORY_START_AT = '2026-08-01T05:00:00.000Z';

// Registro de flags operables desde el panel. Cualquier flag nuevo se agrega aquí.
// envVars: variables en orden de precedencia; la primera con valor explícito gana
// (y si es 'false' actúa como kill-switch).
export const SYSTEM_FLAGS = {
  catalog_inventory: {
    key: 'catalog_inventory',
    envVar: 'CATALOG_INVENTORY_ENABLED',
    label: 'Descuento de inventario al listo para enviar',
    description: 'Descuenta el stock del producto maestro cuando un pedido pasa a listo para enviar — Falabella, Ripley o venta manual — y reintegra en cancelación o devolución.',
    confirmWord: null,
    requireListings: true,
    docsPath: '/docs/catalog-inventory.md',
  },
  marketplace_publication_mutation: {
    key: 'marketplace_publication_mutation',
    envVar: 'MARKETPLACE_PUBLICATION_MUTATION_ENABLED',
    label: 'Mutación real de publicaciones Falabella',
    description: 'Permite que publicar y despublicar llame al Seller API real. Sin este flag el flujo es visual-only y nunca muta el marketplace.',
    confirmWord: 'HABILITAR',
    requireListings: false,
    docsPath: null,
  },
  falabella_sync: {
    key: 'falabella_sync',
    envVar: 'FALABELLA_SYNC_ENABLED',
    envVars: ['ORDER_SYNC_ENABLED', 'FALABELLA_SYNC_ENABLED'],
    label: 'Sincronización periódica de Falabella',
    description: 'Pausa o reanuda la descarga automática de pedidos nuevos y cambios de estado desde Falabella. No afecta webhooks ni el sync manual.',
    confirmWord: null,
    requireListings: false,
    docsPath: null,
  },
  ripley_sync: {
    key: 'ripley_sync',
    envVar: 'RIPLEY_SYNC_ENABLED',
    label: 'Sincronización periódica de Ripley',
    description: 'Pausa o reanuda la descarga automática de pedidos desde Ripley. No afecta la consulta manual.',
    confirmWord: null,
    requireListings: false,
    docsPath: null,
  },
};

function envBooleanRaw(name) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return null;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return null;
}

/** Primera variable con valor explícito según el orden de precedencia del flag. */
export function flagEnvRaw(meta, env = process.env) {
  const names = Array.isArray(meta.envVars) && meta.envVars.length ? meta.envVars : [meta.envVar];
  for (const name of names) {
    const value = String(env[name] ?? '').trim().toLowerCase();
    if (!value) continue;
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
  }
  return null;
}

export function isKnownSystemFlag(key) {
  return Object.hasOwn(SYSTEM_FLAGS, String(key || '').trim());
}

/**
 * Resolución pura del estado efectivo de un flag.
 * - env explícito false → kill-switch: apaga siempre.
 * - si hay valor en BD → gana la BD.
 * - si no hay BD → env true o default false.
 */
export function resolveFlagState({ envRaw, dbEnabled }) {
  const killSwitch = envRaw === false;
  if (killSwitch) return { effective: false, source: 'env_kill_switch', killSwitch };
  if (typeof dbEnabled === 'boolean') return { effective: dbEnabled, source: 'db', killSwitch };
  if (envRaw === true) return { effective: true, source: 'env', killSwitch };
  return { effective: false, source: 'default', killSwitch };
}

/** Resumen puro del checklist de activación de inventario a partir de conteos SQL. */
export function summarizeCatalogInventoryReadiness(counts) {
  const safe = counts && typeof counts === 'object' ? counts : {};
  const number = (value) => Math.max(0, Number(value) || 0);
  const noun = (value, singular, plural) => Number(value) === 1 ? singular : plural;
  const products = number(safe.products);
  const listings = number(safe.activeListings);
  const sellers = number(safe.sellersWithListings);
  const seededMovements = number(safe.seededMovements);
  const pendingJobs = number(safe.pendingStockJobs);
  const skippedUnmapped = number(safe.skippedUnmappedItems);
  const skippedOrders = number(safe.skippedUnmappedOrders);
  const skippedUnits = number(safe.skippedUnmappedUnits);
  const shortageItems = number(safe.insufficientStockItems);
  const shortageOrders = number(safe.insufficientStockOrders);
  const shortageUnits = number(safe.insufficientStockUnits);
  const driftProducts = number(safe.inventoryDriftProducts);
  const negativeProducts = number(safe.negativeProducts);
  const oldestUnmapped = safe.skippedUnmappedOldest
    ? new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Lima' })
      .format(new Date(safe.skippedUnmappedOldest)).replace('.', '')
    : null;
  return [
    {
      id: 'listings_imported',
      label: 'Listings importados',
      detail: sellers > 0
        ? `${listings} publicaciones activas de ${sellers} seller(es).`
        : 'Importa las publicaciones de cada seller antes de encender.',
      ok: listings > 0,
      blocking: true,
    },
    {
      id: 'stock_seeded',
      label: 'Stock físico sembrado con ajustes absolutos',
      detail: seededMovements > 0
        ? `${seededMovements} ajuste(s) manuales registrados.`
        : 'Registra el stock inicial con ajustes absolutos y motivo; no uses el stock de Falabella.',
      ok: seededMovements > 0,
      blocking: false,
    },
    {
      id: 'queue_clean',
      label: 'Cola de stock sin trabajos pendientes',
      detail: pendingJobs > 0
        ? `${pendingJobs} trabajo(s) pendiente(s) en inventory_stock_jobs.`
        : 'Sin trabajos pendientes.',
      ok: pendingJobs === 0,
      blocking: false,
    },
    {
      id: 'mapping_clean',
      label: 'Ventas Falabella mapeadas desde agosto',
      detail: skippedUnmapped > 0
        ? `${skippedUnmapped} ${noun(skippedUnmapped, 'línea', 'líneas')} de ${skippedOrders} ${noun(skippedOrders, 'pedido', 'pedidos')} (${skippedUnits} ${noun(skippedUnits, 'unidad', 'unidades')}) desde agosto no descontaron stock porque no tenían producto maestro al importarse.${oldestUnmapped ? ` La más antigua es del ${oldestUnmapped}.` : ''}`
        : shortageItems > 0
          ? `Todas tienen producto maestro. ${shortageItems} ${noun(shortageItems, 'línea', 'líneas')} de ${shortageOrders} ${noun(shortageOrders, 'pedido', 'pedidos')} (${shortageUnits} ${noun(shortageUnits, 'unidad', 'unidades')}) encontraron el stock maestro en 0; el saldo se mantuvo en 0 para evitar negativos.`
          : 'Todas tienen producto maestro y están reflejadas en el inventario.',
      ok: skippedUnmapped === 0,
      blocking: false,
    },
    {
      id: 'inventory_ledger_clean',
      label: 'Saldos auditables',
      detail: driftProducts > 0
        ? `${driftProducts} productos tienen un saldo que no coincide con sus movimientos. Cuenta el stock físico y usa Productos → Inventario → Ajustar stock → Fijar saldo absoluto.`
        : 'Los saldos coinciden con sus movimientos.',
      ok: driftProducts === 0,
      blocking: false,
    },
    {
      id: 'no_negative_stock',
      label: 'Sin saldos negativos',
      detail: negativeProducts > 0
        ? `${negativeProducts} producto(s) con saldo negativo; revísalos en Inventario.`
        : 'Ningún producto con saldo negativo.',
      ok: negativeProducts === 0,
      blocking: false,
    },
    { id: 'products_count', label: 'Productos maestros', detail: `${products}`, ok: products > 0, blocking: false, informationalOnly: true },
  ];
}

async function target(db) {
  if (db) return db;
  const core = await loadCore();
  return core.pool;
}

let ensured = false;

export async function ensureSystemConfigTable(db) {
  const client = await target(db);
  await client.query(`
    create table if not exists system_settings (
      key text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      updated_by text
    );
  `);
  ensured = true;
}

let loggedLoadFailure = false;

async function loadDbFlags(db) {
  // El DDL corre una sola vez en el boot del servidor; aquí solo se lee y
  // cualquier fallo degrada a env/default sin romper el flujo de pedidos.
  if (!ensured && !db) {
    try { await ensureSystemConfigTable(db); } catch { /* se reintenta en la próxima lectura */ }
  }
  const client = await target(db);
  try {
    const rows = (await client.query(
      'select key, value from system_settings',
    )).rows;
    const flags = {};
    for (const row of rows) {
      flags[row.key] = row.value?.enabled === true;
    }
    cache.rows = flags;
    cache.loadedAt = Date.now();
    loggedLoadFailure = false;
    return flags;
  } catch (error) {
    // Sin BD disponible el runtime resuelve solo con env/default.
    if (!loggedLoadFailure) {
      loggedLoadFailure = true;
      console.error(JSON.stringify({ event: 'system_config.load_failed', error: String(error?.message || error) }));
    }
    return {};
  }
}

const cache = { rows: {}, loadedAt: 0 };

export function invalidateSystemConfigCache() {
  cache.loadedAt = 0;
  cache.rows = {};
}

async function cachedDbFlags(db) {
  if (Date.now() - cache.loadedAt < SYSTEM_CONFIG_CACHE_TTL_MS) return cache.rows;
  return loadDbFlags(db);
}

/** Lectura runtime del flag efectivo de inventario (para stock-phase). */
export async function isCatalogInventoryEnabled(db) {
  return (await effectiveFlagState(SYSTEM_FLAGS.catalog_inventory, db)).effective;
}

/** Lectura runtime del flag de mutación de publicaciones. */
export async function isMarketplacePublicationMutationEnabled(db) {
  return (await effectiveFlagState(SYSTEM_FLAGS.marketplace_publication_mutation, db)).effective;
}

/** Lectura runtime del scheduler periódico de Falabella (para el tick del cron). */
export async function isFalabellaSyncEnabled(db) {
  return (await effectiveFlagState(SYSTEM_FLAGS.falabella_sync, db)).effective;
}

/** Lectura runtime del scheduler periódico de Ripley. */
export async function isRipleySyncEnabled(db) {
  return (await effectiveFlagState(SYSTEM_FLAGS.ripley_sync, db)).effective;
}

async function effectiveFlagState(meta, db) {
  const flags = await cachedDbFlags(db);
  const dbEnabled = typeof flags[meta.key] === 'boolean' ? flags[meta.key] : undefined;
  return resolveFlagState({ envRaw: flagEnvRaw(meta), dbEnabled });
}

export async function readinessCatalogInventory(db) {
  const client = await target(db);
  try {
    const result = await client.query(`
      with active_listings as (
        select count(*)::int as listings,
               count(distinct company_id)::int as sellers
          from product_listings where status='active'
      ),
      seeded as (
        select count(*)::int as movements from inventory_movements
         where movement_type in ('initial','import','adjustment_in','adjustment_out')
      ),
      jobs as (
        select count(*)::int as pending from inventory_stock_jobs where status='pending'
      ),
      unmapped as (
        select count(*)::int as skipped,
               count(distinct oi.order_id)::int as orders,
               coalesce(sum(oi.quantity),0) as units,
               min(o.ordered_at) as oldest
          from order_items oi
          join orders o on o.id=oi.order_id
          join order_channel_accounts a on a.id=o.channel_account_id
          join order_channels ch on ch.id=a.channel_id
         where oi.stock_state='skipped_unmapped'
           and ch.code='falabella'
           and o.ordered_at >= $1::timestamptz
      ),
      insufficient as (
        select count(*)::int as items,
               count(distinct oi.order_id)::int as orders,
               coalesce(sum(oi.quantity),0) as units
          from order_items oi
          join orders o on o.id=oi.order_id
          join order_channel_accounts a on a.id=o.channel_account_id
          join order_channels ch on ch.id=a.channel_id
         where oi.stock_state='skipped_insufficient'
           and ch.code='falabella'
           and o.ordered_at >= $1::timestamptz
      ),
      movement_sequence as (
        select id, product_id, quantity_delta, quantity_after,
               lag(quantity_after) over(partition by product_id order by created_at,id) as previous_after
          from inventory_movements
      ),
      latest_absolute_baselines as (
        select distinct on(product_id) product_id,id as baseline_id
          from inventory_movements
         where metadata->>'mode'='absolute'
         order by product_id,created_at desc,id desc
      ),
      movement_breaks as (
        select distinct ms.product_id from movement_sequence ms
        left join latest_absolute_baselines b using(product_id)
         where ms.id > coalesce(b.baseline_id,0)
           and ms.previous_after is not null
           and ms.quantity_after <> ms.previous_after + ms.quantity_delta
      ),
      latest_movements as (
        select distinct on(product_id) product_id,quantity_after,created_at
          from inventory_movements order by product_id,created_at desc,id desc
      ),
      current_breaks as (
        select pi.product_id
          from product_inventory pi
          left join latest_movements lm using(product_id)
          left join lateral (
            select a.target_quantity,r.applied_at
              from inventory_reconciliation_anchors a
              join inventory_reconciliation_runs r on r.id=a.run_id
             where a.product_id=pi.product_id
             order by r.applied_at desc,r.id desc limit 1
          ) anchor on true
         where pi.quantity_on_hand <> case
           when anchor.applied_at is not null
             and (lm.created_at is null or anchor.applied_at >= lm.created_at)
             then anchor.target_quantity
           else coalesce(lm.quantity_after,anchor.target_quantity,0)
         end
      ),
      drift as (
        select count(distinct product_id)::int as products
          from (select product_id from movement_breaks union all select product_id from current_breaks) affected
      ),
      products_agg as (
        select count(*)::int as products from products where status='active'
      ),
      negatives as (
        select count(*)::int as products from product_inventory where quantity_on_hand < 0
      )
      select p.products, l.listings, l.sellers, s.movements, j.pending,
             u.skipped, u.orders as unmapped_orders, u.units as unmapped_units, u.oldest as unmapped_oldest,
             insufficient.items as insufficient_items, insufficient.orders as insufficient_orders,
             insufficient.units as insufficient_units,
             d.products as drift_products, n.products as negative_products
        from products_agg p cross join active_listings l cross join seeded s cross join jobs j
        cross join unmapped u cross join insufficient cross join drift d cross join negatives n
    `, [AUGUST_INVENTORY_START_AT]);
    const row = result.rows[0] || {};
    const counts = {
      products: row.products,
      activeListings: row.listings,
      sellersWithListings: row.sellers,
      seededMovements: row.movements,
      pendingStockJobs: row.pending,
      skippedUnmappedItems: row.skipped,
      skippedUnmappedOrders: row.unmapped_orders,
      skippedUnmappedUnits: row.unmapped_units,
      skippedUnmappedOldest: row.unmapped_oldest,
      insufficientStockItems: row.insufficient_items,
      insufficientStockOrders: row.insufficient_orders,
      insufficientStockUnits: row.insufficient_units,
      inventoryDriftProducts: row.drift_products,
      negativeProducts: row.negative_products,
    };
    return { counts, steps: summarizeCatalogInventoryReadiness(counts), error: null };
  } catch (error) {
    return {
      counts: null,
      steps: [],
      error: `No se pudo calcular el checklist: ${String(error?.message || error).slice(0, 200)}`,
    };
  }
}

export async function listSystemConfigAudit(limit = 15, db) {
  const client = await target(db);
  const rows = (await client.query(
    `select a.id, a.action, a.details, a.created_at, a.actor_id, u.name as actor_name, u.email as actor_email
       from user_audit_log a left join "user" u on u.id=a.actor_id
      where a.action='system_config.update'
      order by a.id desc limit $1`,
    [Math.min(Math.max(Number(limit) || 15, 1), 100)],
  )).rows;
  return rows.map((row) => ({
    id: Number(row.id),
    key: row.details?.key || null,
    enabled: row.details?.enabled === true,
    forced: row.details?.forced === true,
    reason: row.details?.reason || null,
    actorName: row.actor_name || row.actor_email || null,
    createdAt: row.created_at,
  }));
}

export function publicFlagState(key, { dbEnabled }) {
  const meta = SYSTEM_FLAGS[key];
  const envRaw = flagEnvRaw(meta);
  const state = resolveFlagState({ envRaw, dbEnabled });
  const sourceLabel = {
    db: 'Base de datos',
    env: 'Variable de entorno',
    env_kill_switch: 'Kill-switch de entorno',
    default: 'Predeterminado',
  }[state.source];
  return {
    key,
    label: meta.label,
    description: meta.description,
    envVar: meta.envVar,
    docsPath: meta.docsPath,
    effective: state.effective,
    source: state.source,
    sourceLabel,
    killSwitch: state.killSwitch,
    confirmWord: meta.confirmWord,
    requireListings: meta.requireListings,
    dbValue: typeof dbEnabled === 'boolean' ? dbEnabled : null,
  };
}

export async function getSystemConfig(db) {
  const flags = await cachedDbFlags(db);
  const payload = {};
  for (const key of Object.keys(SYSTEM_FLAGS)) {
    payload[key] = publicFlagState(key, { dbEnabled: flags[key] });
  }
  const [readiness, audit] = await Promise.all([
    readinessCatalogInventory(db),
    listSystemConfigAudit(10, db),
  ]);
  return { flags: payload, catalogInventory: readiness, recentChanges: audit };
}

export async function setSystemFlag(key, input = {}, actorId, db) {
  const normalizedKey = String(key || '').trim();
  const meta = SYSTEM_FLAGS[normalizedKey];
  if (!meta) throw httpErrorWithStatus('Flag desconocido.', 400, 'unknown_system_flag');
  const client = await target(db);

  const flags = await loadDbFlags(client);
  const current = typeof flags[normalizedKey] === 'boolean' ? flags[normalizedKey] : null;
  const nextEnabled = input.enabled === true;

  if (!input.force && !nextEnabled && current !== true) {
    throw httpErrorWithStatus('El flag ya está apagado.', 409, 'already_disabled');
  }
  // La palabra de confirmación solo se exige para encender; apagar es el
  // camino seguro y siempre inmediato.
  if (nextEnabled && meta.confirmWord && input.confirm !== meta.confirmWord) {
    throw httpErrorWithStatus(
      `Escribe "${meta.confirmWord}" para confirmar esta acción.`,
      400,
      'confirmation_required',
    );
  }
  if (nextEnabled && meta.requireListings && !input.force) {
    const readiness = await readinessCatalogInventory(client);
    const blocking = readiness.steps.filter((step) => step.blocking && !step.ok);
    if (blocking.length) {
      const error = httpErrorWithStatus(
        `No se puede encender: ${blocking.map((step) => step.label.toLowerCase()).join('; ')}.`,
        409,
        'readiness_blocked',
      );
      error.readiness = readiness;
      throw error;
    }
  }

  await client.query(
    `insert into system_settings (key, value, updated_at, updated_by)
     values ($1, jsonb_build_object('enabled', $2::bool), now(), $3)
     on conflict (key) do update set
       value=jsonb_build_object('enabled', $2::bool),
       updated_at=now(),
       updated_by=excluded.updated_by`,
    [normalizedKey, nextEnabled, actorId == null ? null : String(actorId)],
  );
  await client.query(
    `insert into user_audit_log (actor_id, target_id, action, details, created_at)
     values ($1, null, 'system_config.update', $2::jsonb, now())`,
    [actorId == null ? null : String(actorId), JSON.stringify({
      key: normalizedKey,
      enabled: nextEnabled,
      previous: current,
      forced: input.force === true,
      reason: typeof input.reason === 'string' ? input.reason.slice(0, 300) : null,
    })],
  );

  invalidateSystemConfigCache();

  const updatedFlags = await loadDbFlags(client);
  return publicFlagState(normalizedKey, { dbEnabled: updatedFlags[normalizedKey] });
}

function httpErrorWithStatus(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
