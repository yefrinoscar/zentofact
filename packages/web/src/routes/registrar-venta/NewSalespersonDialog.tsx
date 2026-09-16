import { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import api from '../../lib/api';
import { ROLE_PRESETS } from '../../lib/permissions';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import type { SalespersonOption } from './view';

type Draft = {
  name: string;
  email: string;
  password: string;
  commissionPercent: string;
};

const emptyDraft = (): Draft => ({
  name: '',
  email: '',
  password: '',
  commissionPercent: '0',
});

export function NewSalespersonDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (salesperson: SalespersonOption) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    if (saving) return;
    setDraft(emptyDraft());
    setError('');
    onOpenChange(false);
  };

  const create = async () => {
    const name = draft.name.trim();
    const email = draft.email.trim();
    const commissionPercent = Number(draft.commissionPercent || 0);
    if (!name) return setError('Escribe el nombre de la vendedora.');
    if (!email) return setError('Escribe el correo de la vendedora.');
    if (draft.password.length < 12) return setError('La contraseña debe tener al menos 12 caracteres.');
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      return setError('La comisión debe estar entre 0 y 100.');
    }

    setSaving(true);
    setError('');
    try {
      const created = await api.createUser({
        name,
        email,
        password: draft.password,
        role: 'vendedor',
        permissions: [...ROLE_PRESETS.vendedor.permissions],
        active: true,
        commissionPercent,
      });
      await onCreated({ id: created.id, name: created.name || name });
      setDraft(emptyDraft());
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo crear la vendedora.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!saving}>
        <DialogHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <UserPlus className="size-5" />
          </div>
          <DialogTitle>Nueva vendedora</DialogTitle>
          <DialogDescription>
            Crea su acceso a Mis ventas. Quedará elegida en esta venta.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="new-salesperson-name">Nombre</Label>
            <Input
              id="new-salesperson-name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              autoComplete="name"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-salesperson-email">Correo</Label>
            <Input
              id="new-salesperson-email"
              type="email"
              value={draft.email}
              onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
              autoComplete="email"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-salesperson-password">Contraseña</Label>
            <Input
              id="new-salesperson-password"
              type="password"
              value={draft.password}
              onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">Mínimo 12 caracteres.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-salesperson-commission">Comisión %</Label>
            <Input
              id="new-salesperson-commission"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={draft.commissionPercent}
              onChange={(event) => setDraft((current) => ({ ...current, commissionPercent: event.target.value }))}
              inputMode="decimal"
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <UserPlus />}
              {saving ? 'Creando…' : 'Crear vendedora'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
