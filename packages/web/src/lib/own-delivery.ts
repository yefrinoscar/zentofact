import limaOwnDelivery from '../../../../shared/lima-own-delivery.json' with { type: 'json' };

type LimaOwnDeliveryConfig = {
  department: string;
  province: string;
  districts: Array<{ ubigeo: string; name: string }>;
  distanceTiers: Array<{ maxDistanceKm: number; amount: number }>;
};

const config = limaOwnDelivery satisfies LimaOwnDeliveryConfig;

export const OWN_DELIVERY_CARRIER = 'movilidad_propia';

export type DeliveryLocation = {
  department: string;
  province: string;
  district: string;
  ubigeo: string;
};

export type OwnDeliveryQuote = {
  distanceKm: number;
  maxDistanceKm: number;
  amount: number;
};

export const DEFAULT_DELIVERY_LOCATION: DeliveryLocation = {
  department: config.department,
  province: config.province,
  district: '',
  ubigeo: '',
};

export const OWN_DELIVERY_DISTANCE_TIERS = config.distanceTiers;
export const LIMA_METROPOLITAN_DISTRICTS = config.districts;

function districtKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-PE')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function deliveryProvincesForDepartment(department: string) {
  return districtKey(department) === districtKey(config.department) ? [config.province] : [];
}

export function districtsForDeliveryLocation(location: Pick<DeliveryLocation, 'department' | 'province'>) {
  const matchesDepartment = districtKey(location.department) === districtKey(config.department);
  const matchesProvince = districtKey(location.province) === districtKey(config.province);
  return matchesDepartment && matchesProvince ? config.districts : [];
}

export function findLimaMetropolitanDistrict(value: string) {
  const key = districtKey(value);
  if (!key) return null;
  const exactMatch = config.districts.find((district) => districtKey(district.name) === key);
  if (exactMatch) return exactMatch;
  const partialMatches = config.districts.filter((district) => {
    const candidate = districtKey(district.name);
    return candidate.includes(key) || key.includes(candidate);
  });
  return partialMatches.length === 1 ? partialMatches[0] : null;
}

export function ownDeliveryQuote(distanceKm: number | null | undefined): OwnDeliveryQuote | null {
  const parsedDistance = Number(distanceKm);
  if (!Number.isFinite(parsedDistance) || parsedDistance <= 0) return null;
  const tier = config.distanceTiers.find((candidate) => parsedDistance <= candidate.maxDistanceKm);
  if (!tier) return null;
  return {
    distanceKm: parsedDistance,
    maxDistanceKm: tier.maxDistanceKm,
    amount: tier.amount,
  };
}
