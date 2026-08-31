export const OWN_FLEET_CARRIER = 'nosotros';

export const OWN_FLEET_ORIGIN = {
  lat: -12.0776,
  lng: -77.0905,
  address: 'Av. La Marina 2055, San Miguel',
};

export const DISTANCE_TIERS = [
  { maxKm: 10, amount: 10 },
  { maxKm: 15, amount: 20 },
  { maxKm: 25, amount: 25 },
];

export const OWN_FLEET_OUT_OF_RANGE_MESSAGE = 'Express no llega ahí. Elige Marvisuar, Shaloom o Dinsides.';
export const OUT_OF_PERU_MESSAGE = 'Esa dirección no está en el Perú.';
export const MAX_DISTANCE_AMOUNT = 25;
export const PROVINCE_DEPARTMENT_AMOUNT = 25;
export const PERU_BBOX = { minLat: -18.4, maxLat: -0.04, minLng: -81.4, maxLng: -68.6 };

const LIMA_DISTRICT_AMOUNTS = {
  'san miguel': 8,
  'magdalena del mar': 8,
  magdalena: 8,
  'pueblo libre': 8,
  lima: 8,
  cercado: 8,
  'cercado de lima': 8,
  brena: 8,
  'jesus maria': 8,
  lince: 12,
  'la victoria': 12,
  'san isidro': 12,
  miraflores: 12,
  'san borja': 12,
  surquillo: 12,
  barranco: 12,
  rimac: 12,
  'san luis': 12,
  'santiago de surco': 16,
  surco: 16,
  chorrillos: 16,
  independencia: 16,
  'los olivos': 16,
  'san martin de porres': 16,
  smp: 16,
  'el agustino': 16,
  'santa anita': 16,
  ate: 16,
  'san juan de miraflores': 18,
  sjm: 18,
  'la molina': 18,
  'san juan de lurigancho': 20,
  sjl: 20,
  comas: 20,
  carabayllo: 20,
  'puente piedra': 20,
  'santa rosa': 20,
  ancon: 20,
  'villa el salvador': 20,
  'villa maria del triunfo': 20,
  vmt: 20,
  lurin: 20,
  pachacamac: 20,
  pucusana: 20,
  'punta hermosa': 20,
  'punta negra': 20,
  'san bartolo': 20,
  'santa maria del mar': 20,
  cieneguilla: 20,
  chaclacayo: 20,
  lurigancho: 20,
  chosica: 20,
};

const CALLAO_DISTRICT_AMOUNTS = {
  callao: 12,
  bellavista: 12,
  'carmen de la legua reynoso': 12,
  'carmen de la legua': 12,
  'la perla': 12,
  'la punta': 12,
  ventanilla: 18,
  'mi peru': 18,
};

export const METRO_SNAP_MAX_KM = 20;

export const OWN_FLEET_BEACH_KEYS = [
  'punta hermosa',
  'punta negra',
  'san bartolo',
  'santa maria del mar',
  'pucusana',
];

const DISTRICT_ALIASES = {
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

function zonePoint(district, province, department, lat, lng) {
  return { district, province, department, lat, lng };
}

/** 43 distritos de Lima y 7 del Callao. Huaral y Cañete no entran. */
export const METRO_POINTS = [
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

const DEPARTMENT_POINTS = [
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

function foldName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(distrito|provincia|departamento)\s+(de\s+la\s+|de\s+|del\s+)?/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const UNCOVERED_POINTS = [
  zonePoint('Huaral', 'Huaral', 'Lima', -11.495, -77.208),
  zonePoint('San Vicente De Cañete', 'Cañete', 'Lima', -13.077, -76.387),
  ...DEPARTMENT_POINTS.filter((place) => foldName(place.department) !== 'lima'),
];

export function inPeruBounds(lat, lng) {
  return lat >= PERU_BBOX.minLat
    && lat <= PERU_BBOX.maxLat
    && lng >= PERU_BBOX.minLng
    && lng <= PERU_BBOX.maxLng;
}

export function isInPeru(lat, lng, country) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const key = foldName(country || '');
  if (key && key !== 'pe' && key !== 'peru') return false;
  return inPeruBounds(lat, lng);
}

function titleCase(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed
    .toLocaleLowerCase('es')
    .replace(/(^|[\s/-])(\S)/g, (_, sep, char) => sep + char.toLocaleUpperCase('es'));
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function haversineKm(from, to) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a = sinLat * sinLat
    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * sinLng * sinLng;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function nearestPoint(point, places) {
  let best = null;
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

export function defaultOwnFleetConfig() {
  const beaches = new Set(OWN_FLEET_BEACH_KEYS);
  return {
    districts: METRO_POINTS.map((place) => {
      const key = foldName(place.district);
      const amount = Object.prototype.hasOwnProperty.call(LIMA_DISTRICT_AMOUNTS, key)
        ? LIMA_DISTRICT_AMOUNTS[key]
        : (Object.prototype.hasOwnProperty.call(CALLAO_DISTRICT_AMOUNTS, key) ? CALLAO_DISTRICT_AMOUNTS[key] : 20);
      return {
        key,
        name: place.district,
        province: place.province,
        department: place.department,
        lat: place.lat,
        lng: place.lng,
        amount,
        enabled: !beaches.has(key),
      };
    }),
  };
}

export function mergeOwnFleetConfig(saved) {
  const base = defaultOwnFleetConfig();
  const overrides = new Map();
  for (const row of saved?.districts || []) {
    const key = foldName(row?.key || row?.name || '');
    if (!key) continue;
    overrides.set(DISTRICT_ALIASES[key] || key, row);
  }
  return {
    districts: base.districts.map((district) => {
      const override = overrides.get(district.key);
      if (!override) return district;
      const amount = Number(override.amount);
      return {
        ...district,
        enabled: override.enabled === undefined ? district.enabled : Boolean(override.enabled),
        amount: Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : district.amount,
      };
    }),
  };
}

export function serializeOwnFleetConfig(saved) {
  return {
    districts: mergeOwnFleetConfig(saved).districts.map((district) => ({
      key: district.key,
      amount: district.amount,
      enabled: district.enabled,
    })),
  };
}

function districtSetting(name, department, config) {
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

export function placeAtCoordinates(lat, lng, configInput) {
  const config = mergeOwnFleetConfig(configInput);
  const point = { lat, lng };
  const covered = nearestPoint(point, METRO_POINTS);
  const uncovered = nearestPoint(point, UNCOVERED_POINTS);
  const coveredOk = Boolean(covered && covered.km <= METRO_SNAP_MAX_KM);
  if (coveredOk && (!uncovered || covered.km <= uncovered.km)) {
    const setting = districtSetting(covered.place.district, covered.place.department, config);
    return {
      district: covered.place.district,
      province: covered.place.province,
      department: covered.place.department,
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

export function distanceAmountForKm(km) {
  const distance = Number(km);
  if (!Number.isFinite(distance) || distance < 0) return 0;
  for (const tier of DISTANCE_TIERS) {
    if (distance <= tier.maxKm) return tier.amount;
  }
  return MAX_DISTANCE_AMOUNT;
}

function lookupDistrict(name, department, config) {
  const setting = districtSetting(name, department, config);
  if (!setting || !setting.enabled) return null;
  const kind = foldName(setting.department) === 'callao' ? 'callao_district' : 'lima_district';
  return { kind, name: setting.name, amount: setting.amount };
}

export function resolveShippingZone(place = {}, configInput) {
  const config = mergeOwnFleetConfig(configInput);
  const districtHit = lookupDistrict(place.district, place.department, config)
    || (foldName(place.province) && foldName(place.province) !== 'lima'
      ? lookupDistrict(place.province, place.department, config)
      : null);

  if (districtHit) {
    return {
      zone: { kind: districtHit.kind, name: districtHit.name },
      amount: districtHit.amount,
    };
  }

  const department = titleCase(place.department || place.province);
  if (department) {
    return {
      zone: { kind: 'department', name: department },
      amount: PROVINCE_DEPARTMENT_AMOUNT,
    };
  }

  return {
    zone: { kind: 'unknown', name: '' },
    amount: 0,
  };
}

export function quoteOwnFleetShipping(destination, configInput) {
  if (!destination) return null;
  const config = mergeOwnFleetConfig(configInput);
  const lat = Number(destination.lat);
  const lng = Number(destination.lng);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  const atPin = hasPoint ? placeAtCoordinates(lat, lng, config) : null;
  const distanceKm = hasPoint
    ? roundMoney(haversineKm(OWN_FLEET_ORIGIN, { lat, lng }))
    : 0;
  if (atPin && atPin.reachable === false) {
    const label = atPin.district || atPin.department || '';
    return {
      charged: false,
      zone: { kind: 'out_of_range', name: label },
      zoneLabel: label,
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
      districtAmount: 0,
      distanceKm,
      distanceAmount: 0,
      total: 0,
    };
  }
  const distanceAmount = hasPoint ? distanceAmountForKm(distanceKm) : 0;
  const districtAmount = zoneQuote.amount;
  return {
    charged: true,
    zone: zoneQuote.zone,
    zoneLabel: zoneQuote.zone.name,
    districtAmount,
    distanceKm,
    distanceAmount,
    total: roundMoney(districtAmount + distanceAmount),
  };
}

export function applyOwnFleetShipping(order, configInput) {
  const shipping = order?.shipping && typeof order.shipping === 'object' ? order.shipping : {};
  const type = String(shipping.type || '').trim().toLowerCase();
  const carrier = String(shipping.carrier || '').trim().toLowerCase();
  if (type !== 'envio' || carrier !== OWN_FLEET_CARRIER) {
    return order;
  }
  const lat = Number(shipping.lat);
  const lng = Number(shipping.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Busca el distrito o el departamento de envío.');
  }
  if (!isInPeru(lat, lng)) {
    throw new Error(OUT_OF_PERU_MESSAGE);
  }
  const atPin = placeAtCoordinates(lat, lng, configInput);
  const quote = quoteOwnFleetShipping({
    ...atPin,
    lat,
    lng,
  }, configInput);
  if (!quote?.charged) {
    throw new Error(OWN_FLEET_OUT_OF_RANGE_MESSAGE);
  }
  const products = Number(order.subtotal) || 0;
  return {
    ...order,
    shippingAmount: quote.total,
    total: roundMoney(products + quote.total),
    shipping: {
      ...shipping,
      district: atPin.district || '',
      province: atPin.province || '',
      department: atPin.department || '',
      districtAmount: quote.districtAmount,
      distanceAmount: quote.distanceAmount,
      distanceKm: quote.distanceKm,
      zoneKind: quote.zone.kind,
      zoneLabel: quote.zoneLabel,
    },
  };
}
