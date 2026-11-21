import { useState } from 'react';
import { buildDinsidesMap, type DinsidesMapZone } from '../lib/dinsides-map';
import { formatSaleMoney } from '../lib/sale-summary';

const MAP = buildDinsidesMap();
const LAYER_STEP = 1.5;
const HOVER_LIFT = 3;
const SELECTED_LIFT = 9;

function sideOffsets(height: number) {
  const offsets: number[] = [];
  for (let dy = 0; dy < height; dy += LAYER_STEP) offsets.push(dy);
  return offsets;
}

function ZoneSlab({
  zone,
  lift,
  dimmed,
  selected,
  onSelect,
  onHover,
}: {
  zone: DinsidesMapZone;
  lift: number;
  dimmed: boolean;
  selected: boolean;
  onSelect: (name: string) => void;
  onHover: (name: string | null) => void;
}) {
  const { tier } = zone;
  return (
    <g
      role="button"
      tabIndex={-1}
      aria-label={`${zone.name}, ${formatSaleMoney(zone.amount)}`}
      className="cursor-pointer outline-none"
      style={{
        opacity: dimmed ? 0.6 : 1,
        transform: `translateY(${-lift}px)`,
        transition: 'transform 180ms ease-out, opacity 180ms ease-out',
      }}
      onClick={() => onSelect(zone.name)}
      onPointerEnter={() => onHover(zone.name)}
      onPointerLeave={() => onHover(null)}
    >
      <title>{`${zone.name} · ${formatSaleMoney(zone.amount)}`}</title>
      {sideOffsets(tier.height).map((dy) => (
        <path key={dy} d={zone.path} fill={selected ? 'oklch(0.36 0.2 264)' : tier.side} transform={`translate(0 ${-dy})`} />
      ))}
      <path
        d={zone.path}
        transform={`translate(0 ${-tier.height})`}
        fill={selected ? 'var(--primary)' : tier.top}
        stroke="white"
        strokeOpacity={selected ? 1 : 0.7}
        strokeWidth={selected ? 1.4 : 0.8}
        strokeLinejoin="round"
      />
    </g>
  );
}

function Pin({ x, y, color, label }: { x: number; y: number; color: string; label?: string }) {
  return (
    <g pointerEvents="none" transform={`translate(${x} ${y})`}>
      <ellipse cx={0} cy={0} rx={7} ry={3.5} fill="none" stroke={color} strokeWidth={1.6} />
      <line x1={0} y1={0} x2={0} y2={-22} stroke="var(--foreground)" strokeWidth={1.6} strokeLinecap="round" />
      <circle cx={0} cy={-24} r={5.5} fill={color} stroke="white" strokeWidth={1.2} />
      {label ? (
        <g transform="translate(0 -38)">
          <rect x={-label.length * 3.6 - 10} y={-13} width={label.length * 7.2 + 20} height={22} rx={6} fill="var(--foreground)" />
          <text textAnchor="middle" y={2.5} fontSize={11.5} fontWeight={600} fill="var(--background)">
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/**
 * Mapa con relieve de las zonas de Dinsides. Más alto y más oscuro = más caro.
 * Solo pinta: la zona elegida viene de la página.
 */
export function DinsidesCoverageMap({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const selectedZone = MAP.zones.find((zone) => zone.name === selected) ?? null;
  // La zona elegida se pinta al final para que su relieve no quede tapado.
  const ordered = selectedZone ? [...MAP.zones.filter((zone) => zone !== selectedZone), selectedZone] : MAP.zones;
  const pinZone = selectedZone ?? MAP.zones.find((zone) => zone.name === hovered) ?? null;

  return (
    <svg
      viewBox={MAP.viewBox}
      className="h-auto w-full select-none drop-shadow-[0_18px_22px_rgba(30,50,140,0.16)]"
      role="img"
      aria-label="Mapa de cobertura de Dinsides en Lima y Callao"
    >
      {ordered.map((zone) => {
        const isSelected = zone === selectedZone;
        const lift = isSelected ? SELECTED_LIFT : zone.name === hovered ? HOVER_LIFT : 0;
        return (
          <ZoneSlab
            key={zone.name}
            zone={zone}
            lift={lift}
            selected={isSelected}
            dimmed={selectedZone != null && !isSelected}
            onSelect={onSelect}
            onHover={setHovered}
          />
        );
      })}
      {MAP.pins.map((pin) => (
        <Pin key={pin.name} x={pin.x} y={pin.y - 8} color="var(--foreground)" />
      ))}
      {pinZone ? (
        <Pin
          x={pinZone.cx}
          y={pinZone.cy - pinZone.tier.height - (pinZone === selectedZone ? SELECTED_LIFT : HOVER_LIFT)}
          color="var(--primary)"
          label={`${pinZone.name} · ${formatSaleMoney(pinZone.amount)}`}
        />
      ) : null}
    </svg>
  );
}
