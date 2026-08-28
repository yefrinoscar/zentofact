import {
  BOLETA_IDENTITIES,
  DOCUMENT_REQUESTS,
  PICKUP_ADDRESS,
  limaTodayKey,
  type DocumentRequest,
} from '../../lib/registrar-venta';
import {
  OWN_FLEET_CARRIER,
  OWN_FLEET_COVERAGE_HINT,
  OWN_FLEET_OUT_OF_RANGE_MESSAGE,
} from '../../lib/own-fleet-shipping';
import { SHIPPING_CARRIERS } from '../../lib/shipping-carrier';
import { PAYMENT_METHODS } from '../../lib/registrar-venta';
import { PlacePicker } from '../../components/PlacePicker';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ImagePlus, X } from 'lucide-react';
import { Choice, DeliveryDatePicker, Segmented, formatMoney } from './widgets';
import type { SaleFormView } from './view';

export function selectDocument(view: SaleFormView, value: DocumentRequest) {
  view.setDocumentRequest(value);
  if (value === 'factura' && !view.legalName.trim()) view.setLegalName(view.customerName);
  view.setCustomerDocumentNumber('');
  view.clearFieldError('document');
}

export function DocumentFields({ view }: { view: SaleFormView }) {
  if (view.documentRequest === 'boleta') {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Segmented
          value={view.boletaIdentity}
          options={BOLETA_IDENTITIES}
          onChange={(value) => {
            view.setBoletaIdentity(value);
            view.setCustomerDocumentNumber('');
            view.clearFieldError('document');
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
            view.clearFieldError('document');
          }}
          placeholder={view.boletaIdentity === 'ce' ? '001234567' : '12345678'}
          className="sm:max-w-56"
        />
      </div>
    );
  }
  if (view.documentRequest === 'factura') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="customer-ruc">RUC</Label>
          <Input
            id="customer-ruc"
            value={view.customerDocumentNumber}
            onChange={(event) => {
              view.setCustomerDocumentNumber(event.target.value.replace(/\D/g, '').slice(0, 11));
              view.clearFieldError('document');
            }}
            placeholder="20123456789"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="legal-name">Razón social</Label>
          <Input
            id="legal-name"
            value={view.legalName}
            onChange={(event) => {
              view.setLegalName(event.target.value);
              view.clearFieldError('document');
            }}
            placeholder="Empresa S.A.C."
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="fiscal-address">Dirección fiscal</Label>
          <Input
            id="fiscal-address"
            value={view.fiscalAddress}
            onChange={(event) => {
              view.setFiscalAddress(event.target.value);
              view.clearFieldError('document');
            }}
            placeholder="Av. …"
          />
        </div>
      </div>
    );
  }
  return null;
}

export function DeliveryFields({ view }: { view: SaleFormView }) {
  if (view.delivery === 'recojo') {
    return <p className="text-sm text-muted-foreground">{PICKUP_ADDRESS}</p>;
  }
  return (
    <div className="space-y-3">
      <Choice
        value={view.shippingCarrier}
        options={SHIPPING_CARRIERS}
        onChange={(value) => {
          view.setShippingCarrier(value);
          view.clearFieldError('delivery');
        }}
        ariaLabel="Reparto"
      />
      {view.shippingCarrier === OWN_FLEET_CARRIER && (
        <p className="text-xs text-muted-foreground">
          {OWN_FLEET_COVERAGE_HINT}
          {view.isAdmin ? (
            <>
              {' '}
              <button type="button" className="cursor-pointer underline-offset-2 hover:underline" onClick={() => view.navigate('/orders/envio')}>
                Distritos
              </button>
            </>
          ) : null}
        </p>
      )}
      <PlacePicker
        value={view.dropoffPlace}
        onChange={(place) => {
          view.setDropoffPlace(place);
          view.clearFieldError('delivery');
        }}
        placeholder="Distrito de Lima metropolitana"
      />
      {view.shippingCarrier === OWN_FLEET_CARRIER && view.dropoffPlace && view.shippingQuote?.charged && (
        <p className="text-sm tabular-nums text-muted-foreground">
          {view.shippingQuote.zoneLabel || 'Distrito'} {formatMoney(view.shippingQuote.districtAmount)}
          {' · '}
          {view.shippingQuote.distanceKm.toFixed(1).replace('.', ',')} km {formatMoney(view.shippingQuote.distanceAmount)}
        </p>
      )}
      {view.shippingCarrier === OWN_FLEET_CARRIER && view.dropoffPlace && view.shippingQuote && !view.shippingQuote.charged && (
        <p className="text-sm text-destructive">{OWN_FLEET_OUT_OF_RANGE_MESSAGE}</p>
      )}
      <Input
        id="shipping-note"
        value={view.shippingNote}
        onChange={(event) => {
          view.setShippingNote(event.target.value);
          view.clearFieldError('delivery');
        }}
        placeholder="Dpto, color de puerta…"
      />
    </div>
  );
}

export function PaymentFields({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-3">
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
      {view.paymentMethod === 'efectivo' && (
        <Input
          id="received-by"
          value={view.receivedBy}
          onChange={(event) => view.setReceivedBy(event.target.value)}
          placeholder="¿Quién cobró? Opcional"
        />
      )}
      {(view.paymentMethod === 'yape_plin' || view.paymentMethod === 'transferencia') && (
        view.paymentProof ? (
          <div className="flex items-center gap-2">
            <img src={view.paymentProof.dataUrl} alt="" className="size-10 rounded-md object-cover" />
            <span className="min-w-0 flex-1 truncate text-sm">{view.paymentProof.name}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Quitar constancia" onClick={() => view.setPaymentProof(null)}>
              <X />
            </Button>
          </div>
        ) : (
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ImagePlus className="size-4" />
            Foto opcional
            <input type="file" accept="image/*" className="sr-only" onChange={(event) => view.attachProof(event.target.files?.[0])} />
          </label>
        )
      )}
    </div>
  );
}

export function DeliveryHow({ view }: { view: SaleFormView }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
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
          view.clearFieldError('delivery');
        }}
        ariaLabel="Método de entrega"
      />
      <DeliveryDatePicker
        value={view.deliveryDate}
        onChange={(value) => {
          view.setDeliveryDate(value);
          view.clearFieldError('delivery');
        }}
        minDateKey={limaTodayKey()}
        ariaLabel={view.delivery === 'envio' ? 'Fecha de entrega' : 'Fecha de recojo'}
      />
    </div>
  );
}

export function ComprobanteChoice({ view }: { view: SaleFormView }) {
  return (
    <div className="space-y-2">
      <Choice
        value={view.documentRequest}
        options={DOCUMENT_REQUESTS}
        onChange={(value) => selectDocument(view, value)}
        ariaLabel="Comprobante"
      />
      {view.documentRequest !== 'none' ? (
        <p className="text-xs text-muted-foreground">Se emite después desde Pedidos.</p>
      ) : null}
      <DocumentFields view={view} />
    </div>
  );
}
