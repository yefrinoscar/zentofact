import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { A4_HEIGHT, A4_WIDTH, LABELS_PER_PAGE } from './shipping-label-sheet.js';

const PAGE_MARGIN = 14;
const CELL_GAP = 10;
const MAX_LABELS = 200;

const INK = rgb(0.09, 0.11, 0.12);
const MUTED = rgb(0.38, 0.42, 0.45);
const LINE = rgb(0.78, 0.82, 0.84);
const PAPER = rgb(1, 1, 1);
const TEAL = rgb(0.05, 0.45, 0.43);
const TEAL_SOFT = rgb(0.90, 0.97, 0.96);

const CARRIER_LABELS = {
  marvisuar: 'Marvisuar',
  shaloom: 'Shaloom',
  dinsides: 'Dinsides',
  nosotros: 'Express',
};

export function deliveryLine(order = {}) {
  const shipping = order.shipping || {};
  const metadata = order.metadata || {};
  const type = String(shipping.type || metadata.delivery || '').trim().toLowerCase();
  if (type === 'recojo') return 'Recojo en tienda';
  const carrier = CARRIER_LABELS[String(shipping.carrier || metadata.shippingCarrier || '').trim().toLowerCase()];
  if (carrier) return `Envío · ${carrier}`;
  if (type === 'envio' || shipping.trackingCode) return 'Envío';
  return 'Entrega propia';
}

export function shippingAddressLine(shipping = {}) {
  const raw = shipping.address;
  if (typeof raw === 'string' && raw.trim() && raw.trim() !== '[object Object]') return raw.trim();
  if (raw && typeof raw === 'object') {
    const parts = [
      raw.Address1, raw.address1, raw.address, raw.line1,
      raw.Address2, raw.address2, raw.line2,
      raw.district, raw.District, raw.City, raw.city,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(', ');
  }
  const fallback = [shipping.district, shipping.province, shipping.department]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return fallback.join(', ');
}

function safePdfText(font, value) {
  const source = String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
  let result = '';
  for (const character of source) {
    try {
      font.encodeText(character);
      result += character;
    } catch {
      result += '?';
    }
  }
  return result;
}

function wrapPdfText(font, value, size, maxWidth, maxLines = 2) {
  const safe = safePdfText(font, value);
  if (!safe) return [];
  const words = safe.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
}

function orderNumber(order) {
  return String(order.externalOrderNumber || order.externalOrderId || order.id || '').trim() || `PED-${order.id}`;
}

function customerName(order) {
  return String(order.customer?.name || '').trim() || 'Cliente no informado';
}

function itemLines(order) {
  return (Array.isArray(order.items) ? order.items : []).map((item) => ({
    sku: String(item.sku || item.providerSku || item.sellerSku || '').trim() || 'Sin SKU',
    name: String(item.description || item.name || '').trim() || 'Producto',
    quantity: Math.max(1, Number(item.quantity) || 1),
  }));
}

function drawManualLabel(page, fonts, order, bounds) {
  const { regular, bold } = fonts;
  const { x, y, width, height } = bounds;
  const headerHeight = 28;
  const number = orderNumber(order);
  const items = itemLines(order);
  const units = items.reduce((total, item) => total + item.quantity, 0);

  page.drawRectangle({
    x, y, width, height,
    color: PAPER,
    borderColor: LINE,
    borderWidth: 1,
  });
  page.drawRectangle({
    x, y: y + height - headerHeight, width, height: headerHeight,
    color: TEAL,
  });
  page.drawText('ZENTOFACT', {
    x: x + 10,
    y: y + height - 18,
    size: 8,
    font: bold,
    color: PAPER,
  });
  const delivery = wrapPdfText(bold, deliveryLine(order), 8, width - 118, 1)[0] || 'Entrega';
  page.drawText(delivery, {
    x: x + width - 10 - bold.widthOfTextAtSize(delivery, 8),
    y: y + height - 18,
    size: 8,
    font: bold,
    color: PAPER,
  });

  page.drawRectangle({
    x: x + 8,
    y: y + height - 78,
    width: width - 16,
    height: 42,
    color: TEAL_SOFT,
  });
  page.drawText('PEDIDO', {
    x: x + 14,
    y: y + height - 50,
    size: 6.5,
    font: bold,
    color: MUTED,
  });
  const numberSize = number.length > 16 ? 13 : 16;
  page.drawText(wrapPdfText(bold, number, numberSize, width - 36, 1)[0] || number, {
    x: x + 14,
    y: y + height - 70,
    size: numberSize,
    font: bold,
    color: INK,
  });

  page.drawText('CLIENTE', {
    x: x + 12,
    y: y + height - 96,
    size: 6.2,
    font: bold,
    color: MUTED,
  });
  wrapPdfText(bold, customerName(order), 10, width - 24, 2).forEach((line, index) => {
    page.drawText(line, {
      x: x + 12,
      y: y + height - 110 - index * 12,
      size: 10,
      font: bold,
      color: INK,
    });
  });

  const address = shippingAddressLine(order.shipping);
  if (address) {
    wrapPdfText(regular, address, 8, width - 24, 3).forEach((line, index) => {
      page.drawText(line, {
        x: x + 12,
        y: y + height - 138 - index * 10,
        size: 8,
        font: regular,
        color: INK,
      });
    });
  }

  const phone = String(order.customer?.phone || '').trim();
  if (phone) {
    page.drawText(wrapPdfText(regular, `Tel. ${phone}`, 8, width - 24, 1)[0], {
      x: x + 12,
      y: y + 92,
      size: 8,
      font: regular,
      color: MUTED,
    });
  }

  page.drawLine({
    start: { x: x + 10, y: y + 84 },
    end: { x: x + width - 10, y: y + 84 },
    thickness: 0.6,
    color: LINE,
  });
  page.drawText(`${items.length} producto${items.length === 1 ? '' : 's'}  ·  ${units} unid.`, {
    x: x + 12,
    y: y + 70,
    size: 7.5,
    font: bold,
    color: MUTED,
  });

  items.slice(0, 4).forEach((item, index) => {
    const lineY = y + 56 - index * 12;
    const qty = `x${item.quantity}`;
    page.drawText(qty, {
      x: x + 12,
      y: lineY,
      size: 8,
      font: bold,
      color: INK,
    });
    const desc = wrapPdfText(regular, `${item.sku}  ${item.name}`, 7.5, width - 48, 1)[0] || item.sku;
    page.drawText(desc, {
      x: x + 36,
      y: lineY,
      size: 7.5,
      font: regular,
      color: INK,
    });
  });
  if (items.length > 4) {
    page.drawText(`+${items.length - 4} más en la guía de armado`, {
      x: x + 12,
      y: y + 8,
      size: 7,
      font: regular,
      color: MUTED,
    });
  }

  const seller = String(order.companyName || order.channelAccountName || '').trim();
  if (seller) {
    const sellerLine = wrapPdfText(bold, seller, 7, width - 24, 1)[0];
    page.drawText(sellerLine, {
      x: x + width - 12 - bold.widthOfTextAtSize(sellerLine, 7),
      y: y + 10,
      size: 7,
      font: bold,
      color: MUTED,
    });
  }
}

export async function buildManualLabelSheet(orders = []) {
  if (!Array.isArray(orders) || !orders.length) {
    throw new Error('Selecciona al menos un pedido manual para imprimir.');
  }
  if (orders.length > MAX_LABELS) {
    throw new Error(`Puedes imprimir hasta ${MAX_LABELS} etiquetas manuales por vez.`);
  }

  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const cellWidth = (A4_WIDTH - PAGE_MARGIN * 2 - CELL_GAP) / 2;
  const cellHeight = (A4_HEIGHT - PAGE_MARGIN * 2 - CELL_GAP) / 2;

  orders.forEach((order, index) => {
    const slot = index % LABELS_PER_PAGE;
    const page = slot === 0 ? pdf.addPage([A4_WIDTH, A4_HEIGHT]) : pdf.getPages().at(-1);
    if (slot === 0) {
      page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT, color: PAPER });
    }
    const column = slot % 2;
    const row = Math.floor(slot / 2);
    drawManualLabel(page, fonts, order, {
      x: PAGE_MARGIN + column * (cellWidth + CELL_GAP),
      y: A4_HEIGHT - PAGE_MARGIN - (row + 1) * cellHeight - row * CELL_GAP,
      width: cellWidth,
      height: cellHeight,
    });
  });

  return pdf.save();
}
