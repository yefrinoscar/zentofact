import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, PackageCheck, Printer, RefreshCw, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/cn';
import { sellerShortName } from '../lib/seller-name';
import {
  canMarkFalabellaReady, canPrintLogisticsLabel, groupLogisticsByUrgency,
  labelWasPrinted, logisticsDeadlineLabel, logisticsUpdatedClock,
  LOGISTICS_CHANNELS, LOGISTICS_URGENCIES,
} from '../lib/logistics-inbox';
import {
  ChannelMark, CopyableOrderNumber, ProductThumb, ProductImageLightbox, QuantityTag,
  type BandejaView, type LogisticsOrder,
} from './bandeja-prototype/shared';

function SelectionBox({ checked, mixed = false, disabled, label, onChange }: {
  checked: boolean; mixed?: boolean; disabled: boolean; label: string; onChange: () => void;
}) {
  return <input type="checkbox" className="daisy-checkbox daisy-checkbox-sm rounded border border-muted-foreground bg-background text-primary shadow-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    aria-label={label} checked={checked} disabled={disabled}
    ref={(node) => { if (node) node.indeterminate = mixed; }} onChange={onChange} />;
}

export function BandejaOperativa({ view, offset, pageSize, onPage, error, busy, layout = '1' }: {
  view: BandejaView; offset: number; pageSize: number; onPage: (offset: number) => void; error: boolean; busy: boolean; layout?: '1' | '2' | '3' | '4' | '5';
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const isPending = view.stage === 'pending';
  const isReady = view.stage === 'ready';
  const locked = busy || error || view.fetching || view.printing || view.busyOrderId !== null;
  const eligible = view.orders.filter(isPending ? canMarkFalabellaReady : canPrintLogisticsLabel);
  const selectedOrders = eligible.filter((order) => selected.has(order.id));
  const allSelected = eligible.length > 0 && selectedOrders.length === eligible.length;
  const unprinted = eligible.filter((order) => !labelWasPrinted(order));
  const targets = selectedOrders.length ? selectedOrders : isPending ? eligible : unprinted;
  const groups = groupLogisticsByUrgency(view.orders, view.now);
  const focused = view.orders.find((order) => order.id === focusedId) || groups[0]?.orders[0];
  const stores = new Map<string, LogisticsOrder[]>();
  for (const group of groups) for (const order of group.orders) {
    const key = `${order.companyId ?? 'none'}|${order.companyName}`;
    stores.set(key, [...(stores.get(key) || []), order]);
  }
  const displayGroups = view.stage === 'shipped'
    ? [{ key: 'shipped', label: 'Enviados', urgency: 'later', orders: view.orders }]
    : layout === '3'
      ? [...stores].map(([key, orders]) => ({ key, label: sellerShortName(orders[0].companyName), urgency: orders[0].urgency, orders }))
      : groups.map((group) => ({ ...group, key: group.urgency, label: LOGISTICS_URGENCIES.find((entry) => entry.value === group.urgency)?.label }));
  const action = () => {
    if (locked || !targets.length) return;
    if (isPending) view.requestBulkReady(targets);
    else { view.printOrders(targets); setSelected(new Set()); }
  };
  const toggle = (order: LogisticsOrder) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(order.id)) next.delete(order.id);
    else next.add(order.id);
    return next;
  });

  const renderOrder = (order: LogisticsOrder, tone?: string) => {
                      const selectable = isPending ? canMarkFalabellaReady(order) : canPrintLogisticsLabel(order);
                      const printed = labelWasPrinted(order);
                      return <li key={order.id} className={cn('grid grid-cols-[20px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3 hover:bg-muted/30', layout === '2' ? 'rounded-xl border p-4' : layout === '5' ? 'lg:grid-cols-[20px_140px_minmax(0,1fr)]' : 'md:grid-cols-[20px_160px_minmax(0,1fr)_155px]', selected.has(order.id) && 'bg-primary/5')}>
                        <div>{view.stage !== 'shipped' && <SelectionBox checked={selectable && selected.has(order.id)} disabled={locked || !selectable || (isPending && !view.canDispatch)} label={`Seleccionar pedido ${order.externalOrderNumber}`} onChange={() => toggle(order)} />}</div>
                        <div className="min-w-0 self-start pt-1">
                          <CopyableOrderNumber value={order.externalOrderNumber} />
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><ChannelMark code={order.channelCode} className="size-4" /><span className="line-clamp-2">{sellerShortName(order.companyName)}</span></div>
                        </div>
                        <div className={cn("col-start-2 min-w-0 space-y-2", layout !== '2' && "md:col-start-auto")}>
                          {order.items.length ? order.items.map((item) => <div key={item.id} className="flex items-center gap-3">
                            <ProductThumb item={item} className={cn("rounded-md bg-white", layout === '2' ? "size-24" : "size-12")} onOpen={setPreview} />
                            <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm leading-5">{item.description}</p>{(item.sku || item.shopSku) && <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{item.sku || item.shopSku}</p>}</div>
                            <QuantityTag item={item} />
                          </div>) : <span className="text-sm text-muted-foreground">Sin detalle de productos</span>}
                        </div>
                        <div className={cn("col-start-2 flex items-center justify-between gap-2", layout === '2' ? "mt-2 border-t pt-3" : layout === '5' ? "lg:col-start-3" : "md:col-start-auto md:flex-col md:items-end")}>
                          <span className={cn('text-xs font-medium', tone)}>{view.stage === 'shipped' ? 'Enviado' : logisticsDeadlineLabel(order, view.now)}</span>
                          {canMarkFalabellaReady(order) ? <Button size="sm" variant="outline" disabled={locked || !view.canDispatch} onClick={() => view.requestReady(order)}><PackageCheck />Marcar listo</Button>
                            : canPrintLogisticsLabel(order) ? <Button size="sm" variant="outline" disabled={locked} onClick={() => view.printOrders([order])}>{printed ? <Check /> : <Printer />}{printed ? 'Reimprimir' : 'Imprimir'}</Button>
                              : view.stage !== 'shipped' && <span className="text-xs text-muted-foreground">{order.channelCode === 'ripley' ? 'Etiqueta no disponible' : 'Sin acción disponible'}</span>}
                        </div>
                      </li>;
  };

  return (
    <div className="min-w-0 space-y-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input aria-label="Buscar pedido o producto" placeholder="Buscar pedido o producto" className="pl-9" value={view.searchInput} onChange={(event) => view.setSearchInput(event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Filtrar por canal">
          {LOGISTICS_CHANNELS.map((channel) => <Button key={channel.value} size="sm" variant={view.channelCode === channel.value ? 'secondary' : 'ghost'} aria-pressed={view.channelCode === channel.value} onClick={() => view.setChannelCode(channel.value)}>{channel.label}</Button>)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground xl:inline">{view.updatedAt ? `Actualizado ${logisticsUpdatedClock(view.updatedAt)}` : ''}</span>
          <Button size="sm" variant="outline" disabled={view.refreshing} onClick={view.refresh}>
            <RefreshCw className={cn('size-4', view.refreshing && 'animate-spin')} />{view.canSync ? 'Sincronizar' : 'Actualizar'}
          </Button>
        </div>
      </div>

      <div className="flex items-stretch gap-1 border-b" aria-label="Etapa del pedido">
        {([
          { stage: 'pending', label: 'Por preparar', icon: PackageCheck, number: '1' },
          { stage: 'ready', label: 'Listos para imprimir', icon: Printer, number: '2' },
        ] as const).map(({ stage, label, icon: Icon, number }) => <button key={stage} type="button" aria-pressed={view.stage === stage} onClick={() => view.setStage(stage)}
          className={cn('flex min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-2 py-4 text-sm font-semibold outline-offset-4 sm:flex-none sm:justify-start sm:px-5', view.stage === stage ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:bg-muted/50')}>
          <span className={cn('hidden size-6 items-center justify-center rounded-full text-xs sm:flex', view.stage === stage ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{number}</span>
          <Icon className="hidden size-4 lg:block" />{label}<span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-foreground">{view.counts[stage]}</span>
        </button>)}
        <button type="button" aria-pressed={view.stage === 'shipped'} onClick={() => view.setStage('shipped')} className={cn('ml-auto border-b-2 px-2 text-xs sm:px-4 sm:text-sm', view.stage === 'shipped' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')}>Enviados <span className="hidden tabular-nums sm:inline">{view.counts.shipped}</span></button>
      </div>

      {view.stage !== 'shipped' && <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtrar por entrega">
        <Button size="sm" variant={view.urgency === null ? 'secondary' : 'ghost'} aria-pressed={view.urgency === null} onClick={() => view.setUrgency(null)}>Todos los plazos</Button>
        {LOGISTICS_URGENCIES.map((urgency) => <Button key={urgency.value} size="sm" variant={view.urgency === urgency.value ? 'secondary' : 'ghost'} aria-pressed={view.urgency === urgency.value} onClick={() => view.setUrgency(urgency.value)}>
          <span className={cn('size-1.5 rounded-full', urgency.dotClass)} />{urgency.label}
        </Button>)}
      </div>}

      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-y bg-background px-2 py-3 sm:px-3">
        <div className="flex min-h-9 items-center gap-3">
          {view.stage !== 'shipped' && layout !== '4' && <SelectionBox checked={allSelected} mixed={selectedOrders.length > 0 && !allSelected} disabled={locked || !eligible.length || (isPending && !view.canDispatch)} label="Seleccionar pedidos disponibles de esta página" onChange={() => setSelected(allSelected ? new Set() : new Set(eligible.map((order) => order.id)))} />}
          <div>
            <p className="text-sm font-semibold">{selectedOrders.length ? `${selectedOrders.length} seleccionados` : `${view.totalCount} pedidos`}</p>
            <p className="text-xs text-muted-foreground">{isPending ? layout === '4' ? 'Revisa, empaca y marca listo.' : 'Prepara, selecciona y marca listo.' : isReady ? 'Etiquetas y detalle de productos en un PDF.' : 'Pedidos enviados.'}</p>
          </div>
          {selectedOrders.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Quitar selección</Button>}
        </div>
        {view.stage !== 'shipped' && layout !== '5' && layout !== '4' && <Button onClick={action} disabled={locked || !targets.length || (isPending && !view.canDispatch)}>
          {view.printing ? <Loader2 className="animate-spin" /> : isPending ? <PackageCheck /> : <Printer />}
          {view.printing ? 'Generando PDF…' : isPending ? `Marcar ${targets.length} listos` : selectedOrders.length ? `Imprimir ${targets.length} seleccionados` : `Imprimir ${targets.length} sin imprimir`}
        </Button>}
      </div>
      {view.stage !== 'shipped' && <p className="-mt-2 px-3 text-xs text-muted-foreground">
        {layout === '4' ? 'Elige un pedido de la cola para revisar sus productos.' : isPending ? 'La acción en lote incluye solo Falabella. Manuales y Ripley se gestionan en su fila.' : 'Las etiquetas ya generadas solo se incluyen si las seleccionas.'}
        {view.totalCount > pageSize && ' Las acciones incluyen solo esta página.'}
      </p>}

      <div className={cn((layout === '4' || layout === '5') && 'grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]')}>
      {layout === '4' && focused && !error && !view.loading ? <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)] xl:col-span-2">
        <div className="flex gap-2 overflow-x-auto border-b pb-3 lg:block lg:max-h-[65vh] lg:overflow-y-auto lg:border-r lg:border-b-0 lg:pr-3">
          <p className="mb-3 hidden text-xs font-semibold text-muted-foreground lg:block">{isPending ? 'COLA DE PREPARACIÓN' : 'PEDIDOS'} · {view.orders.length}</p>
          {groups.flatMap((group) => group.orders).map((order) => <button type="button" key={order.id} onClick={() => setFocusedId(order.id)} aria-pressed={focused.id === order.id} className={cn('mb-1 flex w-48 shrink-0 items-center gap-3 rounded-md p-3 text-left lg:w-full', focused.id === order.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted')}>
            {order.items[0] && <ProductThumb item={order.items[0]} className="size-10 rounded bg-white" />}
            <span className="min-w-0"><span className="block truncate font-mono text-xs font-semibold">{order.externalOrderNumber}</span><span className="block truncate text-xs text-muted-foreground">{sellerShortName(order.companyName)}</span></span>
          </button>)}
        </div>
        <section className="min-w-0">
          <div className="mb-5 flex flex-wrap justify-between gap-3 border-b pb-4"><div><p className="mb-1 text-xs text-muted-foreground">{isPending ? 'PEDIDO EN PREPARACIÓN' : isReady ? 'PEDIDO PARA IMPRIMIR' : 'PEDIDO ENVIADO'}</p><CopyableOrderNumber value={focused.externalOrderNumber} /><p className="mt-1 text-sm text-muted-foreground">{sellerShortName(focused.companyName)}</p></div><p className="text-sm font-medium">{logisticsDeadlineLabel(focused, view.now)}</p></div>
          <div className="space-y-5">{focused.items.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-5 border-b pb-5"><ProductThumb item={item} className="size-36 rounded-lg bg-white sm:size-44" onOpen={setPreview} /><div className="min-w-0 flex-1"><p className="text-lg font-semibold">{item.description}</p><p className="my-2 font-mono text-sm text-muted-foreground">{item.sku || item.shopSku}</p><QuantityTag item={item} /></div></div>)}</div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Revisa los productos antes de continuar.</span>{canMarkFalabellaReady(focused) ? <Button size="lg" disabled={locked || !view.canDispatch} onClick={() => view.requestReady(focused)}><PackageCheck />Marcar pedido listo</Button> : canPrintLogisticsLabel(focused) ? <Button size="lg" disabled={locked} onClick={() => view.printOrders([focused])}><Printer />{labelWasPrinted(focused) ? 'Reimprimir etiqueta' : 'Imprimir etiqueta'}</Button> : <span className="text-sm text-muted-foreground">Etiqueta no disponible</span>}</div>
        </section>
      </div> : error ? <div role="alert" className="py-12 text-center"><p>No se pudieron cargar los pedidos. Vuelve a actualizar.</p></div>
        : view.loading ? <div role="status" className="flex justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Cargando pedidos…</div>
          : !view.orders.length ? <div className="py-16 text-center"><PackageCheck className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="text-sm">{view.searchInput || view.urgency || view.channelCode !== 'all' ? 'No hay pedidos con estos filtros.' : view.emptyCopy}</p>{isPending && view.counts.ready > 0 && <Button className="mt-4" onClick={() => view.setStage('ready')}><Printer />Ir a imprimir {view.counts.ready}</Button>}</div>
            : <div aria-busy={view.fetching} className={cn(view.fetching && 'opacity-60')}>
              {displayGroups.map((group) => {
                const meta = LOGISTICS_URGENCIES.find((entry) => entry.value === group.urgency);
                return <section key={group.key} aria-label={group.label} className="mb-4">
                  {view.stage !== 'shipped' && <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 text-xs font-semibold"><span className={cn('size-2 rounded-full', meta?.dotClass)} />{group.label}<span className="font-normal text-muted-foreground">{group.orders.length}</span></div>}
                  <ul className={layout === '2' ? "grid gap-3 pt-3 sm:grid-cols-2 xl:grid-cols-3" : "divide-y"}>
{group.orders.map((order) => renderOrder(order, meta?.textClass))}
                  </ul>
                </section>;
              })}
            </div>}
      {layout === '5' && view.stage !== 'shipped' && <aside className="order-first border-b pb-4 xl:order-last xl:sticky xl:top-0 xl:border-b-0 xl:border-l xl:pb-0 xl:pl-5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">LOTE DE {isPending ? 'PREPARACIÓN' : 'IMPRESIÓN'}</p>
        <p className="mt-3 text-3xl font-semibold tabular-nums">{selectedOrders.length} <span className="text-sm font-normal text-muted-foreground">seleccionados</span></p>
        <p className="mt-1 text-sm text-muted-foreground">{selectedOrders.reduce((sum, order) => sum + order.items.reduce((units, item) => units + item.quantity, 0), 0)} unidades · {new Set(selectedOrders.map((order) => order.companyId)).size} tiendas</p>
        <div className="my-5 max-h-72 space-y-3 overflow-y-auto border-y py-4">{selectedOrders.length ? selectedOrders.map((order) => <div key={order.id} className="flex justify-between gap-2 text-xs"><span className="min-w-0"><span className="block font-mono font-semibold">{order.externalOrderNumber}</span><span className="text-muted-foreground">{sellerShortName(order.companyName)}</span></span><button type="button" onClick={() => toggle(order)} className="text-muted-foreground underline" aria-label={`Quitar pedido ${order.externalOrderNumber}`}>Quitar</button></div>) : <p className="text-sm text-muted-foreground">Selecciona pedidos de la lista para formar el lote.</p>}</div>
        <Button className="w-full" disabled={locked || !selectedOrders.length || (isPending && !view.canDispatch)} onClick={action}>{isPending ? <PackageCheck /> : <Printer />}{isPending ? `Marcar ${selectedOrders.length} listos` : `Imprimir ${selectedOrders.length} pedidos`}</Button>
        <p className="mt-3 text-xs text-muted-foreground">{isPending ? 'Confirma que el lote está empacado.' : 'Un PDF con etiquetas y productos.'}</p>
        {isPending && <Button className="mt-6 w-full justify-between" variant="ghost" onClick={() => view.setStage('ready')}>Ir a imprimir <span>{view.counts.ready}</span></Button>}
      </aside>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>{view.totalCount ? `${offset + 1}–${Math.min(offset + view.orders.length, view.totalCount)} de ${view.totalCount}` : '0 pedidos'}</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={locked || offset === 0} onClick={() => onPage(Math.max(0, offset - pageSize))}><ChevronLeft />Anterior</Button><Button size="sm" variant="outline" disabled={locked || offset + pageSize >= view.totalCount} onClick={() => onPage(offset + pageSize)}>Siguiente<ChevronRight /></Button></div>
      </div>
      <ProductImageLightbox preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
