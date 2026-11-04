import { useState } from 'react';
import { authClient } from '../lib/authClient';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

const PASSWORD_MIN_LENGTH = 12;

function errorMessage(code?: string, message?: string) {
  if (code === 'INVALID_PASSWORD') return 'La contraseña actual no es correcta.';
  if (code === 'PASSWORD_TOO_SHORT') return `La contraseña nueva debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') return 'Tu cuenta no tiene contraseña. Usa “¿Olvidaste tu contraseña?” en el inicio de sesión.';
  return message || 'No se pudo cambiar la contraseña.';
}

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCurrent(''); setNext(''); setConfirm(''); setError(''); setDone(false); setSaving(false);
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) reset();
    onOpenChange(value);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < PASSWORD_MIN_LENGTH) {
      setError(`La contraseña nueva debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (next !== confirm) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (next === current) {
      setError('La contraseña nueva debe ser distinta de la actual.');
      return;
    }
    setSaving(true);
    const { error: nextError } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setSaving(false);
    if (nextError) {
      setError(errorMessage(nextError.code, nextError.message));
      return;
    }
    setCurrent(''); setNext(''); setConfirm('');
    setDone(true);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
          <DialogDescription>
            {done
              ? 'Listo. Tu contraseña se actualizó y se cerraron tus sesiones en otros dispositivos.'
              : `Ingresa tu contraseña actual y elige una nueva de al menos ${PASSWORD_MIN_LENGTH} caracteres.`}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <DialogFooter>
            <Button type="button" onClick={() => handleOpenChange(false)}>Cerrar</Button>
          </DialogFooter>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="current-password">Contraseña actual</Label>
              <Input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-password">Contraseña nueva</Label>
              <Input id="new-password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-password">Repite la contraseña nueva</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Cambiar contraseña'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
