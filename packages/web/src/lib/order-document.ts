export type DocumentKind = 'boleta' | 'factura';

export type OrderDocumentCustomer = {
  name?: string | null;
  phone?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  legalName?: string | null;
  address?: string | null;
};

export type OrderDocumentItem = {
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  total?: number | null;
};

export type OrderForDocument = {
  id: number;
  companyId?: number | null;
  documentStatus?: string | null;
  requestedDocumentType?: DocumentKind | null;
  documentDecision?: { type?: DocumentKind | null } | null;
  customer?: OrderDocumentCustomer | null;
  shippingAmount?: number | null;
  items?: OrderDocumentItem[] | null;
};

export function pendingDocumentKind(order: OrderForDocument): DocumentKind | null {
  if (order.documentStatus !== 'pending') return null;
  if (order.requestedDocumentType === 'boleta' || order.requestedDocumentType === 'factura') {
    return order.requestedDocumentType;
  }
  if (order.documentDecision?.type === 'boleta' || order.documentDecision?.type === 'factura') {
    return order.documentDecision.type;
  }
  return null;
}

export function generateDocumentPath(kind: DocumentKind) {
  return kind === 'factura' ? '/facturas/new' : '/boletas/new';
}

export function generateDocumentLabel(kind: DocumentKind) {
  return kind === 'factura' ? 'Generar factura' : 'Generar boleta';
}

export type InvoicePrefill = {
  orderId: number;
  companyId: number | null;
  clientNumero: string;
  clientNombre: string;
  clientDireccion: string;
  boletaConDni: boolean;
  items: Array<{ descripcion: string; cantidad: string; precioUnitario: string }>;
};

function moneyString(value: number | null | undefined) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return String(Math.round(amount * 100) / 100);
}

export function invoicePrefillFromOrder(order: OrderForDocument): InvoicePrefill {
  const customer = order.customer || {};
  const documentType = String(customer.documentType || '');
  const items = (order.items || [])
    .map((item) => {
      const unit = item.unitPrice == null && item.total != null && Number(item.quantity) > 0
        ? Number(item.total) / Number(item.quantity)
        : item.unitPrice;
      return {
        descripcion: String(item.description || '').trim(),
        cantidad: String(Math.max(1, Math.round(Number(item.quantity) || 1))),
        precioUnitario: moneyString(unit),
      };
    })
    .filter((item) => item.descripcion);
  const shipping = Number(order.shippingAmount);
  if (Number.isFinite(shipping) && shipping > 0) {
    items.push({
      descripcion: 'Envío',
      cantidad: '1',
      precioUnitario: moneyString(shipping),
    });
  }
  return {
    orderId: order.id,
    companyId: order.companyId == null ? null : Number(order.companyId),
    clientNumero: String(customer.documentNumber || '').trim(),
    clientNombre: String(customer.legalName || customer.name || '').trim(),
    clientDireccion: String(customer.address || '').trim(),
    boletaConDni: documentType !== '0',
    items,
  };
}
