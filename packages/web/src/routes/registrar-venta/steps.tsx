import { ImagePlus, Package, Plus, Search, Trash2, X } from 'lucide-react';
import {
  BOLETA_IDENTITIES,
  DOCUMENT_REQUESTS,
  PAYMENT_METHODS,
  PICKUP_ADDRESS,
  SALE_SOURCES,
  limaTodayKey,
  saleLinesTotal,
  type DocumentRequest,
} from '../../lib/registrar-venta';
import {
  OWN_FLEET_CARRIER,
  OWN_FLEET_COVERAGE_HINT,
  OWN_FLEET_OUT_OF_RANGE_MESSAGE,
} from '../../lib/own-fleet-shipping';
import { SHIPPING_CARRIERS } from '../../lib/shipping-carrier';
import { formatSaleMoney } from '../../lib/sale-summary';
import { cn } from '../../lib/cn';
import { PlacePicker } from '../../components/PlacePicker';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Choice, DeliveryDatePicker, FieldRow, NUMBER_INPUT, ProductPhoto } from './widgets';
import type { SaleFormView } from './view';

function selectDocument(view: SaleFormView, value: DocumentRequest) {
  view.setDocumentRequest(value);
  if (value === 'factura' && !view.legalName.trim()) view.setLegalName(view.customerName);
  view.setCustomerDocumentNumber('');
}

function DocumentFields({ view }: { view: SaleFormView }) {
  if (view.documentRequest === 'boleta') {
    return (
      <FieldRow label={view.boletaIdentity === 'ce' ? 'CE' : 'DNI'} htmlFor="customer-document">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Choice
            value={view.boletaIdentity}
            options={BOLETA_IDENTITIES}
            onChange={(value) => {
              view.setBoletaIdentity(value);
              view.setCustomerDocumentNumber('');
            }}
            ariaLabel="Tipo de documento"
          />
          <Input
            id="customer-document"
            value={view.customerDocumentNumber}
            onChange={(event) => {
              const next = view.boletaIdentity === 'dni'
                ? event.target.value.replace(/\D/g, '').slice(0, 8)
                : event.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
              view.setCustomerDocumentNumber(next);
            }}
            placeholder={view.boletaIdentity === 'ce' ? '001234567' : '12345678'}
            inputMode={view.boletaIdentity === 'dni' ? 'numeric' : 'text'}
            autoComplete="off"
            className="sm:max-w-56"
          />
        </div>
      </FieldRow>
    );
  }

  if (view.documentRequest === 'factura') {
    return (
      <>
        <FieldRow label="RUC" htmlFor="customer-ruc">
          <Input
            id="customer-ruc"
            value={view.customerDocumentNumber}
            onChange={(event) => view.setCustomerDocumentNumber(event.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder="20123456789"
            inputMode="numeric"
            autoComplete="off"
          />
        </FieldRow>
        <FieldRow label="Razón social" htmlFor="legal-name">
          <Input
            id="legal-name"
            value={view.legalName}
            onChange={(event) => view.setLegalName(event.target.value)}
            placeholder="Empresa S.A.C."
            autoComplete="organization"
          />
        </FieldRow>
        <FieldRow label="Dirección fiscal" htmlFor="fiscal-address">
          <Input
            id="fiscal-address"
            value={view.fiscalAddress}
            onChange={(event) => view.setFiscalAddress(event.target.value)}
            placeholder="Av. …"
            autoComplete="street-address"
          />
        </FieldRow>
      </>
    );
  }

  return null;
}

export function ClienteStep({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-4">
      <FieldRow label="Origen">
        <Choice value={view.saleSource} options={SALE_SOURCES} onChange={view.setSaleSource} ariaLabel="Origen de la venta" />
      </FieldRow>
      <FieldRow label="Nombre" htmlFor="customer-name">
        <Input
          id="customer-name"
          value={view.customerName}
          onChange={(event) => view.setCustomerName(event.target.value)}
          placeholder="Nombre del cliente"
          autoComplete="name"
        />
      </FieldRow>
      <FieldRow label="Teléfono" htmlFor="customer-phone">
        <Input
          id="customer-phone"
          value={view.customerPhone}
          onChange={(event) => view.setCustomerPhone(event.target.value)}
          placeholder="999 999 999"
          inputMode="tel"
          autoComplete="tel"
        />
      </FieldRow>
      <FieldRow label="Comprobante">
        <Choice
          value={view.documentRequest}
          options={DOCUMENT_REQUESTS}
          onChange={(value) => selectDocument(view, value)}
          ariaLabel="Comprobante"
        />
        {view.documentRequest !== 'none' ? (
          <p className="mt-1.5 text-xs text-muted-foreground">Se emite después desde Pedidos.</p>
        ) : null}
      </FieldRow>
      <DocumentFields view={view} />
    </div>
  );
}

export function ProductosStep({ view }: { view: SaleFormView }) {
  if (!view.lines.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <Package className="size-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">Todavía no hay productos</p>
        <p className="text-sm text-muted-foreground">Busca en el catálogo y agrega lo que lleva el cliente.</p>
        <Button type="button" variant="outline" className="mt-2 h-9 cursor-pointer" onClick={view.openProductPicker}>
          <Search /> Buscar producto
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Ajusta el precio si es por mayor.</p>
        <Button type="button" variant="outline" className="h-9 shrink-0 cursor-pointer" onClick={view.openProductPicker}>
          <Plus /> Agregar
        </Button>
      </div>

      <ul className="divide-y divide-border">
        {view.lines.map((line, index) => (
          <li key={line.id} className={cn('py-3', index === 0 && 'pt-0')}>
            <div className="flex items-start gap-3">
              <ProductPhoto url={line.imageUrl} shopSku={line.shopSku} sku={line.sku} name={line.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-5">{line.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{line.sku}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-9 shrink-0 cursor-pointer"
                    aria-label={`Quitar ${line.name}`}
                    onClick={() => view.removeLine(line.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`qty-${line.id}`} className="text-[11px] text-muted-foreground">Cant.</Label>
                    <Input
                      id={`qty-${line.id}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={line.quantity}
                      onChange={(event) => view.updateLine(line.id, { quantity: Math.max(1, Math.floor(Number(event.target.value || 1))) })}
                      className={cn('h-10 bg-background sm:h-9', NUMBER_INPUT)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`price-${line.id}`} className="text-[11px] text-muted-foreground">Precio</Label>
                    <Input
                      id={`price-${line.id}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(event) => view.updateLine(line.id, { unitPrice: Math.max(0, Number(event.target.value || 0)) })}
                      className={cn('h-10 bg-background tabular-nums sm:h-9', NUMBER_INPUT)}
                    />
                  </div>
                  <p className="min-w-16 pb-2 text-right text-sm font-semibold tabular-nums">
                    {formatSaleMoney(line.unitPrice * line.quantity)}
                  </p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">
          {view.lines.length === 1 ? '1 producto' : `${view.lines.length} productos`}
        </span>
        <span className="font-semibold tabular-nums">{formatSaleMoney(saleLinesTotal(view.lines))}</span>
      </div>
    </div>
  );
}

export function EntregaStep({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-4">
      <FieldRow label="Cómo">
        <div className="flex flex-wrap items-center gap-2">
          <Choice
            value={view.delivery}
            options={[
              { value: 'envio', label: 'Envío' },
              { value: 'recojo', label: 'Recojo' },
            ]}
            onChange={(value) => {
              view.setDelivery(value);
              if (value === 'recojo') {
                view.setShippingCarrier('');
                view.setDropoffPlace(null);
                view.setShippingNote('');
              }
            }}
            ariaLabel="Método de entrega"
          />
          <DeliveryDatePicker
            value={view.deliveryDate}
            onChange={view.setDeliveryDate}
            minDateKey={limaTodayKey()}
            ariaLabel={view.delivery === 'envio' ? 'Fecha de entrega' : 'Fecha de recojo'}
          />
        </div>
      </FieldRow>

      {view.delivery === 'envio' ? (
        <>
          <FieldRow label="Reparto">
            <Choice
              value={view.shippingCarrier}
              options={SHIPPING_CARRIERS}
              onChange={view.setShippingCarrier}
              ariaLabel="Reparto"
            />
            {view.shippingCarrier === OWN_FLEET_CARRIER && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {OWN_FLEET_COVERAGE_HINT}
                {view.isAdmin ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="cursor-pointer underline-offset-2 hover:underline"
                      onClick={() => view.navigate('/orders/envio')}
                    >
                      Distritos
                    </button>
                  </>
                ) : null}
              </p>
            )}
          </FieldRow>
          <FieldRow label="Dirección">
            <PlacePicker
              value={view.dropoffPlace}
              onChange={view.setDropoffPlace}
              placeholder="Distrito de Lima metropolitana"
            />
            {view.shippingCarrier === OWN_FLEET_CARRIER && view.dropoffPlace && view.shippingQuote?.charged && (
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-muted-foreground">{view.shippingQuote.zoneLabel || 'Distrito'}</span>
                  <span className="shrink-0 tabular-nums">{formatSaleMoney(view.shippingQuote.districtAmount)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">
                    {view.shippingQuote.distanceKm.toFixed(1).replace('.', ',')} km
                  </span>
                  <span className="shrink-0 tabular-nums">{formatSaleMoney(view.shippingQuote.distanceAmount)}</span>
                </div>
              </div>
            )}
            {view.shippingCarrier === OWN_FLEET_CARRIER && view.dropoffPlace && view.shippingQuote && !view.shippingQuote.charged && (
              <p className="mt-2 text-sm text-destructive">{OWN_FLEET_OUT_OF_RANGE_MESSAGE}</p>
            )}
            {view.shippingCarrier === OWN_FLEET_CARRIER && !view.dropoffPlace && (
              <p className="mt-1.5 text-xs text-muted-foreground">Busca un distrito de Lima metropolitana.</p>
            )}
          </FieldRow>
          <FieldRow label="Referencia" htmlFor="shipping-note">
            <Input
              id="shipping-note"
              value={view.shippingNote}
              onChange={(event) => view.setShippingNote(event.target.value)}
              placeholder="Dpto, color de puerta…"
            />
          </FieldRow>
        </>
      ) : (
        <FieldRow label="Tienda">
          <p className="text-sm leading-6 text-muted-foreground sm:pt-2">{PICKUP_ADDRESS}</p>
        </FieldRow>
      )}
    </div>
  );
}

export function PagoStep({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-4">
      <FieldRow label="Método">
        <Choice
          value={view.paymentMethod}
          options={PAYMENT_METHODS}
          onChange={(value) => {
            view.setPaymentMethod(value);
            if (value === 'efectivo' || value === 'despues') view.setPaymentProof(null);
            if (value !== 'efectivo') view.setReceivedBy('');
          }}
          ariaLabel="Método de pago"
        />
        {view.paymentMethod === 'despues' ? (
          <p className="mt-1.5 text-xs text-muted-foreground">La venta queda pendiente de cobro.</p>
        ) : null}
      </FieldRow>

      {view.paymentMethod === 'efectivo' && (
        <FieldRow label="¿Quién cobró?" htmlFor="received-by">
          <Input
            id="received-by"
            value={view.receivedBy}
            onChange={(event) => view.setReceivedBy(event.target.value)}
            placeholder="Opcional"
          />
        </FieldRow>
      )}

      {(view.paymentMethod === 'yape_plin' || view.paymentMethod === 'transferencia') && (
        <FieldRow label="Constancia">
          {view.paymentProof ? (
            <div className="flex items-center gap-2">
              <img src={view.paymentProof.dataUrl} alt="" className="size-10 rounded-md object-cover" />
              <span className="min-w-0 flex-1 truncate text-sm">{view.paymentProof.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 cursor-pointer"
                aria-label="Quitar constancia"
                onClick={() => view.setPaymentProof(null)}
              >
                <X />
              </Button>
            </div>
          ) : (
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ImagePlus className="size-4" />
              Foto opcional
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => view.attachProof(event.target.files?.[0])}
              />
            </label>
          )}
        </FieldRow>
      )}
    </div>
  );
}
