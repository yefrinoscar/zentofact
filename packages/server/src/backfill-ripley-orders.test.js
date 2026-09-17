import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRipleyBackfillArgv } from './backfill-ripley-orders.js';

test('el CLI de backfill Ripley usa el 1 de septiembre y hoy en Lima', () => {
  assert.deepEqual(parseRipleyBackfillArgv([], new Date('2026-09-07T18:00:00.000Z')), {
    mode: 'backfill',
    channelCode: 'ripley',
    from: '2026-09-01',
    to: '2026-09-07',
  });
  assert.deepEqual(
    parseRipleyBackfillArgv(['--from', '2026-09-01', '--to', '2026-09-06'], new Date('2026-09-07T18:00:00.000Z')),
    {
      mode: 'backfill',
      channelCode: 'ripley',
      from: '2026-09-01',
      to: '2026-09-06',
    },
  );
});
