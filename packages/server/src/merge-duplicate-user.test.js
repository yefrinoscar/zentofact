import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUPLICATE_USER_CASES,
  USER_REFERENCE_POLICIES,
  consolidateDuplicateUser,
  parseMergeArgs,
} from './merge-duplicate-user.js';

test('parseMergeArgs: dry-run por defecto y caso julio', () => {
  const options = parseMergeArgs(['--case', 'julio']);
  assert.equal(options.apply, false, 'sin --apply debe ser dry-run');
  assert.equal(options.help, false);
  assert.equal(options.keep.id, DUPLICATE_USER_CASES.julio.keep.id);
  assert.equal(options.keep.email, DUPLICATE_USER_CASES.julio.keep.email);
  assert.equal(options.duplicate.id, DUPLICATE_USER_CASES.julio.duplicate.id);
  assert.equal(options.duplicate.email, DUPLICATE_USER_CASES.julio.duplicate.email);
});

test('parseMergeArgs: --apply habilita y --dry-run revierte', () => {
  assert.equal(parseMergeArgs(['--case', 'julio', '--apply']).apply, true);
  assert.equal(parseMergeArgs(['--case', 'julio', '--apply', '--dry-run']).apply, false);
});

test('parseMergeArgs: argumentos explícitos pisan el caso', () => {
  const options = parseMergeArgs([
    '--case', 'julio',
    '--keep-id', 'keep-1', '--keep-email', 'Keep@Example.com',
    '--dup-id', 'dup-1', '--dup-email', 'dup@example.com',
  ]);
  assert.equal(options.keep.id, 'keep-1');
  assert.equal(options.keep.email, 'Keep@Example.com');
  assert.equal(options.duplicate.id, 'dup-1');
  assert.equal(options.duplicate.email, 'dup@example.com');
});

test('parseMergeArgs: exige ids y emails completos', () => {
  assert.throws(() => parseMergeArgs([]), /Faltan argumentos/);
  assert.throws(() => parseMergeArgs(['--case', 'desconocido']), /Caso desconocido/);
  assert.throws(() => parseMergeArgs(['--keep-id']), /requiere un valor/);
  assert.throws(() => parseMergeArgs(['--nope']), /no reconocido/);
});

test('políticas de referencia: única por columna y sin duplicados', () => {
  const seen = new Set();
  for (const policy of USER_REFERENCE_POLICIES) {
    const key = `${policy.table}.${policy.column}`;
    assert.equal(seen.has(key), false, `política duplicada: ${key}`);
    seen.add(key);
    assert.ok(['reassign', 'delete', 'preserve'].includes(policy.strategy), `estrategia inválida en ${key}`);
  }
  assert.equal(USER_REFERENCE_POLICIES.find((p) => p.table === 'orders' && p.column === 'created_by').strategy, 'reassign');
});

test('consolidateDuplicateUser valida argumentos antes de tocar la base', async () => {
  await assert.rejects(() => consolidateDuplicateUser({}), /database requerido/);
  await assert.rejects(
    () => consolidateDuplicateUser({ database: {}, keep: {}, duplicate: { id: 'b' } }),
    /keep.id y duplicate.id/,
  );
  await assert.rejects(
    () => consolidateDuplicateUser({ database: {}, keep: { id: 'a' }, duplicate: {} }),
    /keep.id y duplicate.id/,
  );
  await assert.rejects(
    () => consolidateDuplicateUser({ database: {}, keep: { id: 'a' }, duplicate: { id: 'a' } }),
    /no pueden ser la misma/,
  );
});
