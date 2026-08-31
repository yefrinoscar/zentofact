export const SHIPPING_CARRIERS = [
  { value: 'marvisuar', label: 'Marvisuar' },
  { value: 'shaloom', label: 'Shaloom' },
  { value: 'dinsides', label: 'Dinsides' },
  // El valor `nosotros` está persistido en pedidos y consultado por SQL; solo cambia la etiqueta.
  { value: 'nosotros', label: 'Express' },
] as const;

export type ShippingCarrier = (typeof SHIPPING_CARRIERS)[number]['value'];

const LABELS: Record<string, string> = Object.fromEntries(
  SHIPPING_CARRIERS.map((carrier) => [carrier.value, carrier.label]),
);

export function shippingCarrierLabel(value?: string | null) {
  return LABELS[String(value || '').trim()] || '';
}
