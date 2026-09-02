// PROTOTYPE B — "Mesa de trabajo": lista compacta a la izquierda, pedido seleccionado en grande a la derecha.
import { useState } from 'react';
import { Loader2, PackageCheck, Printer, RefreshCw, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { sellerShortName } from '../../lib/seller-name';
import {
  canMarkFalabellaReady,
  canPrintLogisticsLabel,
  formatLogisticsDateTime,
  labelPrintTooltip,
  labelWasPrinted,
  logisticsChannelClass,
  logisticsChannelDotClass,
  logisticsChannelLabel,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsElapsedLabel,
  logisticsFlowSteps,
  logisticsUrgency,
  logisticsUrgencyMeta,
  LOGISTICS_STAGES,
} from '../../lib/logistics-inbox';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ActionButton, groupByUrgency, ProductThumb, QuantityTag, type BandejaView } from './shared';

export function VariantB({ view }: { view: BandejaView }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = view.orders.find((order) => order.id === selectedId) || view.orders[0] || null;
  const groups = groupByUrgency(view.orders, view.now);
  const printable = view.orders.filter(canPrintLogisticsLabel);
  const readyCandidates = view.orders.filter(canMarkFalabellaReady);
  const urgency = selected ? logisticsUrgency(selected, view.now) : null;
  const meta = urgency ? logisticsUrgencyMeta(urgency) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className="flex min-h-[70vh] flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="space-y-2 border-b border-border p-2">
          <div role="tablist" aria-label="Flujo de pedidos" className="grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5">
            {LOGISTICS_STAGES.map((tab) => (
              <button key={tab.value} type="button" role="tab" aria-selected={view.stage === tab.value} onClick={() => view.setStage(tab.value)}
                className={cn('flex items-center justify-center gap-1 rounded px-1 py-1 text-[11px] font-medium', view.stage === tab.value ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
                <span className="truncate">{tab.label.replace(' para enviar', '')}</span>
                <span className="font-semibold tabular-nums">{view.counts[tab.value]}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={view.searchInput} onChange={(event) => view.setSearchInput(event.target.value)} placeholder="Buscar pedido" aria-label="Buscar pedidos" className="h-8 pl-7 text-xs shadow-none" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {view.orders.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">{view.emptyCopy}</p>}
          {groups.map((group) => {
            const groupMeta = logisticsUrgencyMeta(group.key);
            return (
              <div key={group.key}>
                {view.stage !== 'shipped' && (
                  <p className="sticky top-0 z-10 flex items-center gap-1.5 bg-muted/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                    <span className={cn('size-1.5 rounded-full', groupMeta.dotClass)} />{groupMeta.label} · {group.orders.length}
                  </p>
                )}
                {group.orders.map((order) => {
                  const active = selected?.id === order.id;
                  return (
                    <button key={order.id} type="button" onClick={() => setSelectedId(order.id)}
                      className={cn('flex w-full items-start gap-2 border-b border-border/70 px-3 py-2 text-left transition', active ? 'bg-primary/5' : 'hover:bg-muted/50')}>
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', logisticsChannelDotClass(order.channelCode))} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs font-semibold">{order.externalOrderNumber}</span>
                          <span className={cn('shrink-0 text-[11px]', group.key === 'overdue' ? 'font-semibold text-rose-700' : 'text-muted-foreground')}>{logisticsDeadlineLabel(order, view.now)}</span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{order.customer?.name || 'Sin cliente'} · {order.itemsCount} unid.</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border p-2 text-[11px] text-muted-foreground">
          <span>{view.totalCount} pedidos</span>
          <div className="flex gap-1">
            {printable.length > 0 && view.stage !== 'shipped' && (
              <Button size="xs" variant="outline" onClick={() => view.printOrders(printable)} disabled={view.printing}><Printer /> Imprimir {printable.length}</Button>
            )}
            {readyCandidates.length > 0 && view.canDispatch && (
              <Button size="xs" variant="outline" onClick={() => view.requestBulkReady(readyCandidates)}><PackageCheck /> Listo x{readyCandidates.length}</Button>
            )}
            <Button size="icon-xs" variant="ghost" onClick={view.refresh} disabled={view.refreshing} aria-label="Sincronizar">{view.refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button>
          </div>
        </div>
      </aside>

      <main className="min-w-0">
        {!selected ? (
          <p className="py-20 text-center text-sm text-muted-foreground">Elige un pedido de la lista.</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-mono text-2xl font-semibold tracking-tight">{selected.externalOrderNumber}</h2>
                  <Badge variant="outline" className={cn('rounded-md', logisticsChannelClass(selected.channelCode))}>{logisticsChannelLabel(selected.channelCode)}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{selected.customer?.name || 'Sin cliente'} · {sellerShortName(selected.companyName)} · {logisticsDeliveryLabel(selected)} · ingresó {logisticsElapsedLabel(selected.createdAt || selected.orderedAt, view.now)}</p>
              </div>
              <div className={cn('rounded-lg px-4 py-2 text-right', meta?.pillClass)}>
                <p className="text-[10px] font-medium uppercase tracking-wide opacity-80">Entrega</p>
                <p className="text-base font-semibold">{view.stage === 'shipped' ? formatLogisticsDateTime(selected.updatedAt) : logisticsDeadlineLabel(selected, view.now)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              {logisticsFlowSteps(selected).map((step, index) => (
                <div key={step.label} className={cn('rounded-md border px-2 py-2', step.state === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : step.state === 'current' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-border text-muted-foreground')}>
                  <span className="font-semibold">{index + 1}</span> · {step.label}
                </div>
              ))}
            </div>

            <ul className="divide-y divide-border rounded-lg border border-border">
              {selected.items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 p-3">
                  <ProductThumb item={item} className="size-16" />
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">{item.sku}</p>
                  </div>
                  <QuantityTag item={item} size="lg" />
                </li>
              ))}
            </ul>

            {(selected.shipping?.address || selected.customer?.phone) && (
              <p className="text-sm text-muted-foreground">{[selected.shipping?.address, selected.shipping?.district, selected.customer?.phone && `Tel. ${selected.customer.phone}`].filter(Boolean).join(' · ')}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <ActionButton order={selected} view={view} size="default" />
              {labelWasPrinted(selected) && <span className="self-center text-xs text-emerald-700">{labelPrintTooltip(selected)}</span>}
              <Button variant="ghost" onClick={() => view.openOrder(selected)}>Ver ficha</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
