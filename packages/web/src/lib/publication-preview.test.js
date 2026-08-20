import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNPUBLISH_CONFIRMATION_TEXT,
  canConfirmUnpublish,
  publicationPreviewCopy,
  simulatePublicationPreview,
} from './publication-preview.ts';

test('unpublish confirmation only accepts DESPUBLICAR', () => {
  assert.equal(UNPUBLISH_CONFIRMATION_TEXT, 'DESPUBLICAR');
  assert.equal(canConfirmUnpublish('DESPUBLICAR'), true);
  assert.equal(canConfirmUnpublish('despublicar'), false);
  assert.equal(canConfirmUnpublish(' DESPUBLICAR'), false);
  assert.equal(canConfirmUnpublish('DESPUBLICAR '), false);
});

test('publication preview never marks a seller mutation', () => {
  const published = simulatePublicationPreview({ kind: 'publish', sellerName: 'LIMBO' });
  assert.equal(published.mutated, false);
  assert.equal(published.error, undefined);
  assert.equal(
    published.message,
    'Publicación preparada para LIMBO. No se envió ningún cambio al canal.',
  );

  const unpublished = simulatePublicationPreview({
    kind: 'unpublish',
    confirmation: 'DESPUBLICAR',
  });
  assert.equal(unpublished.mutated, false);
  assert.equal(
    unpublished.message,
    'Simulación completada. La publicación continúa activa y no se envió ningún cambio.',
  );
});

test('unpublish preview stays visual-only when the confirmation is missing', () => {
  const preview = simulatePublicationPreview({ kind: 'unpublish', confirmation: 'ok' });
  assert.equal(preview.mutated, false);
  assert.equal(preview.message, undefined);
  assert.equal(preview.error, 'Escribe DESPUBLICAR para confirmar.');
});

test('publication preview copy tells the operator it only simulates', () => {
  assert.equal(publicationPreviewCopy('publish').submit, 'Simular publicación');
  assert.match(publicationPreviewCopy('publish').subtitle, /solo simula/);
  assert.equal(publicationPreviewCopy('unpublish').title, 'Confirmar despublicación');
  assert.equal(publicationPreviewCopy('unpublish').submit, 'Simular despublicación');
});
