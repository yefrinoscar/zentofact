import { DINSIDES_SEDES, DINSIDES_ZONES } from './dinsides-zones.ts';

/**
 * Bandas de tarifa del mapa, en el azul primario de ZentoFact (hue 264). Más caro = más oscuro y
 * más alto. `side` es la pared del relieve: el mismo tono, más oscuro.
 */
export const DINSIDES_TIERS = [
  { key: 't8', label: 'S/ 8', min: 8, max: 8, top: 'oklch(0.93 0.04 264)', side: 'oklch(0.8 0.06 264)', height: 5 },
  { key: 't10', label: 'S/ 10', min: 10, max: 10, top: 'oklch(0.85 0.08 264)', side: 'oklch(0.7 0.11 264)', height: 7 },
  { key: 't12', label: 'S/ 12', min: 12, max: 12, top: 'oklch(0.72 0.15 264)', side: 'oklch(0.57 0.17 264)', height: 9 },
  { key: 't14', label: 'S/ 14–17', min: 13, max: 17, top: 'oklch(0.56 0.22 264)', side: 'oklch(0.42 0.19 264)', height: 12 },
  { key: 't19', label: 'S/ 19+', min: 18, max: Infinity, top: 'oklch(0.4 0.2 264)', side: 'oklch(0.29 0.14 264)', height: 15 },
] as const;

export type DinsidesTier = (typeof DINSIDES_TIERS)[number];

export type DinsidesMapZone = {
  name: string;
  amount: number;
  tier: DinsidesTier;
  /** Contorno ya proyectado, en coordenadas del viewBox. */
  path: string;
  /** Centro aproximado de la zona, para el pin. */
  cx: number;
  cy: number;
  /** Orden de pintado: lo que queda más al fondo se dibuja primero. */
  depth: number;
};

export type DinsidesMapPin = { name: string; x: number; y: number };

export type DinsidesMap = {
  viewBox: string;
  zones: DinsidesMapZone[];
  pins: DinsidesMapPin[];
};

const LAT0 = -12.07;
const LNG0 = -77.0;
const COS_LAT = Math.cos((LAT0 * Math.PI) / 180);
const SCALE = 1000;
/** Gira el mapa para que la costa quede más horizontal, como en una vista aérea. */
const ROTATE = (-12 * Math.PI) / 180;
/** Aplana el eje vertical: da la sensación de mirar el mapa inclinado. */
const TILT = 0.64;
const PAD = 24;

export function dinsidesTierFor(amount: number): DinsidesTier {
  return DINSIDES_TIERS.find((tier) => amount >= tier.min && amount <= tier.max) ?? DINSIDES_TIERS[DINSIDES_TIERS.length - 1];
}

function project(lng: number, lat: number): [number, number] {
  const x = (lng - LNG0) * COS_LAT * SCALE;
  const y = -(lat - LAT0) * SCALE;
  const xr = x * Math.cos(ROTATE) - y * Math.sin(ROTATE);
  const yr = x * Math.sin(ROTATE) + y * Math.cos(ROTATE);
  return [xr, yr * TILT];
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Proyecta las 60 zonas de Dinsides a un SVG listo para pintar con relieve. */
export function buildDinsidesMap(): DinsidesMap {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const projected = DINSIDES_ZONES.map(([name, amount, rings]) => {
    const tier = dinsidesTierFor(amount);
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    const pts = rings.map((ring) => ring.map(([lng, lat]) => {
      const [x, y] = project(lng, lat);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y - tier.height);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      count += 1;
      return [x, y] as const;
    }));
    return { name, amount, tier, pts, cx: sumX / count, cy: sumY / count };
  });

  const ox = minX - PAD;
  const oy = minY - PAD - 30;
  const zones = projected
    .map(({ name, amount, tier, pts, cx, cy }) => ({
      name,
      amount,
      tier,
      path: pts
        .map((ring) => ring.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x - ox)} ${round(y - oy)}`).join('') + 'Z')
        .join(''),
      cx: round(cx - ox),
      cy: round(cy - oy),
      depth: cy,
    }))
    .sort((a, b) => a.depth - b.depth);

  const pins = DINSIDES_SEDES.map((sede) => {
    const [x, y] = project(sede.lng, sede.lat);
    return { name: sede.name, x: round(x - ox), y: round(y - oy) };
  });

  const width = round(maxX - minX + PAD * 2);
  const height = round(maxY - minY + PAD * 2 + 30);
  return { viewBox: `0 0 ${width} ${height}`, zones, pins };
}
