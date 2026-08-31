import { OWN_FLEET_ORIGIN, type OwnFleetOrigin } from './own-fleet-shipping.ts';

export type PickupPoint = Pick<OwnFleetOrigin, 'address' | 'lat' | 'lng' | 'pickupFrom' | 'pickupTo'>;

export function pickupPoint(origin?: Partial<PickupPoint> | null): PickupPoint {
  return {
    address: String(origin?.address || '').trim() || OWN_FLEET_ORIGIN.address,
    lat: Number.isFinite(Number(origin?.lat)) ? Number(origin?.lat) : OWN_FLEET_ORIGIN.lat,
    lng: Number.isFinite(Number(origin?.lng)) ? Number(origin?.lng) : OWN_FLEET_ORIGIN.lng,
    pickupFrom: String(origin?.pickupFrom || '').trim() || OWN_FLEET_ORIGIN.pickupFrom,
    pickupTo: String(origin?.pickupTo || '').trim() || OWN_FLEET_ORIGIN.pickupTo,
  };
}

/** Enlace corto de Google Maps: abre el pin exacto en el celular del cliente. */
export function pickupMapsUrl(point: Pick<PickupPoint, 'lat' | 'lng'>) {
  return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`;
}

/** `07:00` se lee como `7:00 a. m.`, que es como lo escribe el vendedor. */
export function formatPickupHour(value: string) {
  const [rawHour, rawMinute] = String(value || '').split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  const suffix = hour < 12 ? 'a. m.' : 'p. m.';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function pickupHours(point: Pick<PickupPoint, 'pickupFrom' | 'pickupTo'>) {
  const from = formatPickupHour(point.pickupFrom);
  const to = formatPickupHour(point.pickupTo);
  return from && to ? `${from} a ${to}` : '';
}

/** Texto listo para pegarle al cliente por WhatsApp: dónde, a qué hora y el mapa. */
export function pickupMessage(origin?: Partial<PickupPoint> | null) {
  const point = pickupPoint(origin);
  return [
    `Recoge aquí: ${point.address}`,
    `Horario: ${pickupHours(point)}`,
    pickupMapsUrl(point),
  ].join('\n');
}
