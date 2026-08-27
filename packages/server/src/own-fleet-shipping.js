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

export const MAX_DISTANCE_AMOUNT = 25;
export const PROVINCE_DEPARTMENT_AMOUNT = 25;

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
  ancon: 20,
  'santa rosa': 20,
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

function foldName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(distrito|provincia|departamento)\s+(de\s+la\s+|de\s+|del\s+)?/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

export function distanceAmountForKm(km) {
  const distance = Number(km);
  if (!Number.isFinite(distance) || distance < 0) return 0;
  for (const tier of DISTANCE_TIERS) {
    if (distance <= tier.maxKm) return tier.amount;
  }
  return MAX_DISTANCE_AMOUNT;
}

function lookupDistrict(name, department) {
  const key = foldName(name);
  if (!key) return null;
  const dept = foldName(department);
  if (Object.prototype.hasOwnProperty.call(LIMA_DISTRICT_AMOUNTS, key) && (!dept || dept === 'lima')) {
    return { kind: 'lima_district', name: titleCase(name), amount: LIMA_DISTRICT_AMOUNTS[key] };
  }
  if (Object.prototype.hasOwnProperty.call(CALLAO_DISTRICT_AMOUNTS, key) && (!dept || dept === 'callao')) {
    return { kind: 'callao_district', name: titleCase(name), amount: CALLAO_DISTRICT_AMOUNTS[key] };
  }
  return null;
}

export function resolveShippingZone(place = {}) {
  const districtHit = lookupDistrict(place.district, place.department)
    || (foldName(place.province) && foldName(place.province) !== 'lima'
      ? lookupDistrict(place.province, place.department)
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

export function quoteOwnFleetShipping(destination) {
  if (!destination) return null;
  const lat = Number(destination.lat);
  const lng = Number(destination.lng);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  const zoneQuote = resolveShippingZone({
    district: destination.district || '',
    province: destination.province || '',
    department: destination.department || '',
  });
  const distanceKm = hasPoint
    ? roundMoney(haversineKm(OWN_FLEET_ORIGIN, { lat, lng }))
    : 0;
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

export function applyOwnFleetShipping(order) {
  const shipping = order?.shipping && typeof order.shipping === 'object' ? order.shipping : {};
  const type = String(shipping.type || '').trim().toLowerCase();
  const carrier = String(shipping.carrier || '').trim().toLowerCase();
  if (type !== 'envio' || carrier !== OWN_FLEET_CARRIER) {
    return order;
  }
  const lat = Number(shipping.lat);
  const lng = Number(shipping.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Marca la dirección de envío en el mapa.');
  }
  const quote = quoteOwnFleetShipping({
    district: shipping.district || '',
    province: shipping.province || '',
    department: shipping.department || '',
    lat,
    lng,
  });
  const products = Number(order.subtotal) || 0;
  return {
    ...order,
    shippingAmount: quote.total,
    total: roundMoney(products + quote.total),
    shipping: {
      ...shipping,
      districtAmount: quote.districtAmount,
      distanceAmount: quote.distanceAmount,
      distanceKm: quote.distanceKm,
      zoneKind: quote.zone.kind,
      zoneLabel: quote.zoneLabel,
    },
  };
}
