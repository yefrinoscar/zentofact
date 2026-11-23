import assert from 'node:assert/strict';
import test from 'node:test';
import { planReleaseVersion } from './release-sync.mjs';

test('un PR sin bump se sube un paso sobre main', () => {
  assert.deepEqual(
    planReleaseVersion({ baseVersion: '1.42.1', headVersion: '1.42.1', lockVersion: '1.42.1', releaseType: 'release:minor' }),
    { expected: '1.43.0', needsBump: true },
  );
});

test('un PR ya bien versionado no se toca', () => {
  assert.deepEqual(
    planReleaseVersion({ baseVersion: '1.42.1', headVersion: '1.42.2', lockVersion: '1.42.2', releaseType: 'release:patch' }),
    { expected: '1.42.2', needsBump: false },
  );
});

test('si main avanzó, el PR se recalcula desde la versión nueva', () => {
  assert.deepEqual(
    planReleaseVersion({ baseVersion: '1.43.0', headVersion: '1.42.2', lockVersion: '1.42.2', releaseType: 'release:patch' }),
    { expected: '1.43.1', needsBump: true },
  );
});

test('un lockfile desfasado también dispara el bump', () => {
  assert.deepEqual(
    planReleaseVersion({ baseVersion: '1.42.1', headVersion: '2.0.0', lockVersion: '1.42.1', releaseType: 'release:major' }),
    { expected: '2.0.0', needsBump: true },
  );
});
