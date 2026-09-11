import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { operationalGroups, orderUnits, type OperationalLayout } from './bandeja-variants';
import { BandejaPackingChecklist } from './BandejaPackingChecklist';
import { BandejaDeadlineSummary } from './BandejaDeadlineSummary';
import { Check, ChevronLeft, ChevronRight, Layers3, Loader2, PackageCheck, Printer, RefreshCw, Search, Truck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/cn';
import { sellerShortName } from '../lib/seller-name';
import {
  BANDEJA_DEADLINE_FILTERS, bandejaDeadlineDateCount, canMarkLogisticsDelivered, canMarkLogisticsReady, canPrintLogisticsLabel,
  formatBandejaDeadlineDate, groupLogisticsByUrgency, labelWasPrinted, laterBandejaDeadlineDates,
  limaDeadlineKey, logisticsDeadlineLabel, logisticsItemSku, logisticsUpdatedClock,
  LOGISTICS_URGENCIES, visibleLogisticsChannels, type LogisticsStage,
} from '../lib/logistics-inbox';
import {
  ChannelMark, CopyableOrderNumber, ProductThumb, ProductImageLightbox, QuantityTag,
  type BandejaView, type LogisticsOrder,
} from './bandeja-prototype/shared';

const STAGE_TABS = [
  { stage: 'pending', label: 'Por preparar', mobileLabel: 'Preparar', icon: PackageCheck },
  { stage: 'ready', label: 'Listos para imprimir', mobileLabel: 'Imprimir', icon: Printer },
] as const;

function SelectionBox({ checked, mixed = false, disabled, label, onChange }: {
  checked: boolean; mixed?: boolean; disabled: boolean; label: string; onChange: () => void;
}) {
  return <input type="checkbox" className="daisy-checkbox daisy-checkbox-sm rounded border border-muted-foreground bg-background text-primary shadow-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    aria-label={label} checked={checked} disabled={disabled}
    ref={(node) => { if (node) node.indeterminate = mixed; }} onChange={onChange} />;
}

function StageTabBar({ view }: { view: BandejaView }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ x: 0, width: 0 });
  const [move, setMove] = useState(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!active) return;
      setIndicator({ x: active.offsetLeft, width: active.offsetWidth });
    };

    measure();
    const frame = requestAnimationFrame(() => setMove(true));
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const child of list.querySelectorAll('[aria-pressed]')) observer.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [view.stage]);

  return (
    <div className="relative border-b">
      <div
        ref={listRef}
        className="grid grid-cols-2 items-stretch gap-1 sm:flex"
        aria-label="Etapa del pedido"
      >
        {STAGE_TABS.map(({ stage, label, mobileLabel, icon: Icon }) => (
          <button
            key={stage}
            type="button"
            aria-label={label}
            aria-pressed={view.stage === stage}
            onClick={() => view.setStage(stage)}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-2 px-2 py-3 text-sm font-semibold outline-offset-4 transition-colors duration-200 sm:flex-none sm:justify-start sm:px-5 sm:py-4',
              view.stage === stage ? 'text-primary' : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            <Icon className="hidden size-4 lg:block" />
            <span className="sm:hidden">{mobileLabel}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute bottom-0 left-0 h-0.5 origin-left bg-primary',
          move && 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.77,0,0.175,1)]',
        )}
        style={{
          width: 1,
          opacity: indicator.width ? 1 : 0,
          transform: `translateX(${indicator.x}px) scaleX(${indicator.width})`,
        }}
      />
    </div>
  );
}

function stagePanelKey(stage: LogisticsStage, fetching: boolean, orders: LogisticsOrder[]) {
  const current = orders[0];
  if (fetching && current != null && current.stage !== stage) return current.stage;
  return stage;
}

export function BandejaOperativa({ view, offset, pageSize, onPage, error, busy, layout = '1', resetKey }: {
  view: BandejaView; offset: number; pageSize: number; onPage: (offset: number) => void; error: boolean; busy: boolean; layout?: OperationalLayout; resetKey?: string;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [appliedResetKey, setAppliedResetKey] = useState(resetKey);
  if (resetKey !== undefined && resetKey !== appliedResetKey) {
    setAppliedResetKey(resetKey);
    setSelected(new Set());
    setFocusedId(null);
    setPreview(null);
  }
  const panelStage = stagePanelKey(view.stage, view.fetching, view.orders);
  const skipEnter = useRef(true);
  const animatePanel = !skipEnter.current;
  useEffect(() => {
    skipEnter.current = false;
  }, []);
  const isPending = view.stage === 'pending';
  const isReady = view.stage === 'ready';
  const locked = busy || error || view.fetching || view.printing || view.busyOrderId !== null;
  const eligible = view.orders.filter((order) => (
    canMarkLogisticsReady(order) || canMarkLogisticsDelivered(order) || (isReady && canPrintLogisticsLabel(order))
  ));
  const selectedOrders = eligible.filter((order) => selected.has(order.id));
  const allSelected = eligible.length > 0 && selectedOrders.length === eligible.length;
  const selectedReady = selectedOrders.filter(canMarkLogisticsReady);
  const selectedDeliver = selectedOrders.filter(canMarkLogisticsDelivered);
  const selectedPrint = selectedOrders.filter(canPrintLogisticsLabel);
  const defaultReady = view.orders.filter(canMarkLogisticsReady);
  const defaultDeliver = view.orders.filter(canMarkLogisticsDelivered);
  const unprinted = view.orders.filter((order) => canPrintLogisticsLabel(order) && !labelWasPrinted(order));
  const readyTargets = selectedOrders.length ? selectedReady : defaultReady;
  const deliverTargets = selectedOrders.length ? selectedDeliver : defaultDeliver;
  const printTargets = selectedOrders.length ? selectedPrint : unprinted;
  const groups = groupLogisticsByUrgency(view.orders, view.now);
  const focused = view.orders.find((order) => order.id === focusedId) || groups[0]?.orders[0];
  const laterDates = laterBandejaDeadlineDates(view.counts.dates || [], view.now);
  const todayKey = limaDeadlineKey(view.now);
  const tomorrowKey = limaDeadlineKey(new Date(view.now.getTime() + 24 * 60 * 60 * 1000));
  const selectedDeadline = !view.urgency && !view.deadlineDate;
  const displayGroups = view.stage === 'shipped'
    ? [{ key: 'shipped', label: 'Enviados', urgency: 'later' as const, orders: view.orders }]
    : view.deadlineDate
      ? [{ key: view.deadlineDate, label: formatBandejaDeadlineDate(view.deadlineDate, view.now), urgency: 'later' as const, orders: view.orders }]
      : operationalGroups(view.orders, view.now, layout);
  const isCard = ['2', '9', '10', '13', '16'].includes(layout);
  const isChecklist = layout === '13' && isPending;
  const isColumns = ['9', '10', '16'].includes(layout);
  const showPlazoHeading = view.stage !== 'shipped' && !((view.urgency || view.deadlineDate) && !['3', '8', '10', '11', '12', '16'].includes(layout));
  const printAction = () => {
    if (locked || !printTargets.length) return;
    view.printOrders(printTargets);
    setSelected(new Set());
  };
  const toggle = (order: LogisticsOrder) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(order.id)) next.delete(order.id);
    else next.add(order.id);
    return next;
  });

  const renderOrder = (order: LogisticsOrder, tone?: string) => {
                      const selectable = canMarkLogisticsReady(order) || canMarkLogisticsDelivered(order) || (isReady && canPrintLogisticsLabel(order));
                      const printed = labelWasPrinted(order);
                      const rowClass = cn('grid grid-cols-1 items-center gap-x-3 gap-y-2 py-3 hover:bg-muted/30 sm:grid-cols-[20px_minmax(0,1fr)] sm:px-3', isCard ? 'rounded-xl border p-4' : layout === '5' ? 'lg:grid-cols-[20px_140px_minmax(0,1fr)]' : 'md:grid-cols-[20px_160px_minmax(0,1fr)_155px]', selected.has(order.id) && 'bg-primary/5', layout === '7' && 'py-1.5 text-xs', layout === '12' && 'border-l-4 border-l-primary/30');
                      const content = <>
                        <div className="hidden sm:block">{view.stage !== 'shipped' && !isChecklist && <SelectionBox checked={selectable && selected.has(order.id)} disabled={locked || !selectable || (isPending && !view.canDispatch)} label={`Seleccionar pedido ${order.externalOrderNumber}`} onChange={() => toggle(order)} />}</div>
                        <div className="min-w-0 self-start pt-1">
                          <CopyableOrderNumber value={order.externalOrderNumber} />
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><ChannelMark code={order.channelCode} className="size-4" /><span className="line-clamp-2">{sellerShortName(order.companyName)}</span></div>
                        </div>
                        <div className={cn(isChecklist && canMarkLogisticsReady(order) && 'hidden', "min-w-0 space-y-2 sm:col-start-2", !isCard && "md:col-start-auto")}>
                          {order.items.length ? order.items.map((item) => <div key={item.id} className="flex items-center gap-3">
                            <ProductThumb item={item} className={cn("rounded-md bg-white", layout === '2' ? 'size-24' : isCard ? 'size-20' : layout === '7' ? 'size-8' : 'size-12')} onOpen={setPreview} />
                            <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm leading-5">{item.description}</p>{logisticsItemSku(item) && <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{logisticsItemSku(item)}</p>}</div>
                            <QuantityTag item={item} />
                          </div>) : <span className="text-sm text-muted-foreground">Sin detalle de productos</span>}
                        </div>
                        <div className={cn("col-start-2 hidden items-center justify-between gap-2 sm:flex", isCard ? 'mt-2 flex-wrap border-t pt-3' : layout === '5' ? "lg:col-start-3" : "md:col-start-auto md:flex-col md:items-end")}>
                          <span className={cn('text-xs font-medium', tone)}>{view.stage === 'shipped' ? 'Enviado' : logisticsDeadlineLabel(order, view.now)}</span>
                          {canMarkLogisticsReady(order) && isChecklist ? <span className="text-xs text-muted-foreground">Por comprobar</span>
                            : <span className="flex flex-wrap items-center justify-end gap-2">
                              {canMarkLogisticsDelivered(order) && <Button size="sm" disabled={locked || !view.canDispatch} onClick={() => view.requestDeliver(order)}><Truck />Marcar entregado</Button>}
                              {canMarkLogisticsReady(order) && <Button size="sm" variant="outline" disabled={locked || !view.canDispatch} onClick={() => view.requestReady(order)}><PackageCheck />Marcar listo</Button>}
                              {canPrintLogisticsLabel(order) && <Button size="sm" variant={canMarkLogisticsDelivered(order) ? 'ghost' : 'outline'} disabled={locked} onClick={() => view.printOrders([order])}>{printed ? <Check /> : <Printer />}{printed ? 'Reimprimir' : 'Imprimir'}</Button>}
                              {!canMarkLogisticsDelivered(order) && !canMarkLogisticsReady(order) && !canPrintLogisticsLabel(order) && view.stage !== 'shipped' && <span className="text-xs text-muted-foreground">{order.channelCode === 'ripley' ? 'Etiqueta no disponible' : 'Sin acción disponible'}</span>}
                            </span>}
                        </div>
                        {layout === '12' && <p className="col-start-2 text-sm font-semibold tabular-nums md:col-start-3">{orderUnits(order)} {orderUnits(order) === 1 ? 'unidad para empacar' : 'unidades para empacar'}</p>}
                        {isChecklist && canMarkLogisticsReady(order) && <BandejaPackingChecklist key={order.items.map((item) => `${item.id}:${item.quantity}`).join('|')} order={order} disabled={locked || !view.canDispatch} onReady={() => view.requestReady(order)} />}
                      </>;
                      return <li key={order.id} className={layout === '15' ? 'border-b' : rowClass}>
                        {layout === '15' ? <details className="group"><summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-3 py-4 hover:bg-muted"><ChevronRight className="size-4 transition-transform group-open:rotate-90" />{order.items[0] && <ProductThumb item={order.items[0]} className="size-10 rounded bg-white" />}<span className="font-mono text-sm font-semibold">{order.externalOrderNumber}</span><span className="text-xs text-muted-foreground">{sellerShortName(order.companyName)}</span><span className="ml-auto text-xs">{orderUnits(order)} unidades · {logisticsDeadlineLabel(order, view.now)}</span></summary><div className={rowClass}>{content}</div></details> : content}
                      </li>;
  };

  return (
    <div className="min-w-0 pb-24">
      <div className="space-y-2 sm:space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Buscar pedido o producto" placeholder="Pedido o producto" className="h-11 pl-9 sm:h-9" value={view.searchInput} onChange={(event) => view.setSearchInput(event.target.value)} />
        </div>
        <div className={cn('order-last grid w-full gap-1 sm:order-none sm:flex sm:w-auto sm:flex-wrap', visibleLogisticsChannels(view.channels).length === 4 ? 'grid-cols-4' : 'grid-cols-3')} aria-label="Filtrar por canal">
          {visibleLogisticsChannels(view.channels).map((channel) => <Button key={channel.value} size="sm" className={cn('h-11 min-w-0 flex-row gap-1.5 rounded-lg px-1 text-xs sm:h-8 sm:flex-row sm:gap-1 sm:rounded-md sm:px-3 sm:text-sm', view.channelCode === channel.value && 'bg-primary/8 text-primary sm:bg-secondary sm:text-secondary-foreground')} variant={view.channelCode === channel.value ? 'secondary' : 'ghost'} aria-pressed={view.channelCode === channel.value} onClick={() => view.setChannelCode(channel.value)}>
            {channel.value === 'all' ? <Layers3 aria-hidden="true" className="size-4 sm:hidden" /> : <ChannelMark code={channel.value} className="size-4" />}
            {channel.label}
          </Button>)}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="hidden text-xs text-muted-foreground xl:inline">{view.updatedAt ? `Actualizado ${logisticsUpdatedClock(view.updatedAt)}` : ''}</span>
          <Button size="sm" variant="outline" className="size-11 p-0 sm:h-8 sm:w-auto sm:px-3" aria-label={view.canSync ? 'Sincronizar' : 'Actualizar'} disabled={view.refreshing} onClick={view.refresh}>
            <RefreshCw className={cn('size-4', view.refreshing && 'animate-spin')} /><span className="hidden sm:inline">{view.canSync ? 'Sincronizar' : 'Actualizar'}</span>
          </Button>
        </div>
      </div>

      <BandejaDeadlineSummary view={view} error={error} />

      <StageTabBar view={view} />

      {view.stage !== 'shipped' && <div className="flex items-center gap-1 overflow-x-auto sm:flex-wrap sm:gap-1.5 sm:overflow-visible" aria-label="Filtrar por entrega">
        <Button size="sm" className="h-11 shrink-0 px-3 text-xs sm:h-8 sm:text-sm" variant={selectedDeadline ? 'secondary' : 'ghost'} aria-pressed={selectedDeadline} onClick={() => { view.setUrgency(null); view.setDeadlineDate(null); }}><span className="sm:hidden">Todos</span><span className="hidden sm:inline">Todos los plazos</span></Button>
        {BANDEJA_DEADLINE_FILTERS.map((urgency) => {
          const dateKey = urgency.value === 'today' ? todayKey : tomorrowKey;
          const count = urgency.value === 'overdue'
            ? view.counts.urgency.overdue
            : bandejaDeadlineDateCount(view.counts.dates || [], dateKey);
          return <Button key={urgency.value} size="sm" className="h-11 shrink-0 gap-1.5 px-3 text-xs sm:h-8 sm:text-sm" variant={view.urgency === urgency.value ? 'secondary' : 'ghost'} aria-pressed={view.urgency === urgency.value} onClick={() => view.setUrgency(urgency.value)}>
            <span className={cn('hidden size-1.5 rounded-full sm:block', urgency.dotClass)} /><span className="sm:hidden">{urgency.value === 'today' ? 'Hoy' : 'Mañana'}</span><span className="hidden sm:inline">{urgency.label}</span>
            <span className="text-center tabular-nums text-muted-foreground">{count}</span>
          </Button>;
        })}
        {laterDates.map((item) => <Button key={item.date} size="sm" className="h-11 shrink-0 gap-1.5 px-3 text-xs sm:h-8 sm:text-sm" variant={view.deadlineDate === item.date ? 'secondary' : 'ghost'} aria-pressed={view.deadlineDate === item.date} onClick={() => view.setDeadlineDate(item.date)}>
          <span className="size-1.5 rounded-full bg-slate-300" />{formatBandejaDeadlineDate(item.date, view.now)}
          <span className="tabular-nums text-muted-foreground">{item.count}</span>
        </Button>)}
      </div>}
      </div>

      {/*
        Se pega bajo el header y tapa el padding de main (`p-4 md:p-6 lg:p-8`)
        para que los pedidos no se vean detrás al hacer scroll.
      */}
      <div
        data-bandeja-action-bar
        className={cn(!view.orders.length && 'hidden sm:block', "relative isolate sticky top-[-1rem] z-30 -mx-4 mt-4 bg-background px-4 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-background md:top-[-1.5rem] md:-mx-6 md:px-6 lg:top-[-2rem] lg:-mx-8 lg:px-8")}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 py-1 sm:border-y sm:px-3 sm:py-3">
        <div className="flex min-h-9 items-center gap-3">
          {view.stage !== 'shipped' && layout !== '4' && !isChecklist && <span className="hidden sm:inline-flex"><SelectionBox checked={allSelected} mixed={selectedOrders.length > 0 && !allSelected} disabled={locked || !eligible.length || (isPending && !view.canDispatch)} label="Seleccionar pedidos disponibles de esta página" onChange={() => setSelected(allSelected ? new Set() : new Set(eligible.map((order) => order.id)))} /></span>}
          <div>
            <p className="text-sm font-semibold">{selectedOrders.length ? `${selectedOrders.length} seleccionados` : `${view.totalCount} ${view.totalCount === 1 ? 'pedido' : 'pedidos'}`}</p>
            <p className="hidden text-xs text-muted-foreground sm:block">{isPending ? layout === '4' ? 'Revisa, empaca y marca listo o entregado.' : 'Prepara y marca listo o entregado.' : isReady ? 'Imprime marketplaces o marca entregados los propios.' : 'Pedidos enviados.'}</p>
          </div>
          {selectedOrders.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Quitar selección</Button>}
        </div>
        {view.stage !== 'shipped' && layout !== '5' && layout !== '4' && layout !== '14' && !isChecklist && <div className="flex flex-wrap gap-2">
          {readyTargets.length > 0 && <Button onClick={() => view.requestBulkReady(readyTargets)} disabled={locked || !view.canDispatch}>
            <PackageCheck />{`Marcar ${readyTargets.length} ${readyTargets.length === 1 ? 'listo' : 'listos'}`}
          </Button>}
          {deliverTargets.length > 0 && <Button variant={readyTargets.length ? 'outline' : 'default'} onClick={() => view.requestBulkDeliver(deliverTargets)} disabled={locked || !view.canDispatch}>
            <Truck />{`Marcar ${deliverTargets.length} ${deliverTargets.length === 1 ? 'entregado' : 'entregados'}`}
          </Button>}
          {isReady && printTargets.length > 0 && <Button variant={deliverTargets.length ? 'outline' : 'default'} onClick={printAction} disabled={locked}>
            {view.printing ? <Loader2 className="animate-spin" /> : <Printer />}
            {view.printing ? 'Generando PDF…' : selectedOrders.length ? `Imprimir ${printTargets.length} seleccionados` : `Imprimir ${printTargets.length} sin imprimir`}
          </Button>}
        </div>}
        </div>
      </div>

      <div className={cn('mt-0 sm:mt-4', (layout === '4' || layout === '5') && 'grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]')}>
      <div
        key={panelStage}
        className={cn(
          'min-w-0',
          layout === '4' && 'xl:col-span-2',
          animatePanel && 'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)]',
          animatePanel && (panelStage === 'ready' ? 'motion-safe:slide-in-from-right-2' : 'motion-safe:slide-in-from-left-2'),
        )}
      >
      {layout === '4' && focused && !error && !view.loading ? <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex gap-2 overflow-x-auto border-b pb-3 lg:block lg:max-h-[65vh] lg:overflow-y-auto lg:border-r lg:border-b-0 lg:pr-3">
          <p className="mb-3 hidden text-xs font-semibold text-muted-foreground lg:block">{isPending ? 'COLA DE PREPARACIÓN' : 'PEDIDOS'} · {view.orders.length}</p>
          {groups.flatMap((group) => group.orders).map((order) => <button type="button" key={order.id} onClick={() => setFocusedId(order.id)} aria-pressed={focused.id === order.id} className={cn('mb-1 flex w-48 shrink-0 items-center gap-3 rounded-md p-3 text-left lg:w-full', focused.id === order.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted')}>
            {order.items[0] && <ProductThumb item={order.items[0]} className="size-10 rounded bg-white" />}
            <span className="min-w-0"><span className="block truncate font-mono text-xs font-semibold">{order.externalOrderNumber}</span><span className="block truncate text-xs text-muted-foreground">{sellerShortName(order.companyName)}</span></span>
          </button>)}
        </div>
        <section className="min-w-0">
          <div className="mb-5 flex flex-wrap justify-between gap-3 border-b pb-4"><div><p className="mb-1 text-xs text-muted-foreground">{isPending ? 'PEDIDO EN PREPARACIÓN' : isReady ? 'PEDIDO PARA IMPRIMIR' : 'PEDIDO ENVIADO'}</p><CopyableOrderNumber value={focused.externalOrderNumber} /><p className="mt-1 text-sm text-muted-foreground">{sellerShortName(focused.companyName)}</p></div><p className="text-sm font-medium">{logisticsDeadlineLabel(focused, view.now)}</p></div>
          <div className="space-y-5">{focused.items.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-5 border-b pb-5"><ProductThumb item={item} className="size-36 rounded-lg bg-white sm:size-44" onOpen={setPreview} /><div className="min-w-0 flex-1"><p className="text-lg font-semibold">{item.description}</p>{logisticsItemSku(item) && <p className="my-2 font-mono text-sm text-muted-foreground">{logisticsItemSku(item)}</p>}<QuantityTag item={item} /></div></div>)}</div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Revisa los productos antes de continuar.</span>{canMarkLogisticsDelivered(focused) ? <Button size="lg" disabled={locked || !view.canDispatch} onClick={() => view.requestDeliver(focused)}><Truck />Marcar pedido entregado</Button> : canMarkLogisticsReady(focused) ? <Button size="lg" disabled={locked || !view.canDispatch} onClick={() => view.requestReady(focused)}><PackageCheck />Marcar pedido listo</Button> : canPrintLogisticsLabel(focused) ? <Button size="lg" disabled={locked} onClick={() => view.printOrders([focused])}><Printer />{labelWasPrinted(focused) ? 'Reimprimir etiqueta' : 'Imprimir etiqueta'}</Button> : <span className="text-sm text-muted-foreground">Etiqueta no disponible</span>}</div>
        </section>
      </div> : error ? <div role="alert" className="py-12 text-center"><p>No se pudieron cargar los pedidos. Vuelve a actualizar.</p></div>
        : view.loading ? <div role="status" className="flex justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Cargando pedidos…</div>
          : !view.orders.length ? <div className="py-10 text-center sm:py-16"><PackageCheck className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="text-sm">{view.searchInput || view.urgency || view.deadlineDate || view.channelCode !== 'all' ? 'No hay pedidos con estos filtros.' : view.emptyCopy}</p>{isPending && view.counts.ready > 0 && <Button className="mt-4" onClick={() => view.setStage('ready')}><Printer />Ir a imprimir {view.counts.ready}</Button>}</div>
            : <div aria-busy={view.fetching} className={cn('min-w-0 transition-opacity duration-200', isColumns && 'grid items-start gap-4 xl:grid-cols-3', view.fetching && 'opacity-60')}>
              {displayGroups.map((group) => {
                const meta = LOGISTICS_URGENCIES.find((entry) => entry.value === group.urgency);
                return <section key={group.key} aria-label={group.label} className={cn("mb-4 min-w-0", layout === '8' && "ml-2 border-l-2 border-l-primary/20 pl-4")}>
                  {showPlazoHeading && <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 text-xs font-semibold"><span className={cn('size-2 rounded-full', meta?.dotClass)} />{group.label}<span className="font-normal text-muted-foreground">{group.orders.length}</span>{(layout === '11' || layout === '12') && <span className="ml-auto text-muted-foreground">{group.orders.reduce((sum, order) => sum + orderUnits(order), 0)} unidades</span>}</div>}
                  <ul className={isColumns ? 'space-y-3 pt-3' : isCard ? 'grid gap-3 pt-3 sm:grid-cols-2 xl:grid-cols-3' : 'divide-y'}>
{group.orders.map((order) => renderOrder(order, meta?.textClass))}
                  </ul>
                </section>;
              })}
            </div>}
      </div>
      {layout === '5' && view.stage !== 'shipped' && <aside className="order-first border-b pb-4 xl:order-last xl:sticky xl:top-0 xl:border-b-0 xl:border-l xl:pb-0 xl:pl-5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">LOTE DE {isPending ? 'PREPARACIÓN' : 'IMPRESIÓN'}</p>
        <p className="mt-3 text-3xl font-semibold tabular-nums">{selectedOrders.length} <span className="text-sm font-normal text-muted-foreground">seleccionados</span></p>
        <p className="mt-1 text-sm text-muted-foreground">{selectedOrders.reduce((sum, order) => sum + order.items.reduce((units, item) => units + item.quantity, 0), 0)} unidades · {new Set(selectedOrders.map((order) => order.companyId)).size} tiendas</p>
        <div className="my-5 max-h-72 space-y-3 overflow-y-auto border-y py-4">{selectedOrders.length ? selectedOrders.map((order) => <div key={order.id} className="flex justify-between gap-2 text-xs"><span className="min-w-0"><span className="block font-mono font-semibold">{order.externalOrderNumber}</span><span className="text-muted-foreground">{sellerShortName(order.companyName)}</span></span><button type="button" onClick={() => toggle(order)} className="text-muted-foreground underline" aria-label={`Quitar pedido ${order.externalOrderNumber}`}>Quitar</button></div>) : <p className="text-sm text-muted-foreground">Selecciona pedidos de la lista para formar el lote.</p>}</div>
        {readyTargets.length > 0 && <Button className="w-full" disabled={locked || !view.canDispatch} onClick={() => view.requestBulkReady(readyTargets)}><PackageCheck />{`Marcar ${readyTargets.length} ${readyTargets.length === 1 ? 'listo' : 'listos'}`}</Button>}
        {deliverTargets.length > 0 && <Button className="mt-2 w-full" variant={readyTargets.length ? 'outline' : 'default'} disabled={locked || !view.canDispatch} onClick={() => view.requestBulkDeliver(deliverTargets)}><Truck />{`Marcar ${deliverTargets.length} ${deliverTargets.length === 1 ? 'entregado' : 'entregados'}`}</Button>}
        {isReady && printTargets.length > 0 && <Button className="mt-2 w-full" variant={deliverTargets.length ? 'outline' : 'default'} disabled={locked} onClick={printAction}><Printer />{`Imprimir ${printTargets.length} pedidos`}</Button>}
        <p className="mt-3 text-xs text-muted-foreground">{isPending ? 'Confirma que el lote está empacado o entregado.' : 'Imprime marketplaces o marca entregados los propios.'}</p>
        {isPending && <Button className="mt-6 w-full justify-between" variant="ghost" onClick={() => view.setStage('ready')}>Ir a imprimir <span>{view.counts.ready}</span></Button>}
      </aside>}
      </div>
      <div className={cn("mt-4 items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground", view.totalCount > pageSize || offset > 0 ? "flex" : "hidden sm:flex")}>
        <span>{view.totalCount ? `${offset + 1}–${Math.min(offset + view.orders.length, view.totalCount)} de ${view.totalCount}` : '0 pedidos'}</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={locked || offset === 0} onClick={() => onPage(Math.max(0, offset - pageSize))}><ChevronLeft />Anterior</Button><Button size="sm" variant="outline" disabled={locked || offset + pageSize >= view.totalCount} onClick={() => onPage(offset + pageSize)}>Siguiente<ChevronRight /></Button></div>
      </div>
      {layout === '14' && view.stage !== 'shipped' && <div className="fixed inset-x-4 bottom-20 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4 shadow-lg xl:left-72">
        <div><p className="text-sm font-semibold">{selectedOrders.length ? `${selectedOrders.length} pedidos seleccionados` : `${eligible.length} pedidos disponibles en esta página`}</p><p className="text-xs text-muted-foreground">{eligible.reduce((sum, order) => sum + orderUnits(order), 0)} unidades · {isPending ? 'Confirma listo o entregado.' : 'Imprime o marca entregados.'}</p></div>
        <div className="flex flex-wrap gap-2">
          {readyTargets.length > 0 && <Button disabled={locked || !view.canDispatch} onClick={() => view.requestBulkReady(readyTargets)}><PackageCheck />{`Marcar ${readyTargets.length} ${readyTargets.length === 1 ? 'listo' : 'listos'}`}</Button>}
          {deliverTargets.length > 0 && <Button variant={readyTargets.length ? 'outline' : 'default'} disabled={locked || !view.canDispatch} onClick={() => view.requestBulkDeliver(deliverTargets)}><Truck />{`Marcar ${deliverTargets.length} ${deliverTargets.length === 1 ? 'entregado' : 'entregados'}`}</Button>}
          {isReady && printTargets.length > 0 && <Button variant={deliverTargets.length ? 'outline' : 'default'} disabled={locked} onClick={printAction}>{view.printing ? <Loader2 className="animate-spin" /> : <Printer />}{`Imprimir ${printTargets.length} pedidos`}</Button>}
        </div>
      </div>}
      <ProductImageLightbox preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
