import test from 'node:test';
import assert from 'node:assert/strict';
import { DINSIDES_TIERS, buildDinsidesMap, dinsidesTierFor } from './dinsides-map.ts';

test('cada tarifa cae en una banda del mapa, igual que la leyenda de Dinsides', () => {
  assert.equal(dinsidesTierFor(8).label, 'S/ 8');
  assert.equal(dinsidesTierFor(10).label, 'S/ 10');
  assert.equal(dinsidesTierFor(12).label, 'S/ 12');
  assert.equal(dinsidesTierFor(14).label, 'S/ 14–17');
  assert.equal(dinsidesTierFor(17).label, 'S/ 14–17');
  assert.equal(dinsidesTierFor(28).label, 'S/ 19+');
});

test('las zonas más caras se ven más altas', () => {
  const heights = DINSIDES_TIERS.map((tier) => tier.height);
  assert.deepEqual([...heights].sort((a, b) => a - b), heights);
});

test('el mapa proyecta las 60 zonas y las 2 sedes dentro del viewBox', () => {
  const map = buildDinsidesMap();
  const [, , width, height] = map.viewBox.split(' ').map(Number);
  assert.equal(map.zones.length, 60);
  assert.equal(map.pins.length, 2);
  for (const zone of map.zones) {
    assert.match(zone.path, /^M[\d.]+ [\d.]+L/);
    assert.ok(zone.cx > 0 && zone.cx < width && zone.cy > 0 && zone.cy < height, zone.name);
  }
  for (let i = 1; i < map.zones.length; i++) assert.ok(map.zones[i - 1].depth <= map.zones[i].depth);
});
