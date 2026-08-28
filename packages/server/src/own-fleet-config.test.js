import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOwnFleetConfig, saveOwnFleetConfig } from './own-fleet-config.js';
import { OWN_FLEET_BEACH_KEYS } from './own-fleet-shipping.js';

test('loadOwnFleetConfig usa playas apagadas si no hay fila', async () => {
  const db = {
    async query() {
      return { rows: [] };
    },
  };
  const config = await loadOwnFleetConfig(db);
  for (const key of OWN_FLEET_BEACH_KEYS) {
    assert.equal(config.districts.find((district) => district.key === key)?.enabled, false, key);
  }
  assert.equal(config.districts.find((district) => district.key === 'san miguel')?.enabled, true);
  assert.equal(config.districts.find((district) => district.key === 'ancon')?.enabled, true);
});

test('saveOwnFleetConfig persiste solo key, precio y si llegamos', async () => {
  const writes = [];
  const db = {
    async query(sql, params = []) {
      writes.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { rows: [] };
    },
  };
  const saved = await saveOwnFleetConfig(db, {
    districts: [{ key: 'pucusana', enabled: true, amount: 30 }],
  }, 'admin-1');
  const pucusana = saved.districts.find((district) => district.key === 'pucusana');
  assert.equal(pucusana?.enabled, true);
  assert.equal(pucusana?.amount, 30);

  const insert = writes.find((write) => write.sql.startsWith('insert into system_settings'));
  assert.ok(insert);
  const payload = JSON.parse(insert.params[1]);
  assert.equal(payload.districts.find((district) => district.key === 'pucusana')?.enabled, true);
  assert.equal(payload.districts.find((district) => district.key === 'pucusana')?.amount, 30);
  assert.equal(payload.districts[0].lat, undefined);
});
