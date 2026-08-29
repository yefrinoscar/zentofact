import { Navigate, Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { visibleNavigation } from '../lib/navigation';
import { firstAllowedPath, PERMISSIONS } from '../lib/permissions';

const descriptions = new Map(PERMISSIONS.map((permission) => [permission.key, permission.description]));

export default function MobileMenu({ isMobile }: { isMobile: boolean }) {
  const { user, can, isAdmin, isSuperadmin, loading } = usePermissions();
  const groups = visibleNavigation(can, undefined, { isAdmin, isSuperadmin });

  if (!isMobile) return <Navigate to={firstAllowedPath(user)} replace />;

  return (
    <div className="space-y-7 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">¿Qué necesitas hacer?</h1>
        <p className="mt-1 text-sm text-muted-foreground">Elige una opción para comenzar.</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : groups.length ? (
        groups.map((group) => (
          <section key={group.id} aria-labelledby={`mobile-menu-${group.id}`}>
            <div className="mb-3 flex items-center gap-3">
              <h2 id={`mobile-menu-${group.id}`} className="shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{group.label}</h2>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {group.items.map(({ to, label, icon: Icon, img, permission, description }) => (
                <Link
                  key={to}
                  to={to}
                  className="group relative flex aspect-square min-h-36 flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm transition active:scale-[0.98] active:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                      {img ? <img src={img} alt="" className="size-7 rounded-md" /> : <Icon className="size-6" />}
                    </span>
                    <ArrowUpRight className="size-4 text-muted-foreground/60" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold leading-tight text-foreground">{label}</h3>
                    <p className="mt-1 line-clamp-3 text-[11px] leading-[1.35] text-muted-foreground">{description ?? (permission ? descriptions.get(permission) : undefined)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Tu perfil todavía no tiene módulos asignados.
        </div>
      )}
    </div>
  );
}
