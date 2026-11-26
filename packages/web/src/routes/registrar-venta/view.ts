import type { Dispatch, SetStateAction } from 'react';
import type {
  BoletaIdentity,
  DocumentRequest,
  PaymentMethod,
  PaymentRecipient,
  SaleLine,
  SaleStepId,
} from '../../lib/registrar-venta';
import type { ShippingCarrier } from '../../lib/shipping-carrier';
import type { MapPlace } from '../../components/PlacePicker';
import type { DinsidesQuote } from '../../lib/dinsides-coverage';
import type { OwnFleetOrigin, OwnFleetQuote } from '../../lib/own-fleet-shipping';
import type { SaleTotals } from '../../lib/sale-summary';
import type { ShalomLabelDraft } from '../../lib/shalom-label';

export type PaymentProof = { name: string; type: string; dataUrl: string };
export type SalespersonOption = { id: string; name: string };

/** Contrato entre la página y los cuerpos de cada paso. Toda la escritura pasa por aquí. */
export type SaleFormView = {
  isAdmin: boolean;
  orderDate: string;
  setOrderDate: (value: string) => void;
  showSalespersonSelector: boolean;
  salespeople: SalespersonOption[];
  salespeopleLoading: boolean;
  salespeopleError: string;
  salespersonId: string;
  setSalespersonId: (value: string) => void;
  canCreateSalesperson: boolean;
  openSalespersonCreator: () => void;
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
  sellerShippingInput: string;
  setSellerShippingInput: (value: string) => void;
  dropoffPlace: MapPlace | null;
  setDropoffPlace: (place: MapPlace | null) => void;
  /** Tarifa regular de Dinsides para la dirección. Solo con reparto Dinsides. */
  dinsidesQuote: DinsidesQuote | null;
  useDinsidesPrice: (amount: number) => void;
  shippingNote: string;
  setShippingNote: (value: string) => void;
  /** Datos de la etiqueta Shalom que el vendedor editó. Solo se imprimen; no se guardan en el pedido. */
  shalomLabel: ShalomLabelDraft;
  setShalomLabel: Dispatch<SetStateAction<ShalomLabelDraft>>;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (value: PaymentMethod) => void;
  receivedBy: string;
  setReceivedBy: (value: string) => void;
  paidTo: PaymentRecipient | '';
  setPaidTo: (value: PaymentRecipient | '') => void;
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
