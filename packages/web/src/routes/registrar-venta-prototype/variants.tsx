import { useState, type ReactNode } from 'react';
import { ArrowLeft, Banknote, Loader2, Search, Trash2 } from 'lucide-react';
import {
  SALE_SOURCES,
  type SaleLine,
} from '../../lib/registrar-venta';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TablePanelFooter,
  TableRow,
} from '../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Choice, NUMBER_INPUT, ProductPhoto, formatMoney } from './widgets';
import { ComprobanteChoice, DeliveryFields, DeliveryHow, PaymentFields } from './fields';
import type { SaleFormView } from './view';

function Back({ view }: { view: SaleFormView }) {
  return (
    <Button type="button" variant="ghost" className="-ml-2 h-9 cursor-pointer px-2" onClick={() => view.navigate(view.afterSavePath)}>
      <ArrowLeft /> Volver
    </Button>
  );
}

function Save({ view, sticky = false }: { view: SaleFormView; sticky?: boolean }) {
  const button = (
    <Button type="submit" className="h-10 cursor-pointer" disabled={view.submitDisabled}>
      {view.creating ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Banknote />}
      {view.creating ? 'Listo…' : 'Registrar venta'}
    </Button>
  );
  if (sticky) {
    return (
      <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-background/95 py-3">
        <p className="text-xl font-semibold tabular-nums">{formatMoney(view.total)}</p>
        {button}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
      <span className="mr-auto text-xl font-semibold tabular-nums">{formatMoney(view.total)}</span>
      {button}
    </div>
  );
}

function QtyPrice({ view, line }: { view: SaleFormView; line: SaleLine }) {
  return (
    <>
      <Input
        type="number"
        min={1}
        value={line.quantity}
        onChange={(event) => view.updateLine(line.id, { quantity: Math.max(1, Math.floor(Number(event.target.value || 1))) })}
        className={NUMBER_INPUT}
        aria-label={`Cantidad ${line.name}`}
      />
      <Input
        type="number"
        min={0}
        step="0.01"
        value={line.unitPrice}
        onChange={(event) => view.updateLine(line.id, { unitPrice: Math.max(0, Number(event.target.value || 0)) })}
        className={NUMBER_INPUT}
        aria-label={`Precio ${line.name}`}
      />
    </>
  );
}

function RemoveLine({ view, line }: { view: SaleFormView; line: SaleLine }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`Quitar ${line.name}`}
      onClick={() => view.setLines((current) => current.filter((item) => item.id !== line.id))}
    >
      <Trash2 />
    </Button>
  );
}

/** A — Same hierarchy as Nueva boleta: labels above fields, 2-col grid, item columns, total inline. */
export function VariantA({ view }: { view: SaleFormView }) {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-8">
      <Back view={view} />
      <section className="space-y-3">
        <p className="text-sm font-medium">Origen</p>
        <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />
      </section>
      <section className="space-y-3">
        <p className="text-sm font-medium">Cliente</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="customer-name">Nombre</Label>
            <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-phone">Teléfono</Label>
            <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Comprobante</Label>
            <ComprobanteChoice view={view} />
          </div>
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Items</p>
          <Button type="button" variant="outline" size="sm" onClick={() => view.setPickerOpen(true)}>
            <Search /> Agregar
          </Button>
        </div>
        <div className="grid grid-cols-[1fr_4.5rem_6.5rem_5.5rem_2rem] items-center gap-3 text-[11px] font-medium text-muted-foreground">
          <span>Descripción</span><span className="text-center">Cant.</span><span className="text-right">Precio</span><span className="text-right">Total</span><span />
        </div>
        {view.lines.length === 0 && <p className="text-sm text-muted-foreground">Agrega un producto.</p>}
        {view.lines.map((line) => (
          <div key={line.id} className="grid grid-cols-[1fr_4.5rem_6.5rem_5.5rem_2rem] items-center gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{line.name}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{line.sku}</p>
            </div>
            <QtyPrice view={view} line={line} />
            <p className="text-right text-sm tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</p>
            <RemoveLine view={view} line={line} />
          </div>
        ))}
      </section>
      <section className="space-y-3">
        <p className="text-sm font-medium">Entrega</p>
        <DeliveryHow view={view} />
        <DeliveryFields view={view} />
      </section>
      <section className="space-y-3">
        <p className="text-sm font-medium">Pago</p>
        <PaymentFields view={view} />
      </section>
      <Save view={view} />
    </div>
  );
}

/** B — Productos-style: toolbar + one TablePanel. Customer/delivery/pay sit under the table. */
export function VariantB({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <Back view={view} />
        <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />
        <span className="ml-auto" />
        <DeliveryHow view={view} />
        <Button type="button" variant="outline" size="sm" onClick={() => view.setPickerOpen(true)}>
          <Search /> Buscar producto
        </Button>
      </div>
      <TablePanel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="w-24 text-right">Cant.</TableHead>
              <TableHead className="w-28 text-right">Precio</TableHead>
              <TableHead className="w-28 text-right">Total</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">Busca un producto del catálogo.</TableCell>
              </TableRow>
            ) : view.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <ProductPhoto url={line.imageUrl} shopSku={line.shopSku} sku={line.sku} name={line.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{line.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{line.sku}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(event) => view.updateLine(line.id, { quantity: Math.max(1, Math.floor(Number(event.target.value || 1))) })}
                    className={NUMBER_INPUT}
                    aria-label={`Cantidad ${line.name}`}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(event) => view.updateLine(line.id, { unitPrice: Math.max(0, Number(event.target.value || 0)) })}
                    className={NUMBER_INPUT}
                    aria-label={`Precio ${line.name}`}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</TableCell>
                <TableCell><RemoveLine view={view} line={line} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePanelFooter className="flex justify-between text-sm">
          <span className="text-muted-foreground">{view.lines.length} ítems</span>
          <span className="font-medium tabular-nums">{formatMoney(view.totals.products)}</span>
        </TablePanelFooter>
      </TablePanel>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2">
          <p className="text-sm font-medium">Cliente</p>
          <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} placeholder="Nombre" />
          <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} placeholder="Teléfono" />
          <ComprobanteChoice view={view} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Entrega</p>
          <DeliveryFields view={view} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Pago</p>
          <PaymentFields view={view} />
        </div>
      </div>
      <Save view={view} />
    </div>
  );
}

/** C — POS: catalog action + ticket on the right. */
export function VariantC({ view }: { view: SaleFormView }) {
  return (
    <div className="grid gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <div className="flex items-center gap-2">
          <Back view={view} />
          <Button type="button" className="h-10 flex-1 cursor-pointer sm:flex-none" onClick={() => view.setPickerOpen(true)}>
            <Search /> Buscar producto
          </Button>
        </div>
        {view.lines.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">El ticket está vacío.</p>}
        <ul className="divide-y divide-border">
          {view.lines.map((line) => (
            <li key={line.id} className="flex items-center gap-3 py-3">
              <ProductPhoto url={line.imageUrl} shopSku={line.shopSku} sku={line.sku} name={line.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{line.name}</p>
                <div className="mt-2 grid max-w-xs grid-cols-2 gap-2">
                  <QtyPrice view={view} line={line} />
                </div>
              </div>
              <p className="text-sm font-semibold tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</p>
              <RemoveLine view={view} line={line} />
            </li>
          ))}
        </ul>
      </div>
      <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
        <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />
        <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} placeholder="Nombre del cliente" />
        <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} placeholder="Teléfono" />
        <ComprobanteChoice view={view} />
        <DeliveryHow view={view} />
        <DeliveryFields view={view} />
        <PaymentFields view={view} />
        <Save view={view} sticky />
      </aside>
    </div>
  );
}

/** D — Dense settings rows. No section titles. */
export function VariantD({ view }: { view: SaleFormView }) {
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="grid items-center gap-3 border-b border-border/70 py-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
  return (
    <div className="mx-auto max-w-2xl pb-8">
      <Back view={view} />
      <Row label="Origen">
        <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />
      </Row>
      <Row label="Nombre">
        <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} />
      </Row>
      <Row label="Teléfono">
        <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} />
      </Row>
      <Row label="Comprobante">
        <ComprobanteChoice view={view} />
      </Row>
      <Row label="Productos">
        <div className="space-y-2">
          {view.lines.map((line) => (
            <div key={line.id} className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm">{line.name}</p>
              <div className="grid w-40 grid-cols-2 gap-1"><QtyPrice view={view} line={line} /></div>
              <RemoveLine view={view} line={line} />
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => view.setPickerOpen(true)}>
            <Search /> Agregar
          </Button>
        </div>
      </Row>
      <Row label="Entrega">
        <div className="space-y-2">
          <DeliveryHow view={view} />
          <DeliveryFields view={view} />
        </div>
      </Row>
      <Row label="Pago">
        <PaymentFields view={view} />
      </Row>
      <Save view={view} />
    </div>
  );
}

/** E — Spoken questions, more air, no uppercase chrome. */
export function VariantE({ view }: { view: SaleFormView }) {
  return (
    <div className="mx-auto max-w-xl space-y-10 pb-8">
      <Back view={view} />
      <section className="space-y-3">
        <h2 className="text-base font-medium">¿De dónde sale?</h2>
        <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-medium">¿Quién compra?</h2>
        <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} placeholder="Nombre" />
        <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} placeholder="Teléfono" />
        <ComprobanteChoice view={view} />
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-medium">¿Qué lleva?</h2>
        {view.lines.map((line) => (
          <div key={line.id} className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{line.name}</p>
              <p className="text-sm tabular-nums text-muted-foreground">{line.quantity} × {formatMoney(line.unitPrice)}</p>
            </div>
            <RemoveLine view={view} line={line} />
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => view.setPickerOpen(true)}><Search /> Agregar producto</Button>
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-medium">¿Cómo se entrega?</h2>
        <DeliveryHow view={view} />
        <DeliveryFields view={view} />
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-medium">¿Cómo paga?</h2>
        <PaymentFields view={view} />
      </section>
      <Save view={view} />
    </div>
  );
}

/** F — One group at a time. */
export function VariantF({ view }: { view: SaleFormView }) {
  const steps = ['Origen', 'Cliente', 'Productos', 'Entrega', 'Pago'] as const;
  const [step, setStep] = useState(0);
  return (
    <div className="mx-auto max-w-xl space-y-6 pb-8">
      <Back view={view} />
      <p className="text-xs tabular-nums text-muted-foreground">{step + 1} / {steps.length} · {steps[step]}</p>
      {step === 0 && <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />}
      {step === 1 && (
        <div className="space-y-3">
          <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} placeholder="Nombre" />
          <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} placeholder="Teléfono" />
          <ComprobanteChoice view={view} />
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3">
          {view.lines.map((line) => (
            <div key={line.id} className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm">{line.name}</p>
              <RemoveLine view={view} line={line} />
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => view.setPickerOpen(true)}><Search /> Agregar</Button>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3">
          <DeliveryHow view={view} />
          <DeliveryFields view={view} />
        </div>
      )}
      {step === 4 && <PaymentFields view={view} />}
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>Atrás</Button>
        <p className="text-lg font-semibold tabular-nums">{formatMoney(view.total)}</p>
        {step < steps.length - 1 ? (
          <Button type="button" onClick={() => setStep((value) => value + 1)}>Siguiente</Button>
        ) : (
          <Button type="submit" disabled={view.submitDisabled}>
            {view.creating ? 'Listo…' : 'Registrar venta'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** G — Products dominate. Identity and fulfillment are thin strips. */
export function VariantG({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-end gap-3">
        <Back view={view} />
        <Input id="customer-name" className="max-w-56" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} placeholder="Cliente" />
        <Input id="customer-phone" className="max-w-40" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} placeholder="Teléfono" />
        <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />
        <Button type="button" variant="outline" className="ml-auto" onClick={() => view.setPickerOpen(true)}>
          <Search /> Buscar producto
        </Button>
      </div>
      <TablePanel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Cant.</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="font-medium">{line.name}<div className="font-mono text-[11px] font-normal text-muted-foreground">{line.sku}</div></TableCell>
                <TableCell colSpan={2}><div className="ml-auto grid w-44 grid-cols-2 gap-2"><QtyPrice view={view} line={line} /></div></TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</TableCell>
                <TableCell><RemoveLine view={view} line={line} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TablePanel>
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-64 flex-1 space-y-2">
          <DeliveryHow view={view} />
          <DeliveryFields view={view} />
        </div>
        <div className="min-w-56 flex-1 space-y-2">
          <ComprobanteChoice view={view} />
          <PaymentFields view={view} />
        </div>
      </div>
      <Save view={view} />
    </div>
  );
}

/** H — Main column products; sticky summary rail. */
export function VariantH({ view }: { view: SaleFormView }) {
  return (
    <div className="grid gap-8 pb-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-4">
        <div className="flex items-center gap-2">
          <Back view={view} />
          <Button type="button" variant="outline" onClick={() => view.setPickerOpen(true)}><Search /> Buscar producto</Button>
        </div>
        {view.lines.map((line) => (
          <div key={line.id} className="flex items-start gap-3 py-2">
            <ProductPhoto url={line.imageUrl} shopSku={line.shopSku} sku={line.sku} name={line.name} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{line.name}</p>
              <div className="mt-2 grid max-w-xs grid-cols-2 gap-2"><QtyPrice view={view} line={line} /></div>
            </div>
            <p className="text-sm tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</p>
            <RemoveLine view={view} line={line} />
          </div>
        ))}
        <div className="space-y-3 pt-4">
          <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} placeholder="Nombre" />
          <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} placeholder="Teléfono" />
          <ComprobanteChoice view={view} />
          <DeliveryHow view={view} />
          <DeliveryFields view={view} />
          <PaymentFields view={view} />
        </div>
      </div>
      <aside className="space-y-3 text-sm lg:sticky lg:top-4 lg:self-start">
        <p className="font-medium">{view.customerName || 'Sin cliente'}</p>
        <p className="text-muted-foreground">{view.saleSource} · {view.delivery === 'envio' ? (view.shippingCarrier || 'Envío') : 'Recojo'}</p>
        <p className="text-muted-foreground">{view.paymentMethod.replace('_', ' ')}</p>
        <p className="text-2xl font-semibold tabular-nums">{formatMoney(view.total)}</p>
        <Button type="submit" className="w-full" disabled={view.submitDisabled}>
          {view.creating ? 'Listo…' : 'Registrar venta'}
        </Button>
      </aside>
    </div>
  );
}

/** I — Narrow receipt. Labels above. No titles. */
export function VariantI({ view }: { view: SaleFormView }) {
  return (
    <div className="mx-auto max-w-md space-y-4 pb-8">
      <Back view={view} />
      <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />
      <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} placeholder="Nombre del cliente" />
      <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} placeholder="Teléfono" />
      <ComprobanteChoice view={view} />
      <div className="space-y-2 py-2">
        {view.lines.map((line) => (
          <div key={line.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{line.quantity} × {line.name}</span>
            <span className="tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</span>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => view.setPickerOpen(true)}>
          <Search /> Producto
        </Button>
      </div>
      <DeliveryHow view={view} />
      <DeliveryFields view={view} />
      <PaymentFields view={view} />
      <Save view={view} />
    </div>
  );
}

/** J — Two beats: venta | despacho. */
export function VariantJ({ view }: { view: SaleFormView }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">
      <Back view={view} />
      <Tabs defaultValue="venta">
        <TabsList>
          <TabsTrigger value="venta">Venta</TabsTrigger>
          <TabsTrigger value="despacho">Despacho y pago</TabsTrigger>
        </TabsList>
        <TabsContent value="venta" className="space-y-4 pt-4">
          <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input id="customer-name" value={view.customerName} onChange={(event) => view.setCustomerName(event.target.value)} placeholder="Nombre" />
            <Input id="customer-phone" value={view.customerPhone} onChange={(event) => view.setCustomerPhone(event.target.value)} placeholder="Teléfono" />
          </div>
          <ComprobanteChoice view={view} />
          <Button type="button" variant="outline" onClick={() => view.setPickerOpen(true)}><Search /> Buscar producto</Button>
          {view.lines.map((line) => (
            <div key={line.id} className="flex items-center gap-3">
              <ProductPhoto url={line.imageUrl} shopSku={line.shopSku} sku={line.sku} name={line.name} size="sm" />
              <p className="min-w-0 flex-1 truncate text-sm">{line.name}</p>
              <div className="grid w-40 grid-cols-2 gap-2"><QtyPrice view={view} line={line} /></div>
              <RemoveLine view={view} line={line} />
            </div>
          ))}
        </TabsContent>
        <TabsContent value="despacho" className="space-y-4 pt-4">
          <DeliveryHow view={view} />
          <DeliveryFields view={view} />
          <PaymentFields view={view} />
        </TabsContent>
      </Tabs>
      <Save view={view} />
    </div>
  );
}
