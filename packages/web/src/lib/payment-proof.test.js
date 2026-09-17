import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPaymentProof, paymentProofPreview, redactPaymentProofForList } from './payment-proof.ts';

test('detecta constancia por foto o por el flag de la lista', () => {
  assert.equal(hasPaymentProof(null), false);
  assert.equal(hasPaymentProof({ name: 'yape.jpg' }), false);
  assert.equal(hasPaymentProof({ hasData: true, name: 'yape.jpg' }), true);
  assert.equal(hasPaymentProof({ dataUrl: 'data:image/jpeg;base64,xx' }), true);
});

test('la lista conserva el nombre y quita la foto', () => {
  const redacted = redactPaymentProofForList({
    paymentMethod: 'yape_plin',
    paymentProof: { name: 'yape.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,xx' },
  });
  assert.equal(redacted.paymentProof.name, 'yape.jpg');
  assert.equal(redacted.paymentProof.hasData, true);
  assert.equal(redacted.paymentProof.dataUrl, undefined);
  assert.deepEqual(paymentProofPreview(redacted.paymentProof), {
    hasProof: true,
    name: 'yape.jpg',
    dataUrl: null,
  });
});
