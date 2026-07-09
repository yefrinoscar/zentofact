import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, Users as UsersIcon, Loader2, AlertCircle,
  Shield, Eye, EyeOff, MoreHorizontal,
} from 'lucide-react';
import api from '../lib/api';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  ROLE_PRESETS,
  type AppRole,
  type PermissionKey,
  parsePermissions,
} from '../lib/permissions';
import { usePermissions } from '../hooks/usePermissions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: AppRole | string;
  permissions: PermissionKey[];
  active: boolean;
};

type FormState = {
  name: string;
  email: string;
  password: string;
  role: AppRole;
  permissions: PermissionKey[];
  active: boolean;
};

const emptyForm = (): FormState => ({
  name: '',
  email: '',
  password: '',
  role: 'operator',
  permissions: [...ROLE_PRESETS.operator.permissions],
  active: true,
});

function roleLabel(role: string) {
  return ROLE_PRESETS[role as AppRole]?.label || role;
}

function initials(name: string, email: string) {
  const base = (name || email || '?').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function UsersPage() {
  const { can, user: me, loading: permLoading } = usePermissions();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    return api.listUsers()
      .then((list: any[]) => {
        setUsers((Array.isArray(list) ? list : []).map((u) => ({
          ...u,
          permissions: parsePermissions(u.permissions, u.role),
        })));
      })
      .catch((e: any) => setError(e?.message || 'No se pudieron cargar los usuarios'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!permLoading && can('users')) load();
  }, [permLoading]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setShowPassword(false);
    setEditorOpen(true);
  };

  const openEdit = (row: UserRow) => {
    setEditing(row);
    setForm({
      name: row.name || '',
      email: row.email || '',
      password: '',
      role: (ROLE_PRESETS[row.role as AppRole] ? row.role : 'operator') as AppRole,
      permissions: parsePermissions(row.permissions, row.role),
      active: row.active !== false,
    });
    setFormError('');
    setShowPassword(false);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setSaving(false);
  };

  const setRole = (role: AppRole) => {
    setForm((f) => ({
      ...f,
      role,
      permissions: role === 'admin' ? [...ALL_PERMISSION_KEYS] : [...ROLE_PRESETS[role].permissions],
    }));
  };

  const togglePermission = (key: PermissionKey) => {
    if (form.role === 'admin') return;
    setForm((f) => {
      const has = f.permissions.includes(key);
      return {
        ...f,
        permissions: has ? f.permissions.filter((k) => k !== key) : [...f.permissions, key],
      };
    });
  };

  const save = async () => {
    if (!form.name.trim()) return setFormError('El nombre es requerido');
    if (!editing && !form.email.trim()) return setFormError('El correo es requerido');
    if (!editing && form.password.length < 8) return setFormError('La contraseña debe tener al menos 8 caracteres');
    if (editing && form.password && form.password.length < 8) return setFormError('La contraseña debe tener al menos 8 caracteres');

    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.updateUser(editing.id, {
          name: form.name.trim(),
          role: form.role,
          permissions: form.role === 'admin' ? ALL_PERMISSION_KEYS : form.permissions,
          active: form.active,
          ...(form.password ? { password: form.password } : {}),
        });
      } else {
        await api.createUser({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          permissions: form.role === 'admin' ? ALL_PERMISSION_KEYS : form.permissions,
          active: form.active,
        });
      }
      closeEditor();
      await load();
    } catch (e: any) {
      setFormError(e?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: UserRow) => {
    if (row.id === me?.id) {
      alert('No puedes eliminar tu propia cuenta');
      return;
    }
    if (!confirm(`¿Eliminar a ${row.name || row.email}?`)) return;
    try {
      await api.deleteUser(row.id);
      await load();
    } catch (e: any) {
      alert(e?.message || 'No se pudo eliminar');
    }
  };

  const sorted = useMemo(
    () => [...users].sort((a, b) => a.email.localeCompare(b.email)),
    [users],
  );

  if (permLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (!can('users')) {
    return (
      <Card size="sm">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Shield className="size-10 text-muted-foreground" />
          <p className="font-medium">Sin permiso</p>
          <CardDescription>No tienes acceso al módulo de usuarios.</CardDescription>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Panel de lista con componentes del preset (Card + filas), no tabla HTML inventada */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Usuarios</CardTitle>
          <CardDescription>Cuentas con acceso a la app y módulos del menú.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={openCreate}>
              <Plus data-icon="inline-start" />
              Nuevo usuario
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="px-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando usuarios…
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <UsersIcon className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No hay usuarios</p>
              <p className="text-sm text-muted-foreground">Crea el primero para compartir el acceso.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {sorted.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-3 px-(--card-spacing) py-3.5 transition-colors hover:bg-muted/40"
                >
                  <Avatar size="default">
                    <AvatarFallback>{initials(row.name, row.email)}</AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{row.name || 'Sin nombre'}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                  </div>

                  <div className="hidden text-sm text-muted-foreground sm:block">
                    {roleLabel(row.role)}
                  </div>

                  <Badge variant={row.active ? 'secondary' : 'outline'} className="hidden sm:inline-flex">
                    {row.active ? 'Activo' : 'Inactivo'}
                  </Badge>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Acciones">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem onClick={() => openEdit(row)}>
                        <Pencil />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={row.id === me?.id}
                        onClick={() => void remove(row)}
                      >
                        <Trash2 />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}
        </CardContent>

      </Card>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
            <DialogDescription>
              Elige un rol predefinido o personaliza los módulos visibles en el menú.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="user-name">Nombre</Label>
              <Input
                id="user-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            {!editing && (
              <div className="grid gap-2">
                <Label htmlFor="user-email">Correo</Label>
                <Input
                  id="user-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="user-password">
                {editing ? 'Nueva contraseña (opcional)' : 'Contraseña'}
              </Label>
              <div className="relative">
                <Input
                  id="user-password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Rol</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(ROLE_PRESETS) as AppRole[]).map((role) => {
                  const preset = ROLE_PRESETS[role];
                  const active = form.role === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setRole(role)}
                      className={cn(
                        'rounded-2xl border p-3 text-left transition',
                        active
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <div className="text-sm font-medium">{preset.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{preset.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Módulos del menú</Label>
              <div className="rounded-2xl border border-border">
                {PERMISSIONS.map((perm, i) => {
                  const checked = form.role === 'admin' || form.permissions.includes(perm.key);
                  const locked = form.role === 'admin';
                  return (
                    <div key={perm.key}>
                      {i > 0 && <Separator />}
                      <label
                        className={cn(
                          'flex cursor-pointer items-start gap-3 px-3 py-2.5 transition hover:bg-muted/40',
                          locked && 'cursor-default opacity-80',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={locked}
                          onCheckedChange={() => togglePermission(perm.key)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{perm.label}</span>
                          <span className="block text-xs text-muted-foreground">{perm.description}</span>
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
              {form.role === 'admin' && (
                <p className="text-xs text-muted-foreground">El administrador siempre tiene todos los módulos.</p>
              )}
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="user-active">Usuario activo</Label>
                <p className="text-xs text-muted-foreground">Si se desactiva, no podrá iniciar sesión.</p>
              </div>
              <Switch
                id="user-active"
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
            </div>

            {formError && (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditor} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
