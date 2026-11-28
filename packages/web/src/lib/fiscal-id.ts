// Validación local de los datos fiscales que el operador carga en un pedido
// de la tienda web antes de emitir su comprobante. No consulta servicios
// externos: solo formato (y dígito verificador del RUC).

export type FiscalDocumentKind = 'boleta' | 'factura';
/** Códigos SUNAT (catálogo 06): 0 sin documento, 1 DNI, 4 CE, 7 pasaporte, 6 RUC. */
export type FiscalDocumentType = '0' | '1' | '4' | '7' | '6';

export const ANONYMOUS_BOLETA_MAX_AMOUNT = 700;
export const ANONYMOUS_CUSTOMER_NAME = 'CLIENTE VARIOS';

export const BOLETA_DOCUMENT_TYPES: Array<{ value: FiscalDocumentType; label: string }> = [
  { value: '1', label: 'DNI' },
  { value: '4', label: 'Carné de extranjería' },
  { value: '7', label: 'Pasaporte' },
  { value: '0', label: 'Sin documento' },
];

export type FiscalForm = {
  kind: FiscalDocumentKind;
  documentType: FiscalDocumentType;
  documentNumber: string;
  name: string;
  address: string;
};

export type FiscalFormErrors = Partial<Record<'documentType' | 'documentNumber' | 'name' | 'address', string>>;

const RUC_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const RUC_PREFIXES = ['10', '15', '17', '20'];

export function isValidDni(value: string) {
  return /^\d{8}$/.test(String(value || '').trim());
}

export function isValidCe(value: string) {
  return /^[A-Za-z0-9]{9,12}$/.test(String(value || '').trim());
}

export function isValidPassport(value: string) {
  return /^[A-Za-z0-9]{6,12}$/.test(String(value || '').trim());
}

/** RUC de 11 dígitos con prefijo válido y dígito verificador SUNAT (módulo 11). */
export function isValidRuc(value: string) {
  const ruc = String(value || '').trim();
  if (!/^\d{11}$/.test(ruc)) return false;
  if (!RUC_PREFIXES.includes(ruc.slice(0, 2))) return false;
  const sum = RUC_WEIGHTS.reduce((total, weight, index) => total + weight * Number(ruc[index]), 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 1;
  return check === Number(ruc[10]);
}

/** Normaliza el número según su tipo: solo dígitos para DNI/RUC, alfanumérico en mayúsculas para CE/pasaporte. */
export function normalizeFiscalNumber(type: FiscalDocumentType, value: string) {
  const raw = String(value || '').trim();
  if (type === '1' || type === '6') return raw.replace(/\D/g, '');
  if (type === '4' || type === '7') return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return '';
}

/**
 * Valida el formulario de emisión. Devuelve los errores por campo y el
 * formulario normalizado listo para enviar (factura fuerza RUC; la boleta sin
 * documento se emite a "CLIENTE VARIOS").
 */
export function validateFiscalForm(form: FiscalForm, orderTotal: number | null | undefined) {
  const errors: FiscalFormErrors = {};
  const kind: FiscalDocumentKind = form.kind === 'factura' ? 'factura' : 'boleta';
  const documentType: FiscalDocumentType = kind === 'factura' ? '6' : form.documentType;
  const documentNumber = normalizeFiscalNumber(documentType, form.documentNumber);
  let name = String(form.name || '').trim().replace(/\s+/g, ' ');
  const address = String(form.address || '').trim().replace(/\s+/g, ' ');
  const total = Number(orderTotal);

  if (kind === 'factura') {
    if (!isValidRuc(documentNumber)) errors.documentNumber = 'Ingresa un RUC válido de 11 dígitos.';
    if (!name) errors.name = 'Ingresa la razón social.';
    if (!address) errors.address = 'La factura requiere la dirección fiscal.';
  } else if (documentType === '0') {
    if (!Number.isFinite(total) || total > ANONYMOUS_BOLETA_MAX_AMOUNT) {
      errors.documentType = `Las boletas mayores a S/ ${ANONYMOUS_BOLETA_MAX_AMOUNT} requieren identificar al cliente.`;
    }
    name = ANONYMOUS_CUSTOMER_NAME;
  } else if (documentType === '1') {
    if (!isValidDni(documentNumber)) errors.documentNumber = 'El DNI debe tener 8 dígitos.';
  } else if (documentType === '4') {
    if (!isValidCe(documentNumber)) errors.documentNumber = 'El carné de extranjería tiene de 9 a 12 letras o números.';
  } else if (documentType === '7') {
    if (!isValidPassport(documentNumber)) errors.documentNumber = 'El pasaporte tiene de 6 a 12 letras o números.';
  } else {
    errors.documentType = 'Elige el tipo de documento.';
  }
  if (kind === 'boleta' && documentType !== '0' && !name) errors.name = 'Ingresa el nombre del cliente.';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { kind, documentType, documentNumber: documentType === '0' ? '' : documentNumber, name, address },
  };
}

/** Formulario inicial a partir de los datos que ya tiene el pedido. */
export function fiscalFormFromOrder(order: {
  requestedDocumentType?: FiscalDocumentKind | null;
  customer?: { name?: string | null; legalName?: string | null; documentType?: string | null; documentNumber?: string | null; address?: string | null } | null;
}): FiscalForm {
  const customer = order.customer || {};
  const storedType = String(customer.documentType || '').trim();
  const number = String(customer.documentNumber || '').trim();
  const kind: FiscalDocumentKind = order.requestedDocumentType === 'factura' || storedType === '6' ? 'factura' : 'boleta';
  const boletaType: FiscalDocumentType = (['0', '1', '4', '7'] as string[]).includes(storedType)
    ? storedType as FiscalDocumentType
    : '1';
  return {
    kind,
    documentType: kind === 'factura' ? '6' : boletaType,
    documentNumber: number,
    name: String((kind === 'factura' ? customer.legalName || customer.name : customer.name || customer.legalName) || '').trim(),
    address: String(customer.address || '').trim(),
  };
}
