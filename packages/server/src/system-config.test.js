import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_FLAGS,
  flagEnvRaw,
  isKnownSystemFlag,
  resolveFlagState,
  summarizeCatalogInventoryReadiness,
} from './system-config.js';

test('resolución del flag: la BD gana sobre la env salvo kill-switch', () => {
  // Sin BD y sin env → apagado por defecto.
  assert.deepEqual(resolveFlagState({ envRaw: null, dbEnabled: undefined }), {
    effective: false, source: 'default', killSwitch: false,
  });
  // Env explícito true sin BD → prendido por entorno.
  assert.equal(resolveFlagState({ envRaw: true, dbEnabled: undefined }).effective, true);
  // BD apagada gana sobre env prendida.
  const dbOff = resolveFlagState({ envRaw: true, dbEnabled: false });
  assert.equal(dbOff.effective, false);
  assert.equal(dbOff.source, 'db');
  // BD prendida gana sobre env apagada-no-explícita (null).
  assert.equal(resolveFlagState({ envRaw: null, dbEnabled: true }).effective, true);
});

test('kill-switch de entorno apaga el flag aunque la BD lo tenga prendido', () => {
  const state = resolveFlagState({ envRaw: false, dbEnabled: true });
  assert.equal(state.effective, false);
  assert.equal(state.killSwitch, true);
  assert.equal(state.source, 'env_kill_switch');
});

test('registro de flags conocidos', () => {
  assert.ok(isKnownSystemFlag('catalog_inventory'));
  assert.ok(isKnownSystemFlag('marketplace_publication_mutation'));
  assert.ok(isKnownSystemFlag('falabella_sync'));
  assert.ok(isKnownSystemFlag('ripley_sync'));
  assert.equal(isKnownSystemFlag('no_existe'), false);
  assert.equal(SYSTEM_FLAGS.catalog_inventory.envVar, 'CATALOG_INVENTORY_ENABLED');
  assert.equal(SYSTEM_FLAGS.catalog_inventory.confirmWord, null);
  assert.equal(SYSTEM_FLAGS.marketplace_publication_mutation.confirmWord, 'HABILITAR');
});

test('precedencia de env vars del sync de Falabella: ORDER_SYNC_ENABLED gana', () => {
  const meta = SYSTEM_FLAGS.falabella_sync;
  assert.equal(flagEnvRaw(meta, { ORDER_SYNC_ENABLED: 'false' }), false);
  assert.equal(flagEnvRaw(meta, { FALABELLA_SYNC_ENABLED: 'true' }), true);
  // La primera con valor explícito decide; la segunda se ignora.
  assert.equal(
    flagEnvRaw(meta, { ORDER_SYNC_ENABLED: 'true', FALABELLA_SYNC_ENABLED: 'false' }),
    true,
  );
  assert.equal(flagEnvRaw(meta, {}), null);
});

test('checklist de inventario: bloquea solo cuando no hay listings', () => {
  const vacio = summarizeCatalogInventoryReadiness({});
  const listings = vacio.find((step) => step.id === 'listings_imported');
  assert.equal(listings.ok, false);
  assert.equal(listings.blocking, true);

  const sembrado = summarizeCatalogInventoryReadiness({
    products: 12,
    activeListings: 30,
    sellersWithListings: 2,
    seededMovements: 5,
    pendingStockJobs: 0,
    skippedUnmappedItems: 0,
    negativeProducts: 0,
  });
  for (const step of sembrado) {
    if (step.id === 'products_count') continue;
    assert.equal(step.ok, true, step.id);
  }
});

test('checklist de inventario marca avisos sin bloquear', () => {
  const conAvisos = summarizeCatalogInventoryReadiness({
    products: 3,
    activeListings: 4,
    sellersWithListings: 1,
    seededMovements: 0,
    pendingStockJobs: 7,
    skippedUnmappedItems: 2,
    negativeProducts: 1,
  });
  const bloqueos = conAvisos.filter((step) => step.blocking && !step.ok);
  assert.deepEqual(bloqueos.map((step) => step.id), []);
  assert.equal(conAvisos.find((step) => step.id === 'stock_seeded').ok, false);
  assert.equal(conAvisos.find((step) => step.id === 'queue_clean').detail, '7 trabajo(s) pendiente(s) en inventory_stock_jobs.');
  assert.match(conAvisos.find((step) => step.id === 'mapping_clean').detail, /skipped_unmapped/);
});
