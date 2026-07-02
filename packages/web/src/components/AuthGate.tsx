import { useState } from 'react';
import { authClient, isWeb } from '../lib/authClient';
import { Loader2, Mail, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import falabellaIcon from '../assets/falabella.png';

// Puerta de autenticación (solo web). En desktop deja pasar directo (IPC local).
export default function AuthGate({ children }: { children: React.ReactNode }) {
  if (!isWeb) return <>{children}</>;
  return <WebAuthGate>{children}</WebAuthGate>;
}

// Grafo de proceso vivo: nodos del pipeline de facturación con pulsos de datos.
function InvoiceFlowArt() {
  const nodes = [
    { x: 66, y: 84, kind: 'origin', accent: false, label: 'Falabella' },
    { x: 196, y: 132, kind: 'doc', accent: false, label: 'Boleta' },
    { x: 108, y: 240, kind: 'sign', accent: false, label: 'Firma' },
    { x: 300, y: 192, kind: 'shield', accent: false, label: 'SUNAT' },
    { x: 396, y: 286, kind: 'check', accent: true, label: 'Aceptado' },
    { x: 176, y: 322, kind: 'nc', accent: false, label: 'N. crédito' },
  ] as const;

  const edges = [
    { d: 'M66 84 C 128 104, 150 116, 196 132', dur: 2.4, begin: 0 },
    { d: 'M196 132 C 160 172, 130 208, 108 240', dur: 2.8, begin: 0.5 },
    { d: 'M108 240 C 180 236, 245 212, 300 192', dur: 2.6, begin: 1 },
    { d: 'M196 132 C 244 152, 275 170, 300 192', dur: 2.2, begin: 0.3 },
    { d: 'M300 192 C 345 220, 376 256, 396 286', dur: 2.4, begin: 1.4 },
    { d: 'M196 132 C 190 214, 182 278, 176 322', dur: 3, begin: 1.2 },
  ];

  const icon = (kind: string, x: number, y: number) => {
    const s = 'white';
    switch (kind) {
      case 'origin':
        return <text x={x} y={y + 5} textAnchor="middle" fontSize="15" fontWeight="800" fill="#12203a" fontFamily="system-ui">F</text>;
      case 'doc':
        return <g stroke={s} strokeWidth="1.6" strokeLinecap="round"><rect x={x - 7} y={y - 9} width="14" height="18" rx="2.5" strokeOpacity="0.85" /><path d={`M${x - 4} ${y - 4}h8M${x - 4} ${y}h8M${x - 4} ${y + 4}h5`} strokeOpacity="0.6" /></g>;
      case 'sign':
        return <path d={`M${x - 9} ${y + 5} q 3 -12 6 -1 q 2 8 5 -2 q 2 -6 6 0`} stroke={s} strokeWidth="1.8" fill="none" strokeLinecap="round" />;
      case 'shield':
        return <path d={`M${x} ${y - 10} l9 4 v5 c0 6 -5 9 -9 11 c-4 -2 -9 -5 -9 -11 v-5 z`} stroke={s} strokeWidth="1.6" fill="none" strokeLinejoin="round" />;
      case 'check':
        return <path d={`M${x - 8} ${y} l6 6 l10 -12`} stroke="#12203a" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
      case 'cloud':
        return <path d={`M${x - 10} ${y + 5} a6 6 0 01.5 -12 a8 8 0 0114 -1 a5 5 0 011.5 13 z`} stroke={s} strokeWidth="1.6" fill="none" strokeLinejoin="round" />;
      case 'nc':
        return <g stroke={s} strokeWidth="1.6" strokeLinecap="round"><rect x={x - 7} y={y - 9} width="14" height="18" rx="2.5" strokeOpacity="0.85" /><path d={`M${x - 4} ${y}h8`} /></g>;
      default:
        return null;
    }
  };

  return (
    <svg viewBox="0 0 460 380" className="h-auto w-full max-w-lg overflow-visible" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a3e635" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#10b981" stopOpacity="0.5" />
          <stop offset="1" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
        <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="12" /></filter>
        <clipPath id="logoClip"><rect x="48" y="66" width="36" height="36" rx="11" /></clipPath>
      </defs>

      <ellipse cx="250" cy="200" rx="180" ry="150" fill="url(#glow)" opacity="0.5" filter="url(#soft)" />

      {/* aristas + pulsos */}
      {edges.map((e, i) => (
        <g key={`e${i}`}>
          <path d={e.d} stroke="white" strokeOpacity="0.16" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d={e.d} stroke="url(#accent)" strokeOpacity="0.5" strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray="1 220">
            <animate attributeName="stroke-dashoffset" from="0" to="-221" dur={`${e.dur}s`} begin={`${e.begin}s`} repeatCount="indefinite" />
          </path>
          <circle r="3.5" fill="url(#accent)">
            <animateMotion dur={`${e.dur}s`} begin={`${e.begin}s`} repeatCount="indefinite" path={e.d} />
            <animate attributeName="opacity" values="0;1;1;0" dur={`${e.dur}s`} begin={`${e.begin}s`} repeatCount="indefinite" />
          </circle>
        </g>
      ))}

      {/* nodos */}
      {nodes.map((n, i) => (
        <g key={`n${i}`}>
          <circle cx={n.x} cy={n.y} r="24" fill="url(#accent)" opacity="0.25">
            <animate attributeName="r" values="24;30;24" dur="2.6s" begin={`${i * 0.35}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0;0.3" dur="2.6s" begin={`${i * 0.35}s`} repeatCount="indefinite" />
          </circle>
          {n.kind === 'origin' ? (
            <>
              <image href={falabellaIcon} x={n.x - 18} y={n.y - 18} width="36" height="36" clipPath="url(#logoClip)" preserveAspectRatio="xMidYMid slice" />
              <rect x={n.x - 18} y={n.y - 18} width="36" height="36" rx="11" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />
            </>
          ) : (
            <>
              <circle
                cx={n.x} cy={n.y} r="21"
                fill={n.accent ? 'url(#accent)' : 'rgba(255,255,255,0.09)'}
                stroke="white" strokeOpacity={n.accent ? '0.35' : '0.22'} strokeWidth="1.5"
              />
              {icon(n.kind, n.x, n.y)}
            </>
          )}
          <text x={n.x} y={n.y + 38} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="white" fillOpacity="0.72" fontFamily="system-ui">{n.label}</text>
        </g>
      ))}
    </svg>
  );
}

// (obsoleto) ilustración previa
function WebAuthGate({ children }: { children: React.ReactNode }) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (session) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, error } = await authClient.signIn.email({
      email,
      password,
      callbackURL: window.location.href,
    });
    setLoading(false);
    if (error) setError(error.message || 'Credenciales inválidas.');
    else if (data?.url) window.location.href = data.url;
    else await refetch();
  };

  return (
    <div className="flex h-screen w-full bg-background">
      {/* Panel de marca (oscuro) — oculto en móvil */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-sidebar-primary p-12 text-sidebar-primary-foreground lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, white 0, transparent 40%), radial-gradient(circle at 80% 80%, white 0, transparent 45%)' }}
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-lg font-black tracking-tighter ring-1 ring-white/20">Z</span>
          <span className="text-lg font-semibold tracking-tight">ZentoFact</span>
        </div>
        <div className="relative">
          <InvoiceFlowArt />
          <div className="mt-10 max-w-sm">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight">
              Emite tus boletas de Falabella, sin fricción.
            </h2>
            <p className="mt-4 text-sm text-white/70">
              Facturación electrónica, notas de crédito y conciliación con SUNAT en un solo lugar.
            </p>
          </div>
        </div>
        <div className="relative flex items-center justify-between gap-4 text-xs text-white/60">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Conexión segura · SUNAT
          </span>
          <span>
            Desarrollado por <span className="font-medium text-white/90">Zentolabs</span>
          </span>
        </div>
      </div>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          {/* Logo (visible en móvil, donde no está el panel) */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-sidebar-primary text-base font-black tracking-tighter text-sidebar-primary-foreground">Z</span>
            <span className="text-base font-semibold tracking-tight">ZentoFact</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Bienvenido de vuelta</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Inicia sesión en tu cuenta para continuar.</p>

          <div className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Correo</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com" autoComplete="email" required
                  className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/5"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Contraseña</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" autoComplete="current-password" required
                  className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-10 text-sm outline-none transition focus:border-foreground/40 focus:ring-4 focus:ring-foreground/5"
                />
                <button
                  type="button" onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Ingresando…' : 'Ingresar'}
            </button>
          </div>

          <p className="mt-8 text-center text-xs text-muted-foreground lg:hidden">
            Desarrollado por <span className="font-medium text-foreground">Zentolabs</span>
          </p>
        </form>
      </div>
    </div>
  );
}
