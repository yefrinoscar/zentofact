import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import {
  Camera,
  Clock3,
  Hash,
  ImageIcon,
  Loader2,
  QrCode,
  RotateCcw,
  ScanLine,
  Search,
  Store,
  UserRound,
  X,
} from 'lucide-react';
import api from '../lib/api';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';

type PickingItem = {
  orderItemId: string;
  name: string;
  sellerSku: string;
  shopSku: string;
  quantity: number;
  status: string;
  trackingCode: string;
  packageId: string;
  variation: Record<string, unknown>;
  imageUrl: string;
  imageUrls: string[];
};

type PickingPackage = {
  packageId: string;
  trackingCode: string;
  items: PickingItem[];
};

type PickingResult = {
  found: boolean;
  scan: { code: string; matchType: 'tracking' | 'package' | 'order' };
  order: {
    companyId: number;
    companyName: string;
    orderId: string;
    orderNumber: string;
    status: string;
    customerName: string;
    shippingType: string;
    sellerFacilityId: string;
    createdAt: string | null;
    updatedAt: string | null;
    promisedShippingTime: string | null;
    address: {
      addressLine: string;
      district: string;
      city: string;
      region: string;
    };
  };
  packages: PickingPackage[];
  itemCount: number;
  unitCount: number;
};

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  ready_to_ship: 'Lista para enviar',
  shipped: 'Enviada',
  delivered: 'Entregada',
  canceled: 'Cancelada',
  returned: 'Devuelta',
};

function statusLabel(status: string) {
  return statusLabels[String(status || '').toLowerCase()] || status || 'Sin estado';
}

function dateLabel(value: string | null) {
  if (!value) return 'No informada';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + '-05:00';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Lima',
  }).format(date);
}

function cameraFailureMessage(cameraFailure?: { name?: string }) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return 'El navegador bloqueó la cámara porque esta página está abierta por HTTP. Ábrela mediante HTTPS para escanear desde el teléfono.';
  }

  switch (cameraFailure?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'No tenemos permiso para usar la cámara. Habilítalo en la configuración del navegador y vuelve a intentarlo.';
    case 'NotFoundError':
      return 'No encontramos una cámara disponible en este dispositivo.';
    case 'NotReadableError':
    case 'AbortError':
      return 'No pudimos usar la cámara. Cierra cualquier otra aplicación que la esté usando y vuelve a intentarlo.';
    default:
      return 'No pudimos abrir la cámara. También puedes cerrar esta pantalla e ingresar el código manualmente.';
  }
}

export default function ScannerArmado() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PickingResult | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [showManualSearch, setShowManualSearch] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const scanHandledRef = useRef(false);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOpen(false);
  }, []);

  const lookup = useCallback(async (value: string) => {
    const scanned = String(value || '').trim();
    if (!scanned) {
      setError('Escanea un QR o escribe el número de tracking u orden.');
      return;
    }
    stopCamera();
    setCode(scanned);
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await api.scanPickingTicket(scanned));
    } catch (lookupError: any) {
      setError(lookupError?.message || 'No pudimos encontrar la etiqueta.');
    } finally {
      setLoading(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;
    scanHandledRef.current = false;
    setCameraError('');

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(cameraFailureMessage());
      return;
    }

    const reader = new BrowserMultiFormatReader();
    let cancelled = false;
    reader.decodeFromConstraints({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    }, videoRef.current, (scanResult) => {
      if (!scanResult || scanHandledRef.current || cancelled) return;
      scanHandledRef.current = true;
      void lookup(scanResult.getText());
    }).then((controls) => {
      if (cancelled) controls.stop();
      else controlsRef.current = controls;
    }).catch((cameraFailure: any) => {
      if (cancelled) return;
      setCameraError(cameraFailureMessage(cameraFailure));
    });
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [cameraOpen, lookup]);

  useEffect(() => {
    if (!cameraOpen || !window.matchMedia('(max-width: 1023px)').matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [cameraOpen]);

  useEffect(() => () => controlsRef.current?.stop(), []);

  useEffect(() => {
    if (!result) return;
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'start' }));
  }, [result]);

  const reset = () => {
    stopCamera();
    setCode('');
    setError('');
    setResult(null);
    setCameraError('');
    setShowManualSearch(false);
  };

  return (
    <div className="min-h-full space-y-4 bg-background p-4 md:space-y-6 md:p-0">
      {!result && (
      <section className="mx-auto w-full max-w-xl">
        <Card className="border-0 ring-1 ring-border/70">
          <CardHeader className="items-center gap-3 pb-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm">
              <QrCode className="size-7" />
            </div>
            <div>
              <CardTitle className="text-2xl font-semibold">Escanea el QR de la etiqueta</CardTitle>
              <CardDescription className="mx-auto mt-2 max-w-md leading-relaxed">
                Apunta al <strong className="font-semibold text-foreground">QR cuadrado grande</strong> que está junto a “N.º Bultos” en la etiqueta de Falabella.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              type="button"
              size="lg"
              className="h-14 w-full text-base"
              onClick={() => cameraOpen ? stopCamera() : setCameraOpen(true)}
            >
              {cameraOpen ? <X /> : <Camera />}
              {cameraOpen ? 'Cerrar cámara' : 'Abrir cámara y escanear'}
            </Button>

            {!showManualSearch ? (
              <button
                type="button"
                className="mx-auto block text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setShowManualSearch(true)}
              >
                Buscar por código manualmente
              </button>
            ) : (
            <div className="rounded-2xl border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Alternativa: ingresa el tracking o número de orden</p>
            <form
              className="flex flex-col gap-3 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void lookup(code);
              }}
            >
              <div className="relative flex-1">
                <Hash className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Tracking u orden, por ejemplo 240121..."
                  className="h-11 pl-9 font-mono text-sm"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <Button type="submit" className="h-11 px-5" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <Search />}
                Buscar
              </Button>
            </form>
            </div>
            )}
            <p className="text-center text-xs text-muted-foreground">La información del bulto aparecerá automáticamente al reconocer el QR.</p>
          </CardContent>
        </Card>
      </section>
      )}

      {cameraOpen && (
        <div className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col overflow-hidden bg-black text-white lg:static lg:min-h-0 lg:rounded-[1.75rem] lg:ring-1 lg:ring-neutral-800">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] lg:hidden">
            <div className="min-w-0">
              <p className="font-semibold">Escanear QR</p>
              <p className="truncate text-sm text-white/60">El QR cuadrado junto a “N.º Bultos”</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={stopCamera}
              aria-label="Cerrar cámara"
            >
              <X />
            </Button>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden bg-black lg:mx-auto lg:aspect-video lg:w-full lg:max-w-3xl lg:flex-none">
            <video ref={videoRef} className="size-full object-cover" autoPlay muted playsInline />
            {!cameraError && (
              <>
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10">
                  <div className="relative aspect-square w-[min(68vw,18rem)] border border-white/35 shadow-[0_0_0_999px_rgba(0,0,0,.38)]">
                    <QrFinder className="-left-1 -top-1" />
                    <QrFinder className="-right-1 -top-1" />
                    <QrFinder className="-bottom-1 -left-1" />
                  </div>
                </div>
                <p className="absolute inset-x-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-sm font-medium text-white drop-shadow lg:bottom-5">
                  Centra solo el QR dentro del cuadro
                </p>
              </>
            )}

            {cameraError && (
              <div className="absolute inset-0 grid place-items-center px-6">
                <div className="max-w-sm text-center">
                  <span className="mx-auto grid size-14 place-items-center rounded-full bg-white/10">
                    <Camera className="size-6 text-white/80" />
                  </span>
                  <p className="mt-4 text-base font-semibold">No se pudo abrir la cámara</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{cameraError}</p>
                  <Button type="button" variant="secondary" className="mt-5" onClick={stopCamera}>
                    <X />
                    Cerrar y escribir el código
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {loading && (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex min-h-40 items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span>Buscando la etiqueta y consultando sus productos…</span>
          </CardContent>
        </Card>
      )}

      {error && !loading && (
        <Card className="border-destructive/30 bg-destructive/5 shadow-none">
          <CardContent className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold text-destructive">No encontramos la etiqueta</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
            <Button variant="outline" onClick={reset}><RotateCcw />Intentar otra vez</Button>
          </CardContent>
        </Card>
      )}

      {result && !loading && <PickingResultView ref={resultRef} result={result} onReset={reset} />}
    </div>
  );
}

function PickingResultView({
  ref,
  result,
  onReset,
}: {
  ref: React.Ref<HTMLElement>;
  result: PickingResult;
  onReset: () => void;
}) {
  const { order } = result;
  const items = result.packages.flatMap((pkg) => pkg.items);
  return (
    <section ref={ref} className="space-y-4 md:space-y-5">
      <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:rounded-2xl md:border md:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Orden {order.orderNumber}</span>
            <Badge variant="outline" className="hidden sm:inline-flex">{statusLabel(order.status)}</Badge>
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{result.scan.code}</p>
        </div>
        <Button className="shrink-0" onClick={onReset}><ScanLine />Escanear de nuevo</Button>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Productos del bulto</h2>
        <p className="text-sm text-muted-foreground">{result.itemCount} producto{result.itemCount === 1 ? '' : 's'} · {result.unitCount} unidad{result.unitCount === 1 ? '' : 'es'}</p>
      </div>

      <Card className="border-0 ring-1 ring-border/80">
        <CardContent className="divide-y p-0">
          {items.map((item) => <ProductRow key={item.orderItemId || item.sellerSku} item={item} />)}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ResultFact icon={Store} label="Seller" value={order.companyName || order.sellerFacilityId} className="col-span-2 sm:col-span-1" />
        <ResultFact icon={Clock3} label="Entregar antes de" value={dateLabel(order.promisedShippingTime)} />
        <ResultFact icon={UserRound} label="Cliente" value={order.customerName || 'No informado'} />
      </div>
    </section>
  );
}

function QrFinder({ className }: { className: string }) {
  return (
    <span className={`absolute grid size-14 place-items-center border-[5px] border-white ${className}`}>
      <span className="size-6 bg-white" />
    </span>
  );
}

function ResultFact({ icon: Icon, label, value, className = '' }: { icon: typeof UserRound; label: string; value: string; className?: string }) {
  return (
    <div className={`flex min-w-0 items-start gap-2.5 rounded-xl border bg-muted/20 px-3 py-2.5 ${className}`}>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 break-words text-xs font-medium leading-snug sm:text-sm">{value}</p>
      </div>
    </div>
  );
}

function ProductRow({ item }: { item: PickingItem }) {
  const candidates = [...new Set([item.imageUrl, ...(item.imageUrls || [])].filter(Boolean))];
  const [imageIndex, setImageIndex] = useState(0);
  const imageUrl = candidates[imageIndex] || '';
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_56px] items-center gap-x-3 gap-y-3 p-3 sm:grid-cols-[132px_minmax(0,1fr)_88px] sm:gap-4 sm:p-5">
      <div className="relative col-span-2 grid h-56 w-full place-items-center overflow-hidden rounded-2xl border bg-white sm:col-span-1 sm:aspect-square sm:h-auto">
        <ImageIcon className="size-6 text-neutral-300" />
        {imageUrl && (
          <img
            src={imageUrl}
            alt={item.name}
            className="absolute inset-0 size-full object-contain p-2"
            onError={() => setImageIndex((current) => current + 1)}
          />
        )}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-snug sm:text-base">{item.name || 'Producto sin nombre'}</h3>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground sm:mt-2 sm:text-xs">
          <span>SKU: <strong className="font-mono font-medium text-foreground">{item.sellerSku || 'No informado'}</strong></span>
          {item.shopSku && <span>ShopSku: <strong className="font-mono font-medium text-foreground">{item.shopSku}</strong></span>}
        </div>
      </div>
      <div className="flex flex-col items-center justify-center rounded-xl bg-muted/50 px-1 py-2 sm:rounded-2xl sm:px-2 sm:py-3">
        <span className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-[10px]">Cant.</span>
        <span className="text-xl font-semibold tabular-nums sm:text-2xl">{item.quantity}</span>
      </div>
    </article>
  );
}
