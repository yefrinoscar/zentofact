import { useState } from 'react';
import { authClient, isWeb } from '../lib/authClient';
import { Loader2 } from 'lucide-react';

// Puerta de autenticación (solo web). En desktop deja pasar directo (IPC local).
export default function AuthGate({ children }: { children: React.ReactNode }) {
  if (!isWeb) return <>{children}</>;
  return <WebAuthGate>{children}</WebAuthGate>;
}

function WebAuthGate({ children }: { children: React.ReactNode }) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
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
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold tracking-wide">ZENTOFACTO</h1>
        <p className="mt-1 text-sm text-muted-foreground">Inicia sesión para continuar.</p>
        <div className="mt-5 space-y-3">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" autoComplete="email" required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
          />
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" autoComplete="current-password" required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Ingresar
          </button>
        </div>
      </form>
    </div>
  );
}
