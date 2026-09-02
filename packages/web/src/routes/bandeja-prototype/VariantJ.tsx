// J — Impresión: riel de etapas + cola con checkbox. El trabajo es armar el PDF.
import { Loader2, Printer, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  canPrintLogisticsLabel,
  labelWasPrinted,
  logisticsChannelDotClass,
  logisticsDeadlineLabel,
  logisticsUrgency,
  logisticsUrgencyMeta,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { EmptyState, ProductThumb, QuantityTag, type BandejaView } from './shared';

export function VariantJ({ view }: { view: BandejaView }) {
  const printable = view.orders.filter(canPrintLogisticsLabel);
  const selected = printable.filter((order) => view.labelSelection?.has(order.id));
  const selecting = view.labelSelection !== null;

  const startSelection = () => {
    view.setLabelSelection(new Set(printable.filter((order) => !labelWasPrinted(order)).map((order) => order.id)));
  };

  return (
    <div className="grid gap-4 pb-24 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <aside className="space-y-1">
        {LOGISTICS_STAGES.map((tab) => {
          const active = view.stage === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => view.setStage(tab.value)}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm',
                active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <span>{tab.label}</span>
              <span className="font-mono text-xs">{view.counts[tab.value]}</span>
            </button>
          );
        })}
        <Button size="sm" variant="ghost" className="mt-2 w-full justify-start" onClick={view.refresh} disabled={view.refreshing}>
          <RefreshCw className={cn(view.refreshing && 'animate-spin')} />
          {view.canSync ? 'Sincronizar' : 'Actualizar'}
        </Button>
      </aside>

      <div>
        <EmptyState view={view}>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {view.orders.map((order) => {
              const printableOrder = canPrintLogisticsLabel(order);
              const checked = Boolean(view.labelSelection?.has(order.id));
              const meta = logisticsUrgencyMeta(logisticsUrgency(order, view.now));
              return (
                <li key={order.id} className={cn('flex items-center gap-3 px-3 py-2', checked && 'bg-primary/5')}>
                  {selecting && printableOrder && (
                    <Checkbox checked={checked} onCheckedChange={() => view.toggleLabel(order)} aria-label={`Seleccionar ${order.externalOrderNumber}`} />
                  )}
                  <span className={cn('size-2 shrink-0 rounded-full', logisticsChannelDotClass(order.channelCode))} />
                  <button type="button" onClick={() => view.openOrder(order)} className="w-28 truncate text-left font-mono text-sm font-semibold hover:underline">
                    {order.externalOrderNumber}
                  </button>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {order.items.map((item) => (
                      <span key={item.id} className="flex items-center gap-1.5">
                        <ProductThumb item={item} className="size-8 rounded" />
                        <QuantityTag item={item} />
                      </span>
                    ))}
                  </div>
                  <span className="hidden truncate text-xs text-muted-foreground md:block">{sellerShortName(order.companyName)}</span>
                  <span className={cn('w-28 text-right text-xs font-semibold', meta.textClass)}>{logisticsDeadlineLabel(order, view.now)}</span>
                  {labelWasPrinted(order) && <span className="text-[11px] text-emerald-700">impresa</span>}
                </li>
              );
            })}
          </ul>
        </EmptyState>
      </div>

      {view.stage !== 'shipped' && printable.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 lg:bottom-20">
          <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 shadow-lg">
            {selecting ? (
              <>
                <span className="text-xs">{selected.length} de {printable.length}</span>
                <Button size="sm" variant="ghost" onClick={() => view.setLabelSelection(null)}>Cancelar</Button>
                <Button size="sm" onClick={() => view.printOrders(selected)} disabled={!selected.length || view.printing}>
                  {view.printing ? <Loader2 className="animate-spin" /> : <Printer />}
                  Imprimir {selected.length || ''}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={startSelection}>
                <Printer /> Elegir etiquetas
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
