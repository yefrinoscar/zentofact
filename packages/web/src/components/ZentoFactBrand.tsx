import { cn } from '@/lib/utils';
import { appEnvironmentKind } from '@/lib/runtimeEnv';

const ENV_MARK = {
  local: { fill: '#A3E635', label: 'LOCAL', fontSize: 68, letterSpacing: 4 },
  development: { fill: '#FBBF24', label: 'DEV', fontSize: 84, letterSpacing: 10 },
} as const;

function ZentoFactGlyph() {
  return (
    <>
      <path d="M32 72h284v96L152 376h164v104H32v-96l164-208H32z" fill="#132238" />
      <path d="M340 72h140v104h-56v48h44v100h-44v156h-84z" fill="#2864F0" />
    </>
  );
}

export function ZentoFactMark({ className }: { className?: string }) {
  const kind = appEnvironmentKind();
  const mark = kind === 'production' ? null : ENV_MARK[kind];

  return (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center overflow-hidden rounded-md',
        mark ? undefined : 'bg-white p-0.5',
        className,
      )}
      style={mark ? { backgroundColor: mark.fill } : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 512 512" className="size-full" role="img">
        {mark ? (
          <>
            <g transform="translate(24 4) scale(0.82)">
              <ZentoFactGlyph />
            </g>
            <rect y="392" width="512" height="120" fill="#132238" />
            <text
              x="256"
              y="478"
              textAnchor="middle"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontSize={mark.fontSize}
              fontWeight="800"
              fill={mark.fill}
              letterSpacing={mark.letterSpacing}
            >
              {mark.label}
            </text>
          </>
        ) : (
          <ZentoFactGlyph />
        )}
      </svg>
    </span>
  );
}

export function EnvBadge({ className }: { className?: string }) {
  const kind = appEnvironmentKind();
  if (kind === 'production') return null;
  const mark = ENV_MARK[kind];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-[#132238]',
        className,
      )}
      style={{ backgroundColor: mark.fill }}
    >
      {mark.label}
    </span>
  );
}
