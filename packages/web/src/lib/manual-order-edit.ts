/** Documentos del cliente con su código SUNAT, igual que en la venta manual. */
export const MANUAL_EDIT_DOCUMENT_TYPES = [
  { value: '1', label: 'DNI' },
  { value: '4', label: 'CE' },
  { value: '6', label: 'RUC' },
] as const;

export type ManualOrderEditLine = {
  id: number;
  name: string;
  quantity: string;
  unitPrice: string;
};

export type ManualOrderEditDraft = {
  customerName: string;
  customerPhone: string;
  documentType: string;
  documentNumber: string;
  legalName: string;
  deliveryType: 'envio' | 'recojo';
  carrier: string;
  address: string;
  reference: string;
  deliveryDate: string;
  lines: ManualOrderEditLine[];
};

const DIGITS_ONLY = /\D/g;

function digits(value: string) {
  return String(value || '').replace(DIGITS_ONLY, '');
}

export function validateManualOrderEdit(draft: ManualOrderEditDraft) {
  if (!String(draft.deliveryDate || '').trim()) return 'Indica la fecha de entrega.';
  if (draft.deliveryType === 'envio' && !String(draft.carrier || '').trim()) {
    return 'Elige el repartidor del envío.';
  }
  if (!draft.lines.length) return 'La venta necesita al menos un producto.';
  for (const line of draft.lines) {
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity < 1) return 'La cantidad debe ser al menos 1.';
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return 'El precio no puede ser negativo.';
  }
  if (String(draft.documentNumber || '').trim()) {
    const number = digits(draft.documentNumber);
    if (draft.documentType === '6' && number.length !== 11) return 'El RUC debe tener 11 dígitos.';
    if (draft.documentType === '1' && number.length !== 8) return 'El DNI debe tener 8 dígitos.';
  }
  return null;
}

export function buildManualOrderEditPayload(draft: ManualOrderEditDraft) {
  const documentType = String(draft.documentType || '').trim();
  const legalName = String(draft.legalName || '').trim();
  const envio = draft.deliveryType === 'envio';
  return {
    customer: {
      name: String(draft.customerName || '').trim(),
      phone: String(draft.customerPhone || '').trim(),
      documentNumber: String(draft.documentNumber || '').trim(),
      ...(documentType ? { documentType } : {}),
      ...(documentType === '6' && legalName ? { legalName } : {}),
    },
    shipping: {
      type: draft.deliveryType,
      carrier: envio ? String(draft.carrier || '').trim() : '',
      address: String(draft.address || '').trim(),
      reference: String(draft.reference || '').trim(),
    },
    deliveryDate: String(draft.deliveryDate || '').trim(),
    items: draft.lines.map((line) => ({
      id: line.id,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
    })),
  };
}
