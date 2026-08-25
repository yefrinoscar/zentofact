import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, Users as UsersIcon, Loader2, AlertCircle,
  Shield, Eye, EyeOff, MoreHorizontal, Search, ChevronLeft, ChevronRight,
} from 'lucide-react';
import api from '../lib/api';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  PERMISSION_SECTIONS,
  ROLE_PRESETS,
  SELECTABLE_ROLES,
  type AppRole,
  type PermissionKey,
  isAdminRole,
  isPermissionsLocked,
  parsePermissions,
} from '../lib/permissions';
import { usePermissions } from '../hooks/usePermissions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TablePanelFooter,
  TableRow,
} from '@/components/ui/table';
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
  commissionPercent?: number;
};

type FormState = {
  name: string;
  email: string;
  password: string;
  role: AppRole;
  permissions: PermissionKey[];
  active: boolean;
  commissionPercent: string;
};

const emptyForm = (): FormState => ({
  name: '',
  email: '',
  password: '',
  role: 'operator',
  permissions: [...ROLE_PRESETS.operator.permissions],
  active: true,
  commissionPercent: '0',
});

const USERS_PAGE_SIZE = 10;

function roleLabel(role: string) {
  return ROLE_PRESETS[role as AppRole]?.label || role;
}

function roleBadgeClass(role: string) {
  switch (role) {
    case 'superadmin':
      return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300';
    case 'admin':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300';
    case 'operator':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
    case 'billing':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'vendedor':
      return 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300';
    case 'falabella_manager':
      return 'border-lime-200 bg-lime-50 text-lime-700 dark:border-lime-900 dark:bg-lime-950/40 dark:text-lime-300';
    case 'viewer':
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300';
    default:
      return 'border-border bg-muted/50 text-muted-foreground';
  }
}

function initials(name: string, email: string) {
  const base = (name || email || '?').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function UsersPage() {
  const { can, user: me, isAdmin, isSuperadmin, loading: permLoading } = usePermissions();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
    if (!isAdmin) return;
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setShowPassword(false);
    setEditorOpen(true);
  };

  const openEdit = (row: UserRow) => {
    if (!canManageRow(row)) return;
    setEditing(row);
    setForm({
      name: row.name || '',
      email: row.email || '',
      password: '',
      role: (ROLE_PRESETS[row.role as AppRole] ? row.role : 'operator') as AppRole,
      permissions: parsePermissions(row.permissions, row.role),
      active: row.active !== false,
      commissionPercent: String(row.commissionPercent ?? 0),
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
      permissions: isAdminRole(role) ? [...ALL_PERMISSION_KEYS] : [...ROLE_PRESETS[role].permissions],
    }));
  };

  const togglePermission = (key: PermissionKey) => {
    if (isPermissionsLocked(form.role)) return;
    setForm((f) => {
      const has = f.permissions.includes(key);
      return {
        ...f,
        permissions: has ? f.permissions.filter((k) => k !== key) : [...f.permissions, key],
      };
    });
  };

  const togglePermissionSection = (keys: PermissionKey[]) => {
    if (isPermissionsLocked(form.role)) return;
    setForm((current) => {
      const allChecked = keys.every((key) => current.permissions.includes(key));
      return {
        ...current,
        permissions: allChecked
          ? current.permissions.filter((key) => !keys.includes(key))
          : [...new Set([...current.permissions, ...keys])],
      };
    });
  };

  const save = async () => {
    if (!form.name.trim()) return setFormError('El nombre es requerido');
    if (!editing && !form.email.trim()) return setFormError('El correo es requerido');
    if (!editing && form.password.length < 12) return setFormError('La contraseña debe tener al menos 12 caracteres');
    if (editing && form.password && form.password.length < 12) return setFormError('La contraseña debe tener al menos 12 caracteres');

    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.updateUser(editing.id, {
          name: form.name.trim(),
          role: form.role,
          permissions: isAdminRole(form.role) ? ALL_PERMISSION_KEYS : form.permissions,
          active: form.active,
          commissionPercent: Number(form.commissionPercent || 0),
          ...(form.password ? { password: form.password } : {}),
        });
      } else {
        await api.createUser({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          permissions: isAdminRole(form.role) ? ALL_PERMISSION_KEYS : form.permissions,
          active: form.active,
          commissionPercent: Number(form.commissionPercent || 0),
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
    if (!canManageRow(row)) {
      alert('No tienes autoridad para administrar esta cuenta');
      return;
    }
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

  const canManageRow = (row: UserRow) => {
    if (!isAdmin || row.id === me?.id) return false;
    return isSuperadmin || !isAdminRole(row.role);
  };

  const editableRoles = SELECTABLE_ROLES
    .filter((role) => isSuperadmin || !isAdminRole(role));
  const visiblePermissions = PERMISSIONS.filter((permission) => {
    if (import.meta.env.VITE_APP_ENV === 'production' && permission.hiddenInProduction) return false;
    return isAdminRole(form.role) || !['dashboard', 'users', 'salesperson'].includes(permission.key);
  });
  const permissionGroups = PERMISSION_SECTIONS
    .map((section) => ({
      ...section,
      permissions: visiblePermissions.filter((permission) => permission.section === section.key),
    }))
    .filter((section) => section.permissions.length > 0);

  const filteredUsers = useMemo(() => {
    const text = search.trim().toLowerCase();
    return sorted.filter((row) => {
      const matchesText = !text || `${row.name} ${row.email} ${roleLabel(row.role)}`.toLowerCase().includes(text);
      return matchesText && (roleFilter === 'all' || row.role === roleFilter);
    });
  }, [roleFilter, search, sorted]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * USERS_PAGE_SIZE;
  const pageRows = filteredUsers.slice(pageStart, pageStart + USERS_PAGE_SIZE);
  const allCurrentPageSelected = pageRows.length > 0 && pageRows.every((row) => selectedIds.includes(row.id));

  const toggleSelected = (id: string) => {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };

  const toggleCurrentPage = () => {
    const currentIds = pageRows.map((row) => row.id);
    setSelectedIds((ids) => allCurrentPageSelected
      ? ids.filter((id) => !currentIds.includes(id))
      : [...new Set([...ids, ...currentIds])]);
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const updateRoleFilter = (value: string) => {
    setRoleFilter(value);
    setPage(1);
  };

  if (permLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (!can('users') || !isAdmin) {
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
        <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid min-w-0 w-full gap-3 sm:grid-cols-[minmax(0,24rem)_12rem] lg:max-w-xl">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="Buscar usuario"
              className="pl-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={updateRoleFilter}>
            <SelectTrigger className="w-full" aria-label="Filtrar por rol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">Todos los roles</SelectItem>
              {SELECTABLE_ROLES.map((role) => (
                <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          Nuevo usuario
        </Button>
      </div>

      <TablePanel aria-label="Directorio de usuarios">
        {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando usuarios…
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <UsersIcon className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No encontramos usuarios</p>
              <p className="text-sm text-muted-foreground">Prueba con otra búsqueda o filtro.</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-12 px-5">
                      <Checkbox checked={allCurrentPageSelected} onCheckedChange={toggleCurrentPage} aria-label="Seleccionar página" />
                    </TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="hidden md:table-cell">Rol</TableHead>
                    <TableHead className="hidden lg:table-cell">Permisos</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="w-20 text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={selectedIds.includes(row.id) ? 'selected' : undefined}
                    >
                      <TableCell className="px-5">
                        <Checkbox checked={selectedIds.includes(row.id)} onCheckedChange={() => toggleSelected(row.id)} aria-label={`Seleccionar ${row.email}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-52 items-center gap-3">
                          <Avatar size="default">
                            <AvatarFallback>{initials(row.name, row.email)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{row.name || 'Sin nombre'}</p>
                            <p className="truncate text-sm text-muted-foreground">{row.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className={roleBadgeClass(row.role)}>{roleLabel(row.role)}</Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">{row.permissions.length} accesos</TableCell>
                      <TableCell>
                        <Badge variant={row.active ? 'secondary' : 'outline'} className={row.active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : ''}>
                          {row.active ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Acciones">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-40">
                            <DropdownMenuItem disabled={!canManageRow(row)} onClick={() => openEdit(row)}>
                              <Pencil />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={!canManageRow(row)}
                              onClick={() => void remove(row)}
                            >
                              <Trash2 />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePanelFooter className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>Mostrando {pageStart + 1} a {Math.min(pageStart + pageRows.length, filteredUsers.length)} de {filteredUsers.length} usuarios</span>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <span className="mr-1 text-xs font-medium">
                    Página {currentPage} de {totalPages}
                  </span>
                  <Button variant="outline" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                    <ChevronLeft /> Anterior
                  </Button>
                  <Button variant="outline" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                    Siguiente <ChevronRight />
                  </Button>
                </div>
              </TablePanelFooter>
            </>
          )}
      </TablePanel>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
            <DialogDescription>
              Elige un rol predefinido o personaliza cada sección y subsección del menú.
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
              <div className="grid gap-2 sm:grid-cols-2">
                {editableRoles.map((role) => {
                  const preset = ROLE_PRESETS[role];
                  const active = form.role === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setRole(role)}
                      className={cn(
                        'rounded-lg border p-3 text-left transition',
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
              {!SELECTABLE_ROLES.includes(form.role) && (
                <p className="text-xs text-muted-foreground">
                  Esta cuenta usa un perfil anterior. Elige Operador o Facturación para actualizarla.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>Accesos del menú</Label>
              {form.role === 'vendedor' ? (
                <p className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground">
                  El vendedor solo accede a Mis ventas
                </p>
              ) : (
              <div className="grid gap-3">
                {permissionGroups.map((section) => (
                  <div key={section.key} className="overflow-hidden rounded-lg border border-border">
                    {(() => {
                      const keys = section.permissions.map((permission) => permission.key);
                      const checkedCount = keys.filter((key) => form.permissions.includes(key)).length;
                      const locked = isPermissionsLocked(form.role);
                      const sectionChecked = locked || checkedCount === keys.length
                        ? true
                        : checkedCount > 0 ? 'indeterminate' : false;
                      return (
                        <label className={cn(
                          'flex items-center gap-3 bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                          locked ? 'cursor-default' : 'cursor-pointer',
                        )}>
                          <Checkbox
                            checked={sectionChecked}
                            disabled={locked}
                            onCheckedChange={() => togglePermissionSection(keys)}
                          />
                          {section.label}
                        </label>
                      );
                    })()}
                    {section.permissions.map((perm, index) => {
                      const locked = isPermissionsLocked(form.role);
                      const checked = locked || form.permissions.includes(perm.key);
                      return (
                        <div key={perm.key}>
                          {index > 0 && <Separator />}
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
                ))}
              </div>
              )}
              {isAdminRole(form.role) && (
                <p className="text-xs text-muted-foreground">El administrador siempre tiene todos los módulos.</p>
              )}
            </div>

            {form.role === 'vendedor' && (
              <div className="grid gap-2">
                <Label htmlFor="user-commission">Comisión %</Label>
                <Input
                  id="user-commission"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.commissionPercent}
                  onChange={(e) => setForm((f) => ({ ...f, commissionPercent: e.target.value }))}
                />
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
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
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
