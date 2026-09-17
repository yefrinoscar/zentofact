import { useEffect, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { PAYMENT_RECIPIENTS, type PaymentRecipient } from '../lib/registrar-venta';
import { readPaymentProof, type PaymentProof } from '../lib/payment-proof';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Choice } from '../routes/registrar-venta/widgets';

export type SalePaymentDraft = {
  number: string;
  payment: string;
  paidToValue: string;
  hasProof: boolean;
  proofName: string | null;
  proofUrl: string | null;
};

export function SalePaymentDialog({
  sale,
  busy,
  error,
  onClose,
  onSave,
}: {
  sale: SalePaymentDraft | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (input: { paidTo: PaymentRecipient; paymentProof: PaymentProof | null }) => void;
}) {
  const [paidTo, setPaidTo] = useState<PaymentRecipient>('empresa');
  const [paymentProof, setPaymentProof] = useState<PaymentProof | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!sale) return;
    setPaidTo(sale.paidToValue === 'vendedor' ? 'vendedor' : 'empresa');
    setPaymentProof(null);
    setPreviewUrl(sale.proofUrl);
    setLocalError('');
  }, [sale]);

  const attachProof = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLocalError('La constancia debe ser una foto o captura.');
      return;
    }
    void readPaymentProof(file)
      .then((proof) => {
        setPaymentProof(proof);
        setPreviewUrl(proof.dataUrl);
        setLocalError('');
      })
      .catch((attachError: Error) => {
        setLocalError(attachError.message || 'No se pudo adjuntar la constancia.');
      });
  };

  const hasPreview = Boolean(previewUrl);
  const canSave = Boolean(paymentProof) || paidTo !== (sale?.paidToValue || 'empresa') || Boolean(sale?.hasProof);

  return (
    <Dialog open={Boolean(sale)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pago {sale?.number || ''}</DialogTitle>
          <DialogDescription>
            {sale ? `${sale.payment}. Quién cobró y la constancia.` : ''}
          </DialogDescription>
        </DialogHeader>
        {(localError || error) && (
          <p role="alert" className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/20">
            {localError || error}
          </p>
        )}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">Pagaron a</p>
            <Choice
              value={paidTo}
              options={PAYMENT_RECIPIENTS}
              onChange={setPaidTo}
              ariaLabel="A quién pagaron"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">Constancia</p>
            {hasPreview ? (
              <div className="space-y-2">
                <button
                  type="button"
                  className="block w-full cursor-pointer overflow-hidden rounded-md ring-1 ring-border"
                  onClick={() => window.open(previewUrl || '', '_blank', 'noopener,noreferrer')}
                  aria-label="Ver constancia"
                >
                  <img src={previewUrl || ''} alt="Constancia de pago" className="max-h-72 w-full object-contain bg-muted" />
                </button>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {paymentProof?.name || sale?.proofName || 'Constancia'}
                  </span>
                  {paymentProof ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-8 cursor-pointer"
                      aria-label="Quitar constancia"
                      onClick={() => {
                        setPaymentProof(null);
                        setPreviewUrl(sale?.proofUrl || null);
                      }}
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin constancia</p>
            )}
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
              <ImagePlus className="size-4" />
              {hasPreview ? 'Reemplazar foto' : 'Subir constancia'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => attachProof(event.target.files?.[0])}
              />
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            Cerrar
          </Button>
          <Button
            type="button"
            className="cursor-pointer"
            disabled={busy || !canSave}
            onClick={() => onSave({ paidTo, paymentProof })}
          >
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
            {busy ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
