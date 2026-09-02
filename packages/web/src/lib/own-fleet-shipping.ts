export const OWN_FLEET_CARRIER = 'nosotros' as const;

/** Almacén de salida. El admin lo mueve desde Configuración → Envío propio; las distancias se recalculan solas. */
export const OWN_FLEET_ORIGIN = {
  lat: -12.154351,
  lng: -76.97931,
  address: 'C. las Almendras Mz.Z1 - Lt.5',
  pickupFrom: '07:00',
  pickupTo: '17:00',
} as const;

/**
 * Zonas de envío propio: grupos de distritos por distancia a la bodega. El pedido paga el precio
 * de su zona una sola vez; los kilómetros se muestran como dato, nunca se cobran aparte.
 * `maxKm` solo reparte los distritos la primera vez. Después el admin reasigna a mano.
 */
export const DEFAULT_OWN_FLEET_ZONES = [
  { key: 'cerca', name: 'Cerca', amount: 10, maxKm: 11 },
  { key: 'media', name: 'Media', amount: 15, maxKm: 20 },
  { key: 'lejos', name: 'Lejos', amount: 25, maxKm: Infinity },
] as const;

export const PROVINCE_DEPARTMENT_AMOUNT = 25;
export const OWN_FLEET_OUT_OF_RANGE_MESSAGE = 'Express no llega ahí. Elige Marvisuar, Shaloom o Dinsides.';
export const OWN_FLEET_COVERAGE_HINT = 'Reparto propio. Solo Lima metropolitana.';
export const OUT_OF_PERU_MESSAGE = 'Esa dirección no está en el Perú.';

/** Caja que cubre el territorio peruano. Un país vecino puede colarse; el país de Google lo corta. */
export const PERU_BBOX = { minLat: -18.4, maxLat: -0.04, minLng: -81.4, maxLng: -68.6 };

const GENERIC_LIMA_DISTRICT = new Set(['lima', 'cercado', 'cercado de lima']);

/** Playas del sur: por defecto no hay movilidad propia. El admin puede encenderlas. */
export const OWN_FLEET_BEACH_KEYS = [
  'punta hermosa',
  'punta negra',
  'san bartolo',
  'santa maria del mar',
  'pucusana',
] as const;

const DISTRICT_ALIASES: Record<string, string> = {
  surco: 'santiago de surco',
  magdalena: 'magdalena del mar',
  cercado: 'cercado de lima',
  lima: 'cercado de lima',
  smp: 'san martin de porres',
  sjm: 'san juan de miraflores',
  sjl: 'san juan de lurigancho',
  vmt: 'villa maria del triunfo',
  chosica: 'lurigancho',
  'carmen de la legua reynoso': 'carmen de la legua',
};

/** Grupo de distritos con un solo precio. El admin la renombra y le cambia el precio. */
export type OwnFleetZone = {
  key: string;
  name: string;
  amount: number;
};

/** Punto desde el que sale el reparto. Mover el pin recalcula la distancia de cada distrito. */
export type OwnFleetOrigin = {
  address: string;
  lat: number;
  lng: number;
  /** Horario de recojo en tienda, formato HH:MM. */
  pickupFrom: string;
  pickupTo: string;
};

export type OwnFleetDistrictSetting = {
  key: string;
  name: string;
  province: string;
  department: string;
  lat: number;
  lng: number;
  distanceKm: number;
  /** Zona a la que pertenece. Manda sobre `amount`. */
  zone: string;
  /** Precio efectivo, copiado de la zona. */
  amount: number;
  enabled: boolean;
};

export type OwnFleetConfig = {
  origin: OwnFleetOrigin;
  zones: OwnFleetZone[];
  districts: OwnFleetDistrictSetting[];
};

export type OwnFleetConfigInput = {
  origin?: { address?: string; lat?: number; lng?: number; pickupFrom?: string; pickupTo?: string };
  zones?: Array<{ key?: string; name?: string; amount?: number }>;
  /** `amount` solo llega en configuraciones viejas, de cuando el precio era por distrito. */
  districts?: Array<{ key?: string; name?: string; zone?: string; amount?: number; enabled?: boolean }>;
};

/** Centroides de Lima metropolitana: 43 distritos de Lima y 7 del Callao. Huaral y Cañete no entran. */
export const METRO_SNAP_MAX_KM = 20;

type ZonePoint = {
  district: string;
  province: string;
  department: string;
  lat: number;
  lng: number;
};

function zonePoint(
  district: string,
  province: string,
  department: string,
  lat: number,
  lng: number,
): ZonePoint {
  return { district, province, department, lat, lng };
}

export const METRO_POINTS: ZonePoint[] = [
  zonePoint('San Miguel', 'Lima', 'Lima', -12.0776, -77.0905),
  zonePoint('Magdalena Del Mar', 'Lima', 'Lima', -12.095, -77.07),
  zonePoint('Pueblo Libre', 'Lima', 'Lima', -12.074, -77.062),
  zonePoint('Cercado De Lima', 'Lima', 'Lima', -12.0464, -77.0428),
  zonePoint('Breña', 'Lima', 'Lima', -12.058, -77.05),
  zonePoint('Jesús María', 'Lima', 'Lima', -12.078, -77.043),
  zonePoint('Lince', 'Lima', 'Lima', -12.087, -77.036),
  zonePoint('La Victoria', 'Lima', 'Lima', -12.065, -77.016),
  zonePoint('San Isidro', 'Lima', 'Lima', -12.098, -77.035),
  zonePoint('Miraflores', 'Lima', 'Lima', -12.121, -77.029),
  zonePoint('San Borja', 'Lima', 'Lima', -12.096, -76.996),
  zonePoint('Surquillo', 'Lima', 'Lima', -12.114, -77.021),
  zonePoint('Barranco', 'Lima', 'Lima', -12.144, -77.02),
  zonePoint('Rímac', 'Lima', 'Lima', -12.042, -77.03),
  zonePoint('San Luis', 'Lima', 'Lima', -12.075, -76.995),
  zonePoint('Santiago De Surco', 'Lima', 'Lima', -12.135, -76.995),
  zonePoint('Chorrillos', 'Lima', 'Lima', -12.168, -77.018),
  zonePoint('Independencia', 'Lima', 'Lima', -11.99, -77.05),
  zonePoint('Los Olivos', 'Lima', 'Lima', -11.959, -77.076),
  zonePoint('San Martín De Porres', 'Lima', 'Lima', -12.03, -77.061),
  zonePoint('El Agustino', 'Lima', 'Lima', -12.048, -76.995),
  zonePoint('Santa Anita', 'Lima', 'Lima', -12.044, -76.971),
  zonePoint('Ate', 'Lima', 'Lima', -12.039, -76.92),
  zonePoint('San Juan De Miraflores', 'Lima', 'Lima', -12.162, -76.97),
  zonePoint('La Molina', 'Lima', 'Lima', -12.079, -76.922),
  zonePoint('San Juan De Lurigancho', 'Lima', 'Lima', -12.002, -76.993),
  zonePoint('Comas', 'Lima', 'Lima', -11.932, -77.048),
  zonePoint('Carabayllo', 'Lima', 'Lima', -11.873, -77.032),
  zonePoint('Puente Piedra', 'Lima', 'Lima', -11.867, -77.076),
  zonePoint('Santa Rosa', 'Lima', 'Lima', -11.796, -77.156),
  zonePoint('Ancón', 'Lima', 'Lima', -11.739, -77.15),
  zonePoint('Villa El Salvador', 'Lima', 'Lima', -12.213, -76.937),
  zonePoint('Villa María Del Triunfo', 'Lima', 'Lima', -12.162, -76.943),
  zonePoint('Lurín', 'Lima', 'Lima', -12.274, -76.87),
  zonePoint('Pachacámac', 'Lima', 'Lima', -12.229, -76.859),
  zonePoint('Pucusana', 'Lima', 'Lima', -12.481, -76.797),
  zonePoint('Punta Hermosa', 'Lima', 'Lima', -12.333, -76.826),
  zonePoint('Punta Negra', 'Lima', 'Lima', -12.365, -76.795),
  zonePoint('San Bartolo', 'Lima', 'Lima', -12.388, -76.778),
  zonePoint('Santa María Del Mar', 'Lima', 'Lima', -12.408, -76.774),
  zonePoint('Cieneguilla', 'Lima', 'Lima', -12.119, -76.814),
  zonePoint('Chaclacayo', 'Lima', 'Lima', -11.996, -76.769),
  zonePoint('Lurigancho', 'Lima', 'Lima', -11.937, -76.709),
  zonePoint('Callao', 'Callao', 'Callao', -12.056, -77.118),
  zonePoint('Bellavista', 'Callao', 'Callao', -12.062, -77.111),
  zonePoint('Carmen De La Legua', 'Callao', 'Callao', -12.039, -77.09),
  zonePoint('La Perla', 'Callao', 'Callao', -12.07, -77.115),
  zonePoint('La Punta', 'Callao', 'Callao', -12.072, -77.163),
  zonePoint('Ventanilla', 'Callao', 'Callao', -11.877, -77.127),
  zonePoint('Mi Perú', 'Callao', 'Callao', -11.855, -77.125),
];

const DEPARTMENT_POINTS: ZonePoint[] = [
  zonePoint('', 'Lima', 'Lima', -12.0464, -77.0428),
  zonePoint('', 'Chachapoyas', 'Amazonas', -6.229, -77.871),
  zonePoint('', 'Huaraz', 'Áncash', -9.528, -77.528),
  zonePoint('', 'Abancay', 'Apurímac', -13.634, -72.881),
  zonePoint('Arequipa', 'Arequipa', 'Arequipa', -16.409, -71.537),
  zonePoint('', 'Huamanga', 'Ayacucho', -13.158, -74.223),
  zonePoint('', 'Cajamarca', 'Cajamarca', -7.164, -78.51),
  zonePoint('', 'Cusco', 'Cusco', -13.532, -71.967),
  zonePoint('', 'Huancavelica', 'Huancavelica', -12.787, -74.973),
  zonePoint('', 'Huánuco', 'Huánuco', -9.93, -76.242),
  zonePoint('', 'Ica', 'Ica', -14.068, -75.729),
  zonePoint('', 'Huancayo', 'Junín', -12.065, -75.205),
  zonePoint('', 'Trujillo', 'La Libertad', -8.112, -79.029),
  zonePoint('', 'Chiclayo', 'Lambayeque', -6.771, -79.841),
  zonePoint('', 'Maynas', 'Loreto', -3.749, -73.254),
  zonePoint('', 'Tambopata', 'Madre De Dios', -12.593, -69.189),
  zonePoint('', 'Mariscal Nieto', 'Moquegua', -17.194, -70.935),
  zonePoint('', 'Pasco', 'Pasco', -10.667, -76.257),
  zonePoint('', 'Piura', 'Piura', -5.194, -80.632),
  zonePoint('', 'Puno', 'Puno', -15.84, -70.021),
  zonePoint('', 'Moyobamba', 'San Martín', -6.034, -76.974),
  zonePoint('', 'Tacna', 'Tacna', -18.014, -70.253),
  zonePoint('', 'Tumbes', 'Tumbes', -3.566, -80.455),
  zonePoint('', 'Coronel Portillo', 'Ucayali', -8.379, -74.554),
];

const UNCOVERED_POINTS: ZonePoint[] = [
  zonePoint('Huaral', 'Huaral', 'Lima', -11.495, -77.208),
  zonePoint('San Vicente De Cañete', 'Cañete', 'Lima', -13.077, -76.387),
  ...DEPARTMENT_POINTS.filter((place) => foldName(place.department) !== 'lima'),
];

function nearestPoint(point: { lat: number; lng: number }, places: ZonePoint[]) {
  let best: ZonePoint | null = null;
  let bestKm = Infinity;
  for (const place of places) {
    const km = haversineKm(point, place);
    if (km < bestKm) {
      best = place;
      bestKm = km;
    }
  }
  return best ? { place: best, km: bestKm } : null;
}

export function zoneKey(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

export function districtDistanceKm(
  place: { lat: number; lng: number },
  origin: { lat: number; lng: number } = OWN_FLEET_ORIGIN,
) {
  return roundMoney(haversineKm(origin, place));
}

export function defaultZoneFor(distanceKm: number) {
  return DEFAULT_OWN_FLEET_ZONES.find((zone) => distanceKm <= zone.maxKm)
    ?? DEFAULT_OWN_FLEET_ZONES[DEFAULT_OWN_FLEET_ZONES.length - 1];
}

function normalizeHour(value: unknown, fallback: string) {
  const raw = String(value || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : fallback;
}

function normalizeOrigin(saved?: OwnFleetConfigInput['origin'] | OwnFleetOrigin): OwnFleetOrigin {
  const lat = Number(saved?.lat);
  const lng = Number(saved?.lng);
  const placed = Number.isFinite(lat) && Number.isFinite(lng) && inPeruBounds(lat, lng);
  return {
    address: String(saved?.address || '').trim() || OWN_FLEET_ORIGIN.address,
    lat: placed ? lat : OWN_FLEET_ORIGIN.lat,
    lng: placed ? lng : OWN_FLEET_ORIGIN.lng,
    pickupFrom: normalizeHour(saved?.pickupFrom, OWN_FLEET_ORIGIN.pickupFrom),
    pickupTo: normalizeHour(saved?.pickupTo, OWN_FLEET_ORIGIN.pickupTo),
  };
}

/** Las distancias siempre salen del almacén configurado: mover el pin las regenera todas. */
function districtsFrom(origin: OwnFleetOrigin): OwnFleetDistrictSetting[] {
  const beaches = new Set<string>(OWN_FLEET_BEACH_KEYS);
  return METRO_POINTS.map((place) => {
    const key = foldName(place.district);
    const distanceKm = districtDistanceKm(place, origin);
    const zone = defaultZoneFor(distanceKm);
    return {
      key,
      name: place.district,
      province: place.province,
      department: place.department,
      lat: place.lat,
      lng: place.lng,
      distanceKm,
      zone: zone.key,
      amount: zone.amount,
      enabled: !beaches.has(key),
    };
  });
}

export function ownFleetOriginAddress(config?: OwnFleetConfigInput | OwnFleetConfig | null) {
  return String(config?.origin?.address || '').trim() || OWN_FLEET_ORIGIN.address;
}

export function defaultOwnFleetConfig(): OwnFleetConfig {
  const origin = { ...OWN_FLEET_ORIGIN };
  return {
    origin,
    zones: DEFAULT_OWN_FLEET_ZONES.map(({ key, name, amount }) => ({ key, name, amount })),
    districts: districtsFrom(origin),
  };
}

function normalizeZones(rows?: OwnFleetConfigInput['zones'] | OwnFleetZone[]): OwnFleetZone[] {
  const zones: OwnFleetZone[] = [];
  const seen = new Set<string>();
  for (const row of rows || []) {
    const key = zoneKey(row?.key);
    if (!key || seen.has(key)) continue;
    const amount = Number(row?.amount);
    zones.push({
      key,
      name: String(row?.name || '').trim() || key,
      amount: Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : 0,
    });
    seen.add(key);
  }
  return zones;
}

/** Config vieja: el precio vivía en cada distrito. Cada precio distinto se vuelve una zona. */
function zonesFromAmounts(amounts: number[]): OwnFleetZone[] {
  const distinct = [...new Set(amounts.map(roundMoney))].sort((first, second) => first - second);
  return distinct.map((amount, index) => ({
    key: `zona-${index + 1}`,
    name: `Zona ${index + 1}`,
    amount,
  }));
}

export function mergeOwnFleetConfig(saved?: OwnFleetConfigInput | OwnFleetConfig | null): OwnFleetConfig {
  const origin = normalizeOrigin(saved?.origin);
  const base = { origin, zones: defaultOwnFleetConfig().zones, districts: districtsFrom(origin) };
  const overrides = new Map<string, { zone?: string; amount?: number; enabled?: boolean }>();
  for (const row of saved?.districts || []) {
    const key = foldName(row.key || row.name || '');
    if (!key) continue;
    overrides.set(DISTRICT_ALIASES[key] || key, row);
  }

  const savedAmount = (district: OwnFleetDistrictSetting) => {
    const amount = Number(overrides.get(district.key)?.amount);
    return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : district.amount;
  };

  // Sin zonas guardadas hay dos casos: config vieja con precio por distrito, o nada guardado aún.
  const declared = normalizeZones(saved?.zones);
  const legacyPricing = [...overrides.values()].some((row) => Number.isFinite(Number(row?.amount)));
  const zones = declared.length
    ? declared
    : legacyPricing
      ? zonesFromAmounts(base.districts.map(savedAmount))
      : base.zones;
  const byKey = new Map(zones.map((zone) => [zone.key, zone]));
  const fallback = zones[0];

  return {
    origin,
    zones,
    districts: base.districts.map((district) => {
      const override = overrides.get(district.key);
      const amount = savedAmount(district);
      const zone = byKey.get(zoneKey(override?.zone))
        ?? zones.find((candidate) => candidate.amount === amount)
        ?? byKey.get(district.zone)
        ?? fallback;
      return {
        ...district,
        zone: zone.key,
        amount: zone.amount,
        enabled: override?.enabled === undefined ? district.enabled : Boolean(override.enabled),
      };
    }),
  };
}

export function serializeOwnFleetConfig(
  saved?: OwnFleetConfigInput | OwnFleetConfig | null,
): OwnFleetConfigInput {
  const config = mergeOwnFleetConfig(saved);
  return {
    origin: { ...config.origin },
    zones: config.zones.map((zone) => ({ key: zone.key, name: zone.name, amount: zone.amount })),
    // La distancia no se guarda: se recalcula desde el almacén cada vez que se lee la config.
    districts: config.districts.map((district) => ({
      key: district.key,
      zone: district.zone,
      enabled: district.enabled,
    })),
  };
}

function districtSetting(
  name: string,
  department: string,
  config: OwnFleetConfig,
): OwnFleetDistrictSetting | null {
  const folded = foldName(name);
  const key = DISTRICT_ALIASES[folded] || folded;
  if (!key) return null;
  const dept = foldName(department);
  return config.districts.find((district) => {
    if (district.key !== key) return false;
    if (!dept) return true;
    return foldName(district.department) === dept;
  }) || null;
}

/** Distrito donde está el pin. Fuera de cobertura no hay movilidad propia. */
export function placeAtCoordinates(
  lat: number,
  lng: number,
  configInput?: OwnFleetConfigInput | OwnFleetConfig | null,
): OwnFleetDestination {
  const config = mergeOwnFleetConfig(configInput);
  const point = { lat, lng };
  const covered = nearestPoint(point, METRO_POINTS);
  const uncovered = nearestPoint(point, UNCOVERED_POINTS);
  const coveredOk = Boolean(covered && covered.km <= METRO_SNAP_MAX_KM);
  if (coveredOk && (!uncovered || covered!.km <= uncovered.km)) {
    const setting = districtSetting(covered!.place.district, covered!.place.department, config);
    return {
      district: covered!.place.district,
      province: covered!.place.province,
      department: covered!.place.department,
      reachable: Boolean(setting?.enabled),
      lat,
      lng,
    };
  }
  if (uncovered) {
    return {
      district: uncovered.place.district,
      province: uncovered.place.province,
      department: uncovered.place.department,
      reachable: false,
      lat,
      lng,
    };
  }
  return { lat, lng, reachable: false };
}

export type ShippingZoneKind = 'lima_district' | 'callao_district' | 'department' | 'out_of_range' | 'unknown';

export type ShippingZone = {
  kind: ShippingZoneKind;
  name: string;
};

export type PeruPlace = {
  district: string;
  province: string;
  department: string;
};

export type OwnFleetDestination = {
  district?: string | null;
  province?: string | null;
  department?: string | null;
  reachable?: boolean | null;
  lat?: number | null;
  lng?: number | null;
};

export type OwnFleetQuote = {
  charged: boolean;
  /** Clasificación geográfica del destino. No es la zona de precio. */
  zone: ShippingZone;
  /** Nombre del distrito resuelto. */
  zoneLabel: string;
  priceZoneKey: string;
  priceZoneName: string;
  /** Precio de la zona. Se llama así porque es el campo ya persistido en los pedidos. */
  districtAmount: number;
  /** Informativo: los kilómetros no se cobran. */
  distanceKm: number;
  /** Siempre 0 desde que el envío se cobra por zona. Los pedidos viejos conservan su recargo. */
  distanceAmount: number;
  total: number;
};

type AddressComponent = {
  long_name?: string;
  longName?: string;
  longText?: string;
  short_name?: string;
  shortName?: string;
  shortText?: string;
  types?: string[];
};

export function inPeruBounds(lat: number, lng: number) {
  return lat >= PERU_BBOX.minLat
    && lat <= PERU_BBOX.maxLat
    && lng >= PERU_BBOX.minLng
    && lng <= PERU_BBOX.maxLng;
}

export function countryFromComponents(components: AddressComponent[] = []) {
  const match = components.find((item) => (item.types || []).includes('country'));
  if (!match) return '';
  const short = String(match.short_name || match.shortName || match.shortText || '').trim();
  const long = String(match.long_name || match.longName || match.longText || '').trim();
  return short || long;
}

export function isInPeru(lat: number, lng: number, country?: string | null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const key = foldName(country || '');
  if (key && key !== 'pe' && key !== 'peru') return false;
  return inPeruBounds(lat, lng);
}

export function foldName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(distrito|provincia|departamento)\s+(de\s+la\s+|de\s+|del\s+)?/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleCase(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed
    .toLocaleLowerCase('es')
    .replace(/(^|[\s/-])(\S)/g, (_, sep, char) => sep + char.toLocaleUpperCase('es'));
}

function pickComponent(components: AddressComponent[], ...types: string[]) {
  const match = components.find((item) => types.some((type) => (item.types || []).includes(type)));
  return String(match?.long_name || match?.longName || match?.longText || '').trim();
}

function knownDistrictName(name: string, department: string) {
  const key = foldName(name);
  if (!key || GENERIC_LIMA_DISTRICT.has(key)) return '';
  return districtSetting(name, department, mergeOwnFleetConfig()) ? titleCase(name) : '';
}

export function peruPlaceFromComponents(components: AddressComponent[] = []): PeruPlace {
  const department = pickComponent(components, 'administrative_area_level_1');
  const province = pickComponent(components, 'administrative_area_level_2');
  const namedDistrict = components
    .map((item) => knownDistrictName(String(item.long_name || item.longName || item.longText || ''), department))
    .find(Boolean) || '';
  const sublocality = pickComponent(components, 'sublocality_level_1', 'sublocality', 'neighborhood', 'administrative_area_level_3');
  const locality = pickComponent(components, 'locality');
  const district = namedDistrict
    || knownDistrictName(sublocality, department)
    || knownDistrictName(locality, department)
    || sublocality
    || (foldName(locality) === foldName(department) ? '' : locality)
    || locality;
  return {
    district: titleCase(district),
    province: titleCase(province),
    department: titleCase(department),
  };
}

export function haversineKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a = sinLat * sinLat
    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * sinLng * sinLng;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function lookupDistrict(
  name: string,
  department: string,
  config: OwnFleetConfig,
) {
  const setting = districtSetting(name, department, config);
  if (!setting || !setting.enabled) return null;
  const kind = foldName(setting.department) === 'callao' ? 'callao_district' as const : 'lima_district' as const;
  const priceZone = config.zones.find((zone) => zone.key === setting.zone) || null;
  return { kind, name: setting.name, amount: setting.amount, priceZone };
}

export function resolveShippingZone(
  place: OwnFleetDestination | PeruPlace,
  configInput?: OwnFleetConfigInput | OwnFleetConfig | null,
): { zone: ShippingZone; amount: number; priceZone: OwnFleetZone | null } {
  const config = mergeOwnFleetConfig(configInput);
  const districtHit = lookupDistrict(place.district || '', place.department || '', config)
    || (foldName(place.province || '') && foldName(place.province || '') !== 'lima'
      ? lookupDistrict(place.province || '', place.department || '', config)
      : null);

  if (districtHit) {
    return {
      zone: { kind: districtHit.kind, name: districtHit.name },
      amount: districtHit.amount,
      priceZone: districtHit.priceZone,
    };
  }

  const department = titleCase(place.department || place.province || '');
  if (department) {
    return {
      zone: { kind: 'department', name: department },
      amount: PROVINCE_DEPARTMENT_AMOUNT,
      priceZone: null,
    };
  }

  return {
    zone: { kind: 'unknown', name: '' },
    amount: 0,
    priceZone: null,
  };
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function quoteOwnFleetShipping(
  destination: OwnFleetDestination | null | undefined,
  configInput?: OwnFleetConfigInput | OwnFleetConfig | null,
): OwnFleetQuote | null {
  if (!destination) return null;
  const config = mergeOwnFleetConfig(configInput);
  const lat = Number(destination.lat);
  const lng = Number(destination.lng);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  const atPin = hasPoint ? placeAtCoordinates(lat, lng, config) : null;
  const distanceKm = hasPoint ? districtDistanceKm({ lat, lng }, config.origin) : 0;
  if (atPin && atPin.reachable === false) {
    const label = atPin.district || atPin.department || '';
    return {
      charged: false,
      zone: { kind: 'out_of_range', name: label },
      zoneLabel: label,
      priceZoneKey: '',
      priceZoneName: '',
      districtAmount: 0,
      distanceKm,
      distanceAmount: 0,
      total: 0,
    };
  }
  const zoneQuote = resolveShippingZone(atPin && (atPin.district || atPin.department) ? atPin : {
    district: destination.district || '',
    province: destination.province || '',
    department: destination.department || '',
  }, config);
  const reachable = zoneQuote.zone.kind === 'lima_district' || zoneQuote.zone.kind === 'callao_district';
  if (!reachable) {
    return {
      charged: false,
      zone: { kind: 'out_of_range', name: zoneQuote.zone.name },
      zoneLabel: zoneQuote.zone.name,
      priceZoneKey: '',
      priceZoneName: '',
      districtAmount: 0,
      distanceKm,
      distanceAmount: 0,
      total: 0,
    };
  }
  // Un solo cobro: el precio de la zona. Los kilómetros solo se informan.
  const districtAmount = zoneQuote.amount;
  return {
    charged: true,
    zone: zoneQuote.zone,
    zoneLabel: zoneQuote.zone.name,
    priceZoneKey: zoneQuote.priceZone?.key || '',
    priceZoneName: zoneQuote.priceZone?.name || '',
    districtAmount,
    distanceKm,
    distanceAmount: 0,
    total: roundMoney(districtAmount),
  };
}

export function saleTotals(
  productsTotal: number,
  quote: OwnFleetQuote | null,
  sellerShipping = 0,
) {
  const products = roundMoney(productsTotal);
  if (quote?.charged) {
    const districtAmount = quote.districtAmount;
    const distanceAmount = quote.distanceAmount;
    const shipping = roundMoney(districtAmount + distanceAmount);
    return {
      products,
      districtAmount,
      distanceAmount,
      shipping,
      total: roundMoney(products + shipping),
    };
  }
  const shipping = roundMoney(Math.max(0, Number(sellerShipping) || 0));
  return {
    products,
    districtAmount: 0,
    distanceAmount: 0,
    shipping,
    total: roundMoney(products + shipping),
  };
}
