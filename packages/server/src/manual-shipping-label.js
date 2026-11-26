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
    page.drawText(`+${items.length - 4} productos más`, {
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

/** Datos de agencia guardados al registrar una venta con Shaloom. */
export function shalomLabelData(order = {}) {
  const shipping = order.shipping || {};
  if (String(shipping.carrier || '').trim().toLowerCase() !== 'shaloom') return null;
  const raw = shipping.shalom;
  if (!raw || typeof raw !== 'object') return null;
  const label = {
    name: String(raw.name || '').trim(),
    dni: String(raw.dni || '').trim(),
    phone: String(raw.phone || '').trim(),
    sede: String(raw.sede || '').trim(),
  };
  return label.name || label.dni || label.phone || label.sede ? label : null;
}

/** El tamaño más grande en que el texto entra completo en una o dos líneas. */
function fitPdfLines(font, value, maxWidth, sizes, singleLineMin = Infinity) {
  const safe = safePdfText(font, value);
  // Una sola línea mientras la letra no baje de `singleLineMin`.
  for (const size of sizes) {
    if (size < singleLineMin) break;
    if (font.widthOfTextAtSize(safe, size) <= maxWidth) return { size, lines: [safe] };
  }
  for (const size of sizes) {
    const lines = wrapPdfText(font, safe, size, maxWidth, 2);
    const fits = lines.join(' ') === safe && lines.every((line) => font.widthOfTextAtSize(line, size) <= maxWidth);
    if (fits) return { size, lines };
  }
  const size = sizes.at(-1);
  return { size, lines: wrapPdfText(font, safe, size, maxWidth, 3) };
}

/** Dos etiquetas Shalom, una abajo de otra, en una hoja A4 horizontal. */
export const SHALOM_LABELS_PER_PAGE = 2;

/** Formato de la plantilla de Excel: NOMBRE, DNI, CELULAR y SEDE en dos columnas, sin grilla, dentro de un borde. */
function drawShalomLabel(page, fonts, order, label, bounds) {
  const { regular, bold } = fonts;
  const { x, y, width, height } = bounds;
  page.drawRectangle({ x, y, width, height, color: PAPER, borderColor: INK, borderWidth: 1.4 });

  const keyWidth = Math.round(width * 0.26);
  const valueWidth = width - keyWidth - 48;
  const rows = [
    ['NOMBRE', label.name.toUpperCase()],
    ['DNI', label.dni],
    ['CELULAR', label.phone],
    ['SEDE', label.sede],
  ].map(([key, value]) => ({ key, ...fitPdfLines(bold, value || '-', valueWidth, [26, 23, 20, 17, 14, 12], 17) }));
  const keySize = 18;
  const rowGap = 12;
  const rowHeights = rows.map((row) => Math.max(keySize, row.lines.length * row.size * 1.15));
  const blockHeight = rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) + rowGap * (rows.length - 1);
  let top = y + height / 2 + blockHeight / 2;

  rows.forEach((row, index) => {
    const rowHeight = rowHeights[index];
    const middle = top - rowHeight / 2;
    page.drawText(row.key, {
      x: x + 24 + (keyWidth - bold.widthOfTextAtSize(row.key, keySize)) / 2,
      y: middle - keySize * 0.35,
      size: keySize,
      font: bold,
      color: INK,
    });
    const lineHeight = row.size * 1.15;
    const firstLine = middle + ((row.lines.length - 1) * lineHeight) / 2;
    row.lines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: x + 24 + keyWidth + (valueWidth - bold.widthOfTextAtSize(line, row.size)) / 2,
        y: firstLine - lineIndex * lineHeight - row.size * 0.35,
        size: row.size,
        font: bold,
        color: INK,
      });
    });
    top -= rowHeight + rowGap;
  });

  const footerText = wrapPdfText(regular, `Pedido ${orderNumber(order)}`, 8, width - 24, 1)[0];
  if (footerText) {
    page.drawText(footerText, {
      x: x + width - 12 - regular.widthOfTextAtSize(footerText, 8),
      y: y + 10,
      size: 8,
      font: regular,
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
  // Shalom usa la hoja acostada: ancho y alto del A4 intercambiados.
  const shalomHeight = (A4_WIDTH - PAGE_MARGIN * 2 - CELL_GAP) / SHALOM_LABELS_PER_PAGE;
  const newPage = (landscape = false) => {
    const [pageWidth, pageHeight] = landscape ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PAPER });
    return page;
  };

  // Shalom va en su propia hoja de 2; el resto de pedidos manuales sigue en la hoja de 4.
  const shalom = [];
  const regular = [];
  for (const order of orders) {
    const label = shalomLabelData(order);
    if (label) shalom.push({ order, label });
    else regular.push(order);
  }

  let page = null;
  regular.forEach((order, index) => {
    const slot = index % LABELS_PER_PAGE;
    if (slot === 0) page = newPage();
    const column = slot % 2;
    const row = Math.floor(slot / 2);
    drawManualLabel(page, fonts, order, {
      x: PAGE_MARGIN + column * (cellWidth + CELL_GAP),
      y: A4_HEIGHT - PAGE_MARGIN - (row + 1) * cellHeight - row * CELL_GAP,
      width: cellWidth,
      height: cellHeight,
    });
  });

  shalom.forEach(({ order, label }, index) => {
    const slot = index % SHALOM_LABELS_PER_PAGE;
    if (slot === 0) page = newPage(true);
    drawShalomLabel(page, fonts, order, label, {
      x: PAGE_MARGIN,
      y: A4_WIDTH - PAGE_MARGIN - (slot + 1) * shalomHeight - slot * CELL_GAP,
      width: A4_HEIGHT - PAGE_MARGIN * 2,
      height: shalomHeight,
    });
  });

  return pdf.save();
}
