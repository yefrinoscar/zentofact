import type { Dispatch, SetStateAction } from 'react';
import type {
  BoletaIdentity,
  DocumentRequest,
  PaymentMethod,
  SaleLine,
  SaleSource,
  SaleStepId,
} from '../../lib/registrar-venta';
import type { ShippingCarrier } from '../../lib/shipping-carrier';
import type { MapPlace } from '../../components/PlacePicker';
import type { OwnFleetOrigin, OwnFleetQuote } from '../../lib/own-fleet-shipping';
import type { SaleTotals } from '../../lib/sale-summary';

export type PaymentProof = { name: string; type: string; dataUrl: string };

/** Contrato entre la página y los cuerpos de cada paso. Toda la escritura pasa por aquí. */
export type SaleFormView = {
  isAdmin: boolean;
  saleSource: SaleSource;
  setSaleSource: (value: SaleSource) => void;
  customerName: string;
  setCustomerName: (value: string) => void;
  customerPhone: string;
  setCustomerPhone: (value: string) => void;
  documentRequest: DocumentRequest;
  setDocumentRequest: (value: DocumentRequest) => void;
  boletaIdentity: BoletaIdentity;
  setBoletaIdentity: (value: BoletaIdentity) => void;
  customerDocumentNumber: string;
  setCustomerDocumentNumber: (value: string) => void;
  legalName: string;
  setLegalName: (value: string) => void;
  fiscalAddress: string;
  setFiscalAddress: (value: string) => void;
  lines: SaleLine[];
  setLines: Dispatch<SetStateAction<SaleLine[]>>;
  updateLine: (id: string, patch: Partial<SaleLine>) => void;
  removeLine: (id: string) => void;
  delivery: 'envio' | 'recojo';
  setDelivery: (value: 'envio' | 'recojo') => void;
  deliveryDate: string;
  setDeliveryDate: (value: string) => void;
  shippingCarrier: ShippingCarrier | '';
  setShippingCarrier: (value: ShippingCarrier | '') => void;
  dropoffPlace: MapPlace | null;
  setDropoffPlace: (place: MapPlace | null) => void;
  shippingNote: string;
  setShippingNote: (value: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (value: PaymentMethod) => void;
  receivedBy: string;
  setReceivedBy: (value: string) => void;
  paymentProof: PaymentProof | null;
  setPaymentProof: (value: PaymentProof | null) => void;
  attachProof: (file: File | undefined) => void;
  openProductPicker: () => void;
  /** Almacén configurado: dirección, pin y horario de recojo. */
  fleetOrigin: OwnFleetOrigin | null;
  shippingQuote: OwnFleetQuote | null;
  totals: SaleTotals;
  goToStep: (step: SaleStepId) => void;
  navigate: (path: string) => void;
};
