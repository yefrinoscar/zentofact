import { foldName, haversineKm } from './own-fleet-shipping.ts';

export type IndexedPeruPlace = {
  id: string;
  label: string;
  district: string;
  province: string;
  department: string;
  lat: number;
  lng: number;
};

function place(
  id: string,
  label: string,
  district: string,
  province: string,
  department: string,
  lat: number,
  lng: number,
): IndexedPeruPlace {
  return { id, label, district, province, department, lat, lng };
}

const LIMA_METRO: IndexedPeruPlace[] = [
  place('lima-san-miguel', 'San Miguel, Lima', 'San Miguel', 'Lima', 'Lima', -12.0776, -77.0905),
  place('lima-magdalena', 'Magdalena del Mar, Lima', 'Magdalena Del Mar', 'Lima', 'Lima', -12.095, -77.07),
  place('lima-pueblo-libre', 'Pueblo Libre, Lima', 'Pueblo Libre', 'Lima', 'Lima', -12.074, -77.062),
  place('lima-cercado', 'Cercado de Lima', 'Cercado De Lima', 'Lima', 'Lima', -12.0464, -77.0428),
  place('lima-brena', 'Breña, Lima', 'Breña', 'Lima', 'Lima', -12.058, -77.05),
  place('lima-jesus-maria', 'Jesús María, Lima', 'Jesús María', 'Lima', 'Lima', -12.078, -77.043),
  place('lima-lince', 'Lince, Lima', 'Lince', 'Lima', 'Lima', -12.087, -77.036),
  place('lima-la-victoria', 'La Victoria, Lima', 'La Victoria', 'Lima', 'Lima', -12.065, -77.016),
  place('lima-san-isidro', 'San Isidro, Lima', 'San Isidro', 'Lima', 'Lima', -12.098, -77.035),
  place('lima-miraflores', 'Miraflores, Lima', 'Miraflores', 'Lima', 'Lima', -12.121, -77.029),
  place('lima-san-borja', 'San Borja, Lima', 'San Borja', 'Lima', 'Lima', -12.096, -76.996),
  place('lima-surquillo', 'Surquillo, Lima', 'Surquillo', 'Lima', 'Lima', -12.114, -77.021),
  place('lima-barranco', 'Barranco, Lima', 'Barranco', 'Lima', 'Lima', -12.144, -77.02),
  place('lima-rimac', 'Rímac, Lima', 'Rímac', 'Lima', 'Lima', -12.042, -77.03),
  place('lima-san-luis', 'San Luis, Lima', 'San Luis', 'Lima', 'Lima', -12.075, -76.995),
  place('lima-surco', 'Santiago de Surco, Lima', 'Santiago De Surco', 'Lima', 'Lima', -12.135, -76.995),
  place('lima-chorrillos', 'Chorrillos, Lima', 'Chorrillos', 'Lima', 'Lima', -12.168, -77.018),
  place('lima-independencia', 'Independencia, Lima', 'Independencia', 'Lima', 'Lima', -11.99, -77.05),
  place('lima-los-olivos', 'Los Olivos, Lima', 'Los Olivos', 'Lima', 'Lima', -11.959, -77.076),
  place('lima-smp', 'San Martín de Porres, Lima', 'San Martín De Porres', 'Lima', 'Lima', -12.03, -77.061),
  place('lima-el-agustino', 'El Agustino, Lima', 'El Agustino', 'Lima', 'Lima', -12.048, -76.995),
  place('lima-santa-anita', 'Santa Anita, Lima', 'Santa Anita', 'Lima', 'Lima', -12.044, -76.971),
  place('lima-ate', 'Ate, Lima', 'Ate', 'Lima', 'Lima', -12.039, -76.92),
  place('lima-sjm', 'San Juan de Miraflores, Lima', 'San Juan De Miraflores', 'Lima', 'Lima', -12.162, -76.97),
  place('lima-la-molina', 'La Molina, Lima', 'La Molina', 'Lima', 'Lima', -12.079, -76.922),
  place('lima-sjl', 'San Juan de Lurigancho, Lima', 'San Juan De Lurigancho', 'Lima', 'Lima', -12.002, -76.993),
  place('lima-comas', 'Comas, Lima', 'Comas', 'Lima', 'Lima', -11.932, -77.048),
  place('lima-carabayllo', 'Carabayllo, Lima', 'Carabayllo', 'Lima', 'Lima', -11.873, -77.032),
  place('lima-puente-piedra', 'Puente Piedra, Lima', 'Puente Piedra', 'Lima', 'Lima', -11.867, -77.076),
  place('lima-ancon', 'Ancón, Lima', 'Ancón', 'Lima', 'Lima', -11.739, -77.15),
  place('lima-santa-rosa', 'Santa Rosa, Lima', 'Santa Rosa', 'Lima', 'Lima', -11.796, -77.156),
  place('lima-ves', 'Villa El Salvador, Lima', 'Villa El Salvador', 'Lima', 'Lima', -12.213, -76.937),
  place('lima-vmt', 'Villa María del Triunfo, Lima', 'Villa María Del Triunfo', 'Lima', 'Lima', -12.162, -76.943),
  place('lima-lurin', 'Lurín, Lima', 'Lurín', 'Lima', 'Lima', -12.274, -76.87),
  place('lima-pachacamac', 'Pachacámac, Lima', 'Pachacámac', 'Lima', 'Lima', -12.229, -76.859),
  place('lima-pucusana', 'Pucusana, Lima', 'Pucusana', 'Lima', 'Lima', -12.481, -76.797),
  place('lima-punta-hermosa', 'Punta Hermosa, Lima', 'Punta Hermosa', 'Lima', 'Lima', -12.333, -76.826),
  place('lima-punta-negra', 'Punta Negra, Lima', 'Punta Negra', 'Lima', 'Lima', -12.365, -76.795),
  place('lima-san-bartolo', 'San Bartolo, Lima', 'San Bartolo', 'Lima', 'Lima', -12.388, -76.778),
  place('lima-santa-maria', 'Santa María del Mar, Lima', 'Santa María Del Mar', 'Lima', 'Lima', -12.408, -76.774),
  place('lima-cieneguilla', 'Cieneguilla, Lima', 'Cieneguilla', 'Lima', 'Lima', -12.119, -76.814),
  place('lima-chaclacayo', 'Chaclacayo, Lima', 'Chaclacayo', 'Lima', 'Lima', -11.996, -76.769),
  place('lima-chosica', 'Lurigancho (Chosica), Lima', 'Lurigancho', 'Lima', 'Lima', -11.937, -76.709),
  place('lima-huaral', 'Huaral, Lima', 'Huaral', 'Huaral', 'Lima', -11.495, -77.208),
  place('lima-canete', 'Cañete, Lima', 'San Vicente De Cañete', 'Cañete', 'Lima', -13.077, -76.387),
];

const CALLAO: IndexedPeruPlace[] = [
  place('callao-callao', 'Callao', 'Callao', 'Callao', 'Callao', -12.056, -77.118),
  place('callao-bellavista', 'Bellavista, Callao', 'Bellavista', 'Callao', 'Callao', -12.062, -77.111),
  place('callao-carmen', 'Carmen de la Legua, Callao', 'Carmen De La Legua', 'Callao', 'Callao', -12.039, -77.09),
  place('callao-la-perla', 'La Perla, Callao', 'La Perla', 'Callao', 'Callao', -12.07, -77.115),
  place('callao-la-punta', 'La Punta, Callao', 'La Punta', 'Callao', 'Callao', -12.072, -77.163),
  place('callao-ventanilla', 'Ventanilla, Callao', 'Ventanilla', 'Callao', 'Callao', -11.877, -77.127),
  place('callao-mi-peru', 'Mi Perú, Callao', 'Mi Perú', 'Callao', 'Callao', -11.855, -77.125),
];

const DEPARTMENTS: IndexedPeruPlace[] = [
  place('dep-amazonas', 'Amazonas', '', 'Chachapoyas', 'Amazonas', -6.229, -77.871),
  place('dep-ancash', 'Áncash', '', 'Huaraz', 'Áncash', -9.528, -77.528),
  place('dep-apurimac', 'Apurímac', '', 'Abancay', 'Apurímac', -13.634, -72.881),
  place('dep-arequipa', 'Arequipa', 'Arequipa', 'Arequipa', 'Arequipa', -16.409, -71.537),
  place('dep-ayacucho', 'Ayacucho', '', 'Huamanga', 'Ayacucho', -13.158, -74.223),
  place('dep-cajamarca', 'Cajamarca', '', 'Cajamarca', 'Cajamarca', -7.164, -78.51),
  place('dep-cusco', 'Cusco', '', 'Cusco', 'Cusco', -13.532, -71.967),
  place('dep-huancavelica', 'Huancavelica', '', 'Huancavelica', 'Huancavelica', -12.787, -74.973),
  place('dep-huanuco', 'Huánuco', '', 'Huánuco', 'Huánuco', -9.93, -76.242),
  place('dep-ica', 'Ica', '', 'Ica', 'Ica', -14.068, -75.729),
  place('dep-junin', 'Junín', '', 'Huancayo', 'Junín', -12.065, -75.205),
  place('dep-la-libertad', 'La Libertad', '', 'Trujillo', 'La Libertad', -8.112, -79.029),
  place('dep-lambayeque', 'Lambayeque', '', 'Chiclayo', 'Lambayeque', -6.771, -79.841),
  place('dep-loreto', 'Loreto', '', 'Maynas', 'Loreto', -3.749, -73.254),
  place('dep-madre-de-dios', 'Madre de Dios', '', 'Tambopata', 'Madre De Dios', -12.593, -69.189),
  place('dep-moquegua', 'Moquegua', '', 'Mariscal Nieto', 'Moquegua', -17.194, -70.935),
  place('dep-pasco', 'Pasco', '', 'Pasco', 'Pasco', -10.667, -76.257),
  place('dep-piura', 'Piura', '', 'Piura', 'Piura', -5.194, -80.632),
  place('dep-puno', 'Puno', '', 'Puno', 'Puno', -15.84, -70.021),
  place('dep-san-martin', 'San Martín', '', 'Moyobamba', 'San Martín', -6.034, -76.974),
  place('dep-tacna', 'Tacna', '', 'Tacna', 'Tacna', -18.014, -70.253),
  place('dep-tumbes', 'Tumbes', '', 'Tumbes', 'Tumbes', -3.566, -80.455),
  place('dep-ucayali', 'Ucayali', '', 'Coronel Portillo', 'Ucayali', -8.379, -74.554),
];

export const PERU_PLACES: IndexedPeruPlace[] = [...LIMA_METRO, ...CALLAO, ...DEPARTMENTS];

const BY_ID = new Map(PERU_PLACES.map((item) => [item.id, item]));

export function peruPlaceById(id: string) {
  return BY_ID.get(id) || null;
}

function haystack(place: IndexedPeruPlace) {
  return foldName([place.label, place.district, place.province, place.department].join(' '));
}

export function searchPeruPlaces(query: string, limit = 6): IndexedPeruPlace[] {
  const term = foldName(query);
  if (term.length < 2) return [];
  const scored = PERU_PLACES.map((place) => {
    const text = haystack(place);
    const district = foldName(place.district);
    const department = foldName(place.department);
    let score = 0;
    if (district === term || department === term || foldName(place.label) === term) score = 300;
    else if (district.startsWith(term) || department.startsWith(term)) score = 200;
    else if (text.includes(term)) score = 100;
    if (score && place.department === 'Lima' && place.district) score += 10;
    return { place, score };
  }).filter((row) => row.score > 0);
  scored.sort((a, b) => b.score - a.score || a.place.label.localeCompare(b.place.label, 'es'));
  return scored.slice(0, limit).map((row) => row.place);
}

export function nearestPeruPlace(point: { lat: number; lng: number }, maxKm = 40): IndexedPeruPlace | null {
  let best: IndexedPeruPlace | null = null;
  let bestKm = Infinity;
  for (const place of PERU_PLACES) {
    const km = haversineKm(point, place);
    if (km < bestKm) {
      best = place;
      bestKm = km;
    }
  }
  if (!best || bestKm > maxKm) return null;
  return best;
}

export function indexedPlaceToDestination(place: IndexedPeruPlace): {
  label: string;
  district: string;
  province: string;
  department: string;
  lat: number;
  lng: number;
} {
  return {
    label: place.label,
    district: place.district,
    province: place.province,
    department: place.department,
    lat: place.lat,
    lng: place.lng,
  };
}
