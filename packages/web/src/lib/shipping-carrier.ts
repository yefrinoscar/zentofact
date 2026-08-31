export const SHIPPING_CARRIERS = [
  { value: 'marvisuar', label: 'Marvisuar' },
  { value: 'shaloom', label: 'Shaloom' },
  { value: 'dinsides', label: 'Dinsides' },
  // El valor `nosotros` está persistido en pedidos y consultado por SQL; solo cambia la etiqueta.
  { value: 'nosotros', label: 'Express' },
] as const;

export type ShippingCarrier = (typeof SHIPPING_CARRIERS)[number]['value'];

/** Marvisuar, Shaloom y Dinsides: el vendedor escribe el precio de envío. */
export const SELLER_PRICED_SHIPPING_CARRIERS = ['marvisuar', 'shaloom', 'dinsides'] as const;

export type SellerPricedShippingCarrier = (typeof SELLER_PRICED_SHIPPING_CARRIERS)[number];

const LABELS: Record<string, string> = Object.fromEntries(
  SHIPPING_CARRIERS.map((carrier) => [carrier.value, carrier.label]),
);

export function shippingCarrierLabel(value?: string | null) {
  return LABELS[String(value || '').trim()] || '';
}

export function isSellerPricedShipping(value?: string | null) {
  return (SELLER_PRICED_SHIPPING_CARRIERS as readonly string[]).includes(
    String(value || '').trim().toLowerCase(),
  );
}
