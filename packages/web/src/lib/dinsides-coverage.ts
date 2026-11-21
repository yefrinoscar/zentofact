import { DINSIDES_ZONES } from './dinsides-zones.ts';
import { foldName } from './own-fleet-shipping.ts';

export const DINSIDES_CARRIER = 'dinsides' as const;
export const DINSIDES_COVERAGE_URL = 'https://dinsides.com/inicio.html#cobertura';
/** Tarifa regular de Dinsides: vale hasta este tamaño. Más grande se cotiza con ellos. */
export const DINSIDES_PACKAGE_LIMIT = 'Hasta 30 × 20 × 15 cm o 1,5 kg';
export const DINSIDES_AGENCY_AMOUNT = 5;
/** Retiro en sede Cercado (Av. Arica 1702) o Gamarra (Jr. Antonio Bazo 1284). */
export const DINSIDES_PICKUP_AMOUNT = 8;

export type DinsidesZone = { name: string; amount: number };

export type DinsidesQuote =
  | { covered: true; zone: string; amount: number }
  | { covered: false; district: string };

type PlaceLike = {
  district?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
};

/** Distritos que la búsqueda de lugares nombra distinto que Dinsides. */
const NAME_ALIASES: Record<string, string> = {
  lima: 'cercado de lima',
  cercado: 'cercado de lima',
  surco: 'santiago de surco',
  magdalena: 'magdalena del mar',
  lurigancho: 'lurigancho chosica',
  'carmen de la legua': 'carmen de la legua reynoso',
  smp: 'san martin de porres',
  sjm: 'san juan de miraflores',
  sjl: 'san juan de lurigancho',
  vmt: 'villa maria del triunfo',
};

const ZONES_BY_KEY = new Map(DINSIDES_ZONES.map(([name, amount]) => [foldName(name), { name, amount }]));

/** Lista para mostrar: de la tarifa más barata a la más cara y, en empate, por nombre. */
export const DINSIDES_ZONE_LIST: DinsidesZone[] = DINSIDES_ZONES
  .map(([name, amount]) => ({ name, amount }))
  .sort((a, b) => a.amount - b.amount || a.name.localeCompare(b.name, 'es'));

/** Busca zonas por nombre sin tildes ni mayúsculas. Acepta los alias de la búsqueda (Surco, SJL…). */
export function searchDinsidesZones(query: string, zones: DinsidesZone[] = DINSIDES_ZONE_LIST) {
  const key = foldName(query);
  if (!key) return zones;
  const alias = NAME_ALIASES[key];
  return zones.filter((zone) => {
    const name = foldName(zone.name);
    return name.includes(key) || (alias != null && name === alias);
  });
}

export const DINSIDES_MIN_AMOUNT = DINSIDES_ZONE_LIST[0]?.amount ?? 0;

function insideRing(lng: number, lat: number, ring: ReadonlyArray<readonly [number, number]>) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Zona de Dinsides que contiene el punto. Distingue sub-zonas como Huaycán o Manchay. */
export function dinsidesZoneAt(lat: number, lng: number): DinsidesZone | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const [name, amount, rings] of DINSIDES_ZONES) {
    if (rings.some((ring) => insideRing(lng, lat, ring))) return { name, amount };
  }
  return null;
}

export function dinsidesZoneByName(district?: string | null): DinsidesZone | null {
  const key = foldName(String(district || ''));
  if (!key) return null;
  return ZONES_BY_KEY.get(NAME_ALIASES[key] || key) || null;
}

/**
 * Tarifa regular de Dinsides para la dirección. Primero el punto exacto dentro de sus zonas; si el
 * punto cae fuera de los polígonos (borde, costa), el nombre del distrito.
 */
export function quoteDinsidesShipping(place?: PlaceLike | null): DinsidesQuote | null {
  if (!place) return null;
  const zone = dinsidesZoneAt(Number(place.lat), Number(place.lng)) || dinsidesZoneByName(place.district);
  if (zone) return { covered: true, zone: zone.name, amount: zone.amount };
  return { covered: false, district: String(place.district || '').trim() };
}

/** Monto para el campo de precio: sin decimales sobrantes, igual a como lo escribiría el vendedor. */
export function dinsidesAmountInput(amount: number) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}
