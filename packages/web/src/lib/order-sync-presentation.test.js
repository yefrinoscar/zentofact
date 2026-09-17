import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FULFILLMENT_LABELS,
  FULFILLMENT_TONES,
  fulfillmentLabel,
  fulfillmentTone,
  isFailedOrderSyncResult,
  orderSyncIntervalLabel,
  orderSyncLookbackLabel,
  syncResultNote,
  syncStatusLabel,
} from './order-sync-presentation.ts';

test('cada estado operativo conocido tiene un color distinto', () => {
  const statuses = Object.keys(FULFILLMENT_LABELS);
  const tones = statuses.map((status) => FULFILLMENT_TONES[status]);

  assert.equal(new Set(tones).size, statuses.length);
});

test('un estado nuevo se presenta como sin mapear y no hereda un estado operativo', () => {
  assert.equal(fulfillmentLabel('PROVIDER_NEW_STATE'), 'Sin mapear');
  assert.equal(fulfillmentTone('PROVIDER_NEW_STATE'), FULFILLMENT_TONES.unmapped);
});

test('una cuenta fallida no oculta las sincronizaciones correctas de los otros sellers', () => {
  assert.equal(syncResultNote([
    { status: 'success', failed: 0 },
    { status: 'failed', failed: 1 },
  ]), 'Incompleto');
});

test('una ejecución ya iniciada se muestra en curso', () => {
  assert.equal(syncResultNote([{ status: 'already_running' }]), 'En curso');
});

test('el intervalo y la ventana se leen en el mismo lenguaje operativo', () => {
  assert.equal(orderSyncIntervalLabel(1), '1 min');
  assert.equal(orderSyncIntervalLabel(15), '15 min');
  assert.equal(orderSyncIntervalLabel(120), '2 h');
  assert.equal(orderSyncLookbackLabel(1), '1 día');
  assert.equal(orderSyncLookbackLabel(7), '7 días');
});

test('los estados reales del backend muestran fallos totales y parciales', () => {
  assert.equal(syncStatusLabel('error'), 'Falló la sincronización');
  assert.equal(syncStatusLabel('partial'), 'Sincronización incompleta');
  assert.equal(syncResultNote([{ status: 'error' }]), 'Incompleto');
  assert.equal(syncResultNote([{ status: 'partial' }]), 'Incompleto');
  assert.equal(isFailedOrderSyncResult({ status: 'partial' }), true);
  assert.equal(isFailedOrderSyncResult({ status: 'already_running' }), false);
});
