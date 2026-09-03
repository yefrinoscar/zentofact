import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isProductionEnvironment,
  isRailwayPrPreview,
  shouldSeedPreview,
} from './preview-env.js';

test('detecta entornos PR de Railway', () => {
  assert.equal(isRailwayPrPreview({ RAILWAY_ENVIRONMENT_NAME: 'zentofact-pr-96' }), true);
  assert.equal(isRailwayPrPreview({ RAILWAY_ENVIRONMENT_NAME: 'pr-12' }), true);
  assert.equal(isRailwayPrPreview({ RAILWAY_ENVIRONMENT_NAME: 'development' }), false);
  assert.equal(isRailwayPrPreview({ RAILWAY_ENVIRONMENT_NAME: 'production' }), false);
});

test('nunca siembra production aunque SEED_PREVIEW esté activo', () => {
  assert.equal(isProductionEnvironment({ RAILWAY_ENVIRONMENT_NAME: 'production' }), true);
  assert.equal(shouldSeedPreview({
    RAILWAY_ENVIRONMENT_NAME: 'production',
    SEED_PREVIEW: 'true',
  }), false);
});

test('siembra PR preview automáticamente y SEED_PREVIEW en no-prod', () => {
  assert.equal(shouldSeedPreview({ RAILWAY_ENVIRONMENT_NAME: 'zentofact-pr-1' }), true);
  assert.equal(shouldSeedPreview({ SEED_PREVIEW: 'true' }), true);
  assert.equal(shouldSeedPreview({ RAILWAY_ENVIRONMENT_NAME: 'development' }), false);
});

test('permite saltar el seed en PR con SEED_PREVIEW=false o SKIP_PREVIEW_SEED', () => {
  assert.equal(shouldSeedPreview({
    RAILWAY_ENVIRONMENT_NAME: 'zentofact-pr-1',
    SEED_PREVIEW: 'false',
  }), false);
  assert.equal(shouldSeedPreview({
    RAILWAY_ENVIRONMENT_NAME: 'zentofact-pr-1',
    SEED_PREVIEW: '0',
  }), false);
  assert.equal(shouldSeedPreview({
    RAILWAY_ENVIRONMENT_NAME: 'zentofact-pr-1',
    SKIP_PREVIEW_SEED: 'true',
  }), false);
  assert.equal(shouldSeedPreview({
    RAILWAY_ENVIRONMENT_NAME: 'zentofact-pr-1',
    SKIP_PREVIEW_SEED: '1',
  }), false);
});
