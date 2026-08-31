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

test('loadOwnFleetConfig trae las tres zonas por distancia', async () => {
  const db = { async query() { return { rows: [] }; } };
  const config = await loadOwnFleetConfig(db);
  assert.deepEqual(config.zones.map((zone) => [zone.name, zone.amount]), [
    ['Cerca', 10],
    ['Media', 15],
    ['Lejos', 25],
  ]);
});

test('saveOwnFleetConfig persiste zonas y la zona de cada distrito, no su precio', async () => {
  const writes = [];
  const db = {
    async query(sql, params = []) {
      writes.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { rows: [] };
    },
  };
  const saved = await saveOwnFleetConfig(db, {
    zones: [
      { key: 'cerca', name: 'Cerca', amount: 10 },
      { key: 'media', name: 'Media', amount: 15 },
      { key: 'lejos', name: 'Lejos', amount: 30 },
    ],
    districts: [{ key: 'pucusana', zone: 'lejos', enabled: true }],
  }, 'admin-1');
  const pucusana = saved.districts.find((district) => district.key === 'pucusana');
  assert.equal(pucusana?.enabled, true);
  assert.equal(pucusana?.zone, 'lejos');
  assert.equal(pucusana?.amount, 30);

  const insert = writes.find((write) => write.sql.startsWith('insert into system_settings'));
  assert.ok(insert);
  const payload = JSON.parse(insert.params[1]);
  assert.equal(payload.zones.find((zone) => zone.key === 'lejos')?.amount, 30);
  const storedPucusana = payload.districts.find((district) => district.key === 'pucusana');
  assert.equal(storedPucusana?.enabled, true);
  assert.equal(storedPucusana?.zone, 'lejos');
  // El precio vive en la zona; el distrito no lo repite.
  assert.equal(storedPucusana?.amount, undefined);
  assert.equal(payload.districts[0].lat, undefined);
});

test('una configuración vieja con precio por distrito se migra a zonas al guardar', async () => {
  const db = { async query() { return { rows: [] }; } };
  const saved = await saveOwnFleetConfig(db, {
    districts: [{ key: 'pucusana', enabled: true, amount: 30 }],
  }, 'admin-1');
  const pucusana = saved.districts.find((district) => district.key === 'pucusana');
  assert.equal(pucusana?.amount, 30, 'el precio configurado no se pierde');
  assert.equal(saved.zones.find((zone) => zone.key === pucusana.zone)?.amount, 30);
});
