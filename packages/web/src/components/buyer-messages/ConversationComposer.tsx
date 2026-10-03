import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Loader2, Paperclip, Send, WifiOff, X } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  BUYER_ATTACHMENT_ACCEPT,
  BUYER_MESSAGE_MAX,
  validateBuyerAttachment,
} from '../../lib/buyer-messages';

type AttachmentState = {
  file: File;
  status: 'uploading' | 'ready' | 'error';
  progress: number;
  id?: string;
  error?: string;
};

const drafts = new Map<number, string>();

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function ConversationComposer({
  orderId,
  disabledReason,
  sending,
  onSend,
}: {
  orderId: number;
  disabledReason: 'no-permission' | 'waiting-buyer' | null;
  sending: boolean;
  onSend: (input: { text: string; attachmentId?: string; attachmentName?: string }) => void;
}) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const coarse = useMemo(() => (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches), []);
  const [text, setText] = useState(() => drafts.get(orderId) || '');
  const [attachment, setAttachment] = useState<AttachmentState | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const trimmed = text.trim();
  const overLimit = trimmed.length > BUYER_MESSAGE_MAX;
  const canSend = online && !sending && !disabledReason && trimmed.length > 0 && !overLimit;

  const updateText = (value: string) => {
    setText(value);
    drafts.set(orderId, value);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    const problem = validateBuyerAttachment(file);
    if (problem === 'size') {
      setFileError('El archivo supera 25 MB.');
      return;
    }
    if (problem === 'type') {
      setFileError('Solo se permiten JPG, PNG, PDF o TXT.');
      return;
    }
    setAttachment({ file, status: 'uploading', progress: 0 });
    try {
      const uploaded = await api.buyerMessagesUploadAttachment(orderId, file, (progress) => {
        setAttachment((current) => (current && current.file === file ? { ...current, progress } : current));
      });
      setAttachment({ file, status: 'ready', progress: 100, id: uploaded.attachmentId });
    } catch (error: any) {
      setAttachment({
        file,
        status: 'error',
        progress: 0,
        error: String(error?.message || 'No se pudo subir el adjunto.'),
      });
    }
  };

  const send = () => {
    if (!canSend) return;
    onSend({
      text: trimmed,
      attachmentId: attachment?.status === 'ready' ? attachment.id : undefined,
      attachmentName: attachment?.status === 'ready' ? attachment.file.name : undefined,
    });
    setText('');
    drafts.delete(orderId);
    setAttachment(null);
    setFileError(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (coarse) return;
    event.preventDefault();
    send();
  };

  return (
    <div className="border-t bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      {!online && (
        <p className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          <WifiOff className="size-3.5 shrink-0" />
          Sin conexión. Tu mensaje se mantendrá aquí hasta que vuelvas a estar en línea.
        </p>
      )}
      {attachment && (
        <div className={cn(
          'mb-2 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
          attachment.status === 'error' && 'border-destructive/40 text-destructive',
        )}>
          <span className="min-w-0 flex-1 truncate">{attachment.file.name}</span>
          {attachment.status === 'uploading' && <span className="tabular-nums text-muted-foreground">{attachment.progress} %</span>}
          {attachment.status === 'error' && (
            <Button variant="ghost" size="xs" onClick={() => void pickFile(attachment.file)}>Reintentar</Button>
          )}
          <button
            type="button"
            aria-label={`Quitar ${attachment.file.name}`}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={() => setAttachment(null)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <textarea
        rows={2}
        value={text}
        disabled={Boolean(disabledReason) || !online}
        onChange={(event) => updateText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={disabledReason === 'waiting-buyer' ? 'Disponible cuando el comprador escriba' : 'Escribe una respuesta…'}
        aria-label="Mensaje para el comprador"
        aria-describedby={overLimit ? `buyer-message-limit-${orderId}` : undefined}
        className="max-h-40 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      {overLimit && (
        <p id={`buyer-message-limit-${orderId}`} className="mt-1 text-xs text-destructive">
          Máximo {BUYER_MESSAGE_MAX} caracteres. Quita {trimmed.length - BUYER_MESSAGE_MAX} para enviar.
        </p>
      )}
      {fileError && <p className="mt-1 text-xs text-destructive">{fileError}</p>}
      {disabledReason === 'waiting-buyer' && (
        <p className="mt-1 text-xs text-muted-foreground">
          Mercado Libre solo permite responder cuando el comprador escribe primero.
        </p>
      )}
      {disabledReason === 'no-permission' && (
        <p className="mt-1 text-xs text-muted-foreground">Tu rol puede ver la conversación, pero no responder.</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={BUYER_ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            void pickFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Adjuntar archivo"
          title="Adjuntar JPG, PNG, PDF o TXT (máx. 25 MB)"
          disabled={Boolean(disabledReason) || !online || Boolean(attachment)}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip />
        </Button>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">Enter envía · Shift+Enter nueva línea</span>
        <span className={cn(
          'ml-auto text-xs tabular-nums',
          trimmed.length > BUYER_MESSAGE_MAX ? 'font-medium text-destructive' : trimmed.length > 300 ? 'text-amber-700' : 'text-muted-foreground',
        )}>
          {trimmed.length}/{BUYER_MESSAGE_MAX}
        </span>
        <Button size="sm" disabled={!canSend} onClick={send}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />}Enviar
        </Button>
      </div>
    </div>
  );
}
