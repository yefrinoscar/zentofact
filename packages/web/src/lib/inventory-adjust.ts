export type InventoryAdjustMode = 'absolute' | 'delta';

export type InventoryAdjustForm = {
  mode: InventoryAdjustMode;
  value: string;
  reason: string;
};

const STACKED_OVERLAY_SELECTOR = [
  '[data-slot="dialog-content"]',
  '[data-slot="dialog-overlay"]',
  '[data-slot="select-content"]',
].join(', ');

export function inventoryAdjustFormFromOnHand(quantityOnHand: number | null | undefined): InventoryAdjustForm {
  const onHand = Number(quantityOnHand);
  return {
    mode: 'absolute',
    value: Number.isFinite(onHand) ? String(onHand) : '',
    reason: '',
  };
}

export function inventoryAdjustPayload(form: InventoryAdjustForm) {
  const value = Number(form.value);
  const reason = String(form.reason || '').trim();
  if (!Number.isFinite(value)) throw new Error('La cantidad debe ser un número válido.');
  if (form.mode === 'absolute') {
    if (value < 0) throw new Error('El saldo no puede ser negativo.');
    return { absoluteTarget: value, reason };
  }
  if (value === 0) throw new Error('La cantidad no puede ser cero.');
  return { delta: value, reason };
}

export function eventFromStackedOverlay(event: Event) {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(STACKED_OVERLAY_SELECTOR));
}
