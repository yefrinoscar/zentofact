import { loadCore } from './catalog/utils.js';
import { ensureSystemConfigTable } from './system-config.js';
import {
  defaultOwnFleetConfig,
  mergeOwnFleetConfig,
  serializeOwnFleetConfig,
} from './own-fleet-shipping.js';

export const OWN_FLEET_SETTINGS_KEY = 'own_fleet_shipping';

async function target(db) {
  if (db) return db;
  const core = await loadCore();
  return core.pool;
}

export async function loadOwnFleetConfig(db) {
  try {
    const client = await target(db);
    const result = await client.query(
      'select value from system_settings where key=$1',
      [OWN_FLEET_SETTINGS_KEY],
    );
    return mergeOwnFleetConfig(result.rows[0]?.value);
  } catch {
    return defaultOwnFleetConfig();
  }
}

export async function saveOwnFleetConfig(db, input, actorId) {
  const serialized = serializeOwnFleetConfig(input);
  const client = await target(db);
  await ensureSystemConfigTable(client);
  await client.query(
    `insert into system_settings (key, value, updated_at, updated_by)
     values ($1, $2::jsonb, now(), $3)
     on conflict (key) do update set
       value=excluded.value,
       updated_at=now(),
       updated_by=excluded.updated_by`,
    [OWN_FLEET_SETTINGS_KEY, JSON.stringify(serialized), actorId == null ? null : String(actorId)],
  );
  return mergeOwnFleetConfig(serialized);
}
