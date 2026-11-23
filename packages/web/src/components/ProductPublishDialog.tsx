import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { cn } from '../lib/cn';
import { productImageSrc } from '../lib/logistics-inbox';
import { productGalleryUrls, productPublicationText, type SalespersonProduct } from '../lib/catalogo-vendedor';
import { ProductPhoto } from '../routes/registrar-venta/widgets';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog';

const PUBLISH_TIPS = [
  'Portada: la foto 1, con fondo limpio. Es la que decide el clic.',
  'Suma 2 a 4 fotos más: detalles, medidas o el producto en uso.',
  'No edites precio ni textos sobre la foto; ponlos en la descripción.',
  'Publica solo con stock y responde rápido: confirma antes de cerrar la venta.',
];

function fileExtension(src: string) {
  const match = src.match(/\.(png|jpe?g|webp|svg)(?:$|[?#])/i);
  return match ? match[1].toLowerCase() : 'jpg';
}

function GalleryPhotos({ product }: { product: SalespersonProduct }) {
  const photos = productGalleryUrls(product.imageUrl).map((raw) => productImageSrc(raw)).filter(Boolean);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState(0);
  const visible = photos.filter((src) => !failed.has(src));
  const current = visible[Math.min(selected, visible.length - 1)] || '';
  const currentIndex = photos.indexOf(current);
  const markFailed = (src: string) => setFailed((prev) => new Set(prev).add(src));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative overflow-hidden rounded-lg bg-white ring-1 ring-border">
        {current ? (
          <img
            key={current}
            src={current}
            alt={`${product.name} · foto ${currentIndex + 1}`}
            decoding="async"
            onError={() => markFailed(current)}
            className="mx-auto aspect-square max-h-[55vh] w-full object-contain"
          />
        ) : (
          <div className="grid aspect-square w-full place-items-center text-sm text-muted-foreground">Sin foto disponible</div>
        )}
        {current ? (
          <Button asChild size="sm" variant="secondary" className="absolute bottom-2 right-2 shadow-sm">
            <a href={current} download={`${product.sku}-${currentIndex + 1}.${fileExtension(current)}`}>
              <Download className="size-4" />
              Descargar
            </a>
          </Button>
        ) : null}
      </div>
      {visible.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Fotos del producto">
          {photos.map((src, index) => (failed.has(src) ? null : (
            <button
              key={src}
              type="button"
              role="listitem"
              aria-label={`Ver foto ${index + 1}`}
              aria-current={src === current}
              onClick={() => setSelected(visible.indexOf(src))}
              className={cn(
                'relative size-14 overflow-hidden rounded-md bg-white ring-1 ring-border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                src === current ? 'ring-2 ring-primary' : 'opacity-75 hover:opacity-100',
              )}
            >
              <img src={src} alt="" loading="lazy" decoding="async" onError={() => markFailed(src)} className="size-full object-contain" />
              <span className="absolute left-0.5 top-0.5 rounded bg-background/90 px-1 text-[10px] font-semibold tabular-nums">{index + 1}</span>
            </button>
          )))}
        </div>
      ) : null}
    </div>
  );
}

function CopyPublicationText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Texto para publicar</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      <p className="whitespace-pre-line rounded-md bg-muted/60 px-3 py-2 text-sm leading-6">{text}</p>
    </div>
  );
}

/** Miniatura que abre la galería del producto con todo lo necesario para publicarlo. */
export function ProductPublishDialog({ product }: { product: SalespersonProduct }) {
  const [unavailable, setUnavailable] = useState(false);
  const thumbnail = (
    <ProductPhoto url={product.imageUrl} sku={product.sku} name={product.name} size="md" onUnavailable={() => setUnavailable(true)} />
  );
  if (!product.imageUrl || unavailable) return thumbnail;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Ver fotos de ${product.name}`}
          className="shrink-0 cursor-zoom-in rounded-md transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {thumbnail}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto p-4 sm:max-w-4xl sm:p-5">
        <div className="pr-10">
          <DialogTitle className="text-base leading-6">{product.name}</DialogTitle>
          <DialogDescription className="mt-0.5">Fotos y texto listos para publicar.</DialogDescription>
        </div>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
          <GalleryPhotos product={product} />
          <div className="flex flex-col gap-5">
            <CopyPublicationText text={productPublicationText(product)} />
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cómo publicarlo</p>
              <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-sm leading-5 marker:text-muted-foreground">
                {PUBLISH_TIPS.map((tip) => <li key={tip}>{tip}</li>)}
              </ol>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
