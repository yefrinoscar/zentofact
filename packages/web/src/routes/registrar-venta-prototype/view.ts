import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type {
  BoletaIdentity,
  CatalogProductForSale,
  DocumentRequest,
  PaymentMethod,
  SaleLine,
  SaleSource,
} from '../../lib/registrar-venta';
import type { SaleValidationField } from '../../lib/sale-feedback';
import type { ShippingCarrier } from '../../lib/shipping-carrier';
import type { MapPlace } from '../../components/PlacePicker';
import type { OwnFleetQuote } from '../../lib/own-fleet-shipping';

export type SaleFormView = {
  afterSavePath: string;
  setupError: string;
  isAdmin: boolean;
  creating: boolean;
  submitDisabled: boolean;
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
  paymentProof: { name: string; type: string; dataUrl: string } | null;
  setPaymentProof: (value: { name: string; type: string; dataUrl: string } | null) => void;
  attachProof: (file: File | undefined) => void;
  fieldErrors: Partial<Record<SaleValidationField, string>>;
  clearFieldError: (field: SaleValidationField) => void;
  setPickerOpen: (open: boolean) => void;
  pickerOpen: boolean;
  search: string;
  setSearch: (value: string) => void;
  submitProductSearch: () => void;
  products: CatalogProductForSale[];
  productsFetching: boolean;
  submittedSearch: string;
  addProduct: (product: CatalogProductForSale) => void;
  shippingQuote: OwnFleetQuote | null;
  totals: { products: number; shipping: number; districtAmount: number; distanceAmount: number };
  total: number;
  fillDemo: () => void;
  navigate: (path: string) => void;
  submit: (event: FormEvent) => void;
};

export const PROTOTYPE_VARIANTS = [
  { key: '1', name: 'Tinta' },
  { key: '2', name: 'Lima' },
  { key: '3', name: 'Canela' },
  { key: '4', name: 'Noche' },
  { key: '5', name: 'Recibo' },
  { key: '6', name: 'Baldosas' },
  { key: '7', name: 'Franja' },
  { key: '8', name: 'Columnas' },
  { key: '9', name: 'Brutal' },
  { key: '10', name: 'Globos' },
  { key: '11', name: 'Lista' },
  { key: '12', name: 'Escaparate' },
] as const;

export type PrototypeKey = (typeof PROTOTYPE_VARIANTS)[number]['key'];
