import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
export const LABELS_PER_PAGE = 4;

const PAGE_MARGIN = 12;
const CELL_PADDING = 8;
const MAX_LABELS = 500;
const LABEL_TIMEOUT_MS = 45_000;
const LABEL_WIDTH_RATIO = 0.445;
const LABEL_HEIGHT_RATIO = 0.495;
const LABEL_REFERENCE_HEIGHT = 24;
const INVENTORY_MARGIN = 28;
const INVENTORY_HEADER_HEIGHT = 58;
const INVENTORY_FOOTER_HEIGHT = 20;
const INVENTORY_CARD_GAP = 12;
const INVENTORY_GRID_ROWS = 4;
const INVENTORY_ITEMS_PER_CARD = 3;
const IMAGE_TIMEOUT_MS = 8_000;
const INVENTORY_IMAGES_TOTAL_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const INVENTORY_COLORS = {
  ink: rgb(0.08, 0.08, 0.08),
  muted: rgb(0.38, 0.38, 0.38),
  line: rgb(0.72, 0.72, 0.72),
  soft: rgb(0.94, 0.94, 0.94),
  white: rgb(1, 1, 1),
};

export function shippingLabelCropBox(page) {
  const box = page.getCropBox();
  const shortSide = Math.min(box.width, box.height);
  const longSide = Math.max(box.width, box.height);
  const pageRatio = shortSide / longSide;
  const isFullSheet = pageRatio >= 0.69 && pageRatio <= 0.73;
  if (!isFullSheet) return undefined;
  return {
    left: box.x,
    bottom: box.y + box.height * (1 - LABEL_HEIGHT_RATIO),
    right: box.x + box.width * LABEL_WIDTH_RATIO,
    top: box.y + box.height,
  };
}

function withTimeout(promise, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(message);
        error.providerStatus = 504;
        reject(error);
      }, LABEL_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function isPrivateIp(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  if (!normalized) return true;
  if (isIP(normalized) === 4) {
    const parts = normalized.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || parts[0] >= 224;
  }
  if (isIP(normalized) === 6) {
    if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice(7));
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb')
      || normalized.startsWith('::ffff:127.')
      || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.');
  }
  return true;
}

async function validatePublicImageUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('La imagen debe usar HTTPS.');
  if (url.username || url.password) throw new Error('La URL de imagen no puede incluir credenciales.');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error('La imagen apunta a una red no permitida.');
  }
  return url;
}

function detectSupportedImageMime(bytes, declaredMime = '') {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const normalized = String(declaredMime || '').split(';')[0].trim().toLowerCase();
  return normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/jpg'
    ? normalized.replace('image/jpg', 'image/jpeg')
    : '';
}

async function fetchPublicProductImage(value) {
  let url = await validatePublicImageUrl(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        headers: { accept: 'image/png,image/jpeg;q=0.9,*/*;q=0.1' },
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (redirects === 3) throw new Error('La imagen tiene demasiadas redirecciones.');
      url = await validatePublicImageUrl(new URL(response.headers.get('location'), url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`No se pudo descargar la imagen (${response.status}).`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande.');
    if (!response.body) throw new Error('La imagen llegó vacía.');
    const chunks = [];
    let totalBytes = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error('La imagen es demasiado grande.');
      }
      chunks.push(chunk);
    }
    if (!totalBytes) throw new Error('La imagen llegó vacía.');
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const mimeType = detectSupportedImageMime(bytes, response.headers.get('content-type'));
    if (!mimeType) throw new Error('La imagen no está en formato PNG o JPEG.');
    return { bytes, mimeType };
  }
  throw new Error('No se pudo descargar la imagen.');
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
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines.at(-1);
    while (last && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) last = last.slice(0, -1).trimEnd();
    lines[lines.length - 1] = `${last || ''}...`;
  }
  return lines.map((line) => {
    if (font.widthOfTextAtSize(line, size) <= maxWidth) return line;
    let fitted = line;
    while (fitted && font.widthOfTextAtSize(`${fitted}...`, size) > maxWidth) fitted = fitted.slice(0, -1);
    return `${fitted || ''}...`;
  });
}

function formatQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return '1';
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function ticketCode(value) {
  const ticketNumber = Math.max(1, Math.floor(Number(value) || 1));
  const letterIndex = Math.floor((ticketNumber - 1) / 99);
  const number = ((ticketNumber - 1) % 99) + 1;
  return `${String.fromCharCode(65 + letterIndex)}${String(number).padStart(2, '0')}`;
}

export function inventoryForTicket(inventory, labelIndex, labelCount) {
  const items = Array.isArray(inventory?.items) ? inventory.items : [];
  const packageIds = [...new Set(items.map((item) => String(item?.packageId || '').trim()).filter(Boolean))];
  const hasCompletePackageMapping = items.length > 0
    && items.every((item) => String(item?.packageId || '').trim())
    && packageIds.length === Number(labelCount);
  if (!hasCompletePackageMapping || !packageIds[labelIndex - 1]) {
    return { ...inventory, items, packageMappingComplete: false, ticketPackageId: '' };
  }
  const ticketPackageId = packageIds[labelIndex - 1];
  return {
    ...inventory,
    items: items.filter((item) => String(item.packageId).trim() === ticketPackageId),
    packageMappingComplete: true,
    ticketPackageId,
  };
}

function inventoryItemImageUrls(item) {
  return [...new Set([
    item?.imageUrl,
    ...(Array.isArray(item?.imageUrls) ? item.imageUrls : []),
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

async function preloadInventoryImages(inventories, fetchProductImage) {
  const cache = new Map();
  const pending = [];
  for (const inventory of inventories) {
    for (const item of inventory?.items || []) {
      if (item?.imageBytes) continue;
      for (const imageUrl of inventoryItemImageUrls(item)) {
        if (!cache.has(imageUrl)) {
          cache.set(imageUrl, null);
          pending.push(imageUrl);
        }
      }
    }
  }
  let next = 0;
  const deadline = Date.now() + INVENTORY_IMAGES_TOTAL_TIMEOUT_MS;
  const workers = Math.min(8, pending.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < pending.length && Date.now() < deadline) {
      const imageUrl = pending[next];
      next += 1;
      let deadlineTimeout;
      try {
        const remaining = Math.max(1, deadline - Date.now());
        cache.set(imageUrl, await Promise.race([
          fetchProductImage(imageUrl),
          new Promise((_, reject) => {
            deadlineTimeout = setTimeout(() => reject(new Error('Tiempo agotado.')), remaining);
          }),
        ]));
      } catch {
        cache.set(imageUrl, null);
      } finally {
        clearTimeout(deadlineTimeout);
      }
    }
  }));
  return cache;
}

async function embedInventoryImage(pdf, item, remoteImages) {
  let asset = null;
  if (item?.imageBytes) {
    const bytes = item.imageBytes instanceof Uint8Array ? item.imageBytes : new Uint8Array(item.imageBytes);
    const mimeType = detectSupportedImageMime(bytes, item.imageMimeType);
    if (mimeType) asset = { bytes, mimeType };
  }
  if (!asset) {
    for (const imageUrl of inventoryItemImageUrls(item)) {
      asset = remoteImages.get(imageUrl) || null;
      if (asset) break;
    }
  }
  if (!asset) return null;
  try {
    return asset.mimeType === 'image/png' ? await pdf.embedPng(asset.bytes) : await pdf.embedJpg(asset.bytes);
  } catch {
    return null;
  }
}

function drawPickingPageHeader(page, fonts, cards, totalTickets, pageNumber, pageCount) {
  const { regular, bold } = fonts;
  const firstCode = cards[0]?.code || ticketCode(cards[0]?.ticketNumber);
  const lastCode = cards.at(-1)?.code || ticketCode(cards.at(-1)?.ticketNumber);
  page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT, color: INVENTORY_COLORS.white });
  page.drawLine({
    start: { x: INVENTORY_MARGIN, y: A4_HEIGHT - 28 },
    end: { x: INVENTORY_MARGIN + 28, y: A4_HEIGHT - 28 },
    thickness: 1.4,
    color: INVENTORY_COLORS.ink,
  });
  page.drawText('INVENTARIO DE PEDIDOS', {
    x: INVENTORY_MARGIN + 38,
    y: A4_HEIGHT - 31,
    size: 6.8,
    font: bold,
    color: INVENTORY_COLORS.muted,
  });
  page.drawText('GUÍA DE ARMADO', {
    x: INVENTORY_MARGIN,
    y: A4_HEIGHT - 57,
    size: 19,
    font: bold,
    color: INVENTORY_COLORS.ink,
  });
  page.drawText('El código coincide con el impreso debajo de cada etiqueta.', {
    x: INVENTORY_MARGIN,
    y: A4_HEIGHT - 70,
    size: 8.5,
    font: regular,
    color: INVENTORY_COLORS.muted,
  });
  const range = `CÓDIGOS ${firstCode}-${lastCode}  |  ${totalTickets} TICKETS`;
  page.drawText(range, {
    x: A4_WIDTH - INVENTORY_MARGIN - bold.widthOfTextAtSize(range, 8.5),
    y: A4_HEIGHT - 48,
    size: 8.5,
    font: bold,
    color: INVENTORY_COLORS.ink,
  });
  const pageText = `HOJA ${pageNumber} DE ${pageCount}`;
  page.drawText(pageText, {
    x: A4_WIDTH - INVENTORY_MARGIN - regular.widthOfTextAtSize(pageText, 7.5),
    y: A4_HEIGHT - 64,
    size: 7.5,
    font: regular,
    color: INVENTORY_COLORS.muted,
  });
}

async function drawCompactInventoryItem(page, pdf, fonts, item, itemIndex, bounds, remoteImages) {
  const { regular, bold } = fonts;
  const { x, y, width, height } = bounds;
  if (itemIndex > 0) {
    page.drawLine({
      start: { x: x + 10, y: y + height },
      end: { x: x + width - 10, y: y + height },
      thickness: 0.55,
      color: INVENTORY_COLORS.line,
    });
  }
  const imageSize = Math.min(52, height - 14);
  const imageX = x + 10;
  const imageY = y + (height - imageSize) / 2;
  page.drawRectangle({
    x: imageX,
    y: imageY,
    width: imageSize,
    height: imageSize,
    color: INVENTORY_COLORS.white,
    borderColor: INVENTORY_COLORS.line,
    borderWidth: 0.45,
  });
  const image = await embedInventoryImage(pdf, item, remoteImages);
  if (image) {
    const scale = Math.min(imageSize / image.width, imageSize / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: imageX + (imageSize - width) / 2,
      y: imageY + (imageSize - height) / 2,
      width,
      height,
    });
  } else {
    page.drawText('SIN FOTO', {
      x: imageX + 7,
      y: imageY + imageSize / 2 - 2,
      size: 6.5,
      font: bold,
      color: rgb(0.58, 0.55, 0.51),
    });
  }

  const textX = imageX + imageSize + 9;
  const quantityWidth = 42;
  const textWidth = width - (textX - x) - quantityWidth - 11;
  const description = item?.name || item?.description || item?.sellerSku || item?.sku || `Producto ${itemIndex + 1}`;
  wrapPdfText(bold, description, 8.2, textWidth, 3).forEach((line, lineIndex) => page.drawText(line, {
    x: textX,
    y: y + height - 19 - lineIndex * 10,
    size: 8.2,
    font: bold,
    color: INVENTORY_COLORS.ink,
  }));
  const sku = item?.sellerSku || item?.sku || item?.providerSku || 'Sin SKU';
  const skuLine = wrapPdfText(regular, `SKU ${sku}`, 7, textWidth, 1)[0] || 'SIN SKU';
  page.drawText(skuLine, {
    x: textX,
    y: y + 11,
    size: 7,
    font: regular,
    color: INVENTORY_COLORS.muted,
  });
  const quantity = formatQuantity(item?.quantity ?? 1);
  const quantityCenterX = x + width - 22;
  page.drawText('CANT.', {
    x: quantityCenterX - bold.widthOfTextAtSize('CANT.', 5.8) / 2,
    y: y + height - 17,
    size: 5.8,
    font: bold,
    color: INVENTORY_COLORS.muted,
  });
  page.drawEllipse({
    x: quantityCenterX,
    y: y + height / 2 - 6,
    xScale: 13,
    yScale: 13,
    color: INVENTORY_COLORS.white,
    borderColor: INVENTORY_COLORS.ink,
    borderWidth: 0.8,
  });
  page.drawText(safePdfText(bold, quantity), {
    x: quantityCenterX - bold.widthOfTextAtSize(quantity, 13) / 2,
    y: y + height / 2 - 10.5,
    size: 13,
    font: bold,
    color: INVENTORY_COLORS.ink,
  });
}

async function drawInventoryCard(page, pdf, fonts, card, bounds, remoteImages) {
  const { regular, bold } = fonts;
  const { x, y, width, height } = bounds;
  const inventory = card.inventory || {};
  const code = card.code || ticketCode(card.ticketNumber);
  const customer = inventory.customerName || 'Cliente no informado';
  const allItems = card.allItems || [];
  const totalUnits = allItems.reduce((total, item) => total + (Number(item?.quantity) || 0), 0);
  const compact = height < 250;
  const headerHeight = compact ? 42 : 60;
  const summaryHeight = compact ? 25 : 44;
  const footerHeight = compact ? 22 : 28;
  const contentHeight = height - headerHeight - summaryHeight - footerHeight;

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: INVENTORY_COLORS.white,
    borderColor: INVENTORY_COLORS.line,
    borderWidth: 0.9,
  });
  page.drawLine({
    start: { x, y: y + height - headerHeight },
    end: { x: x + width, y: y + height - headerHeight },
    thickness: 0.9,
    color: INVENTORY_COLORS.ink,
  });
  page.drawText('CÓDIGO', {
    x: x + (compact ? 10 : 13),
    y: y + height - (compact ? 13 : 18),
    size: compact ? 5.2 : 6.2,
    font: bold,
    color: INVENTORY_COLORS.muted,
  });
  page.drawText(code, {
    x: x + (compact ? 10 : 13),
    y: y + height - (compact ? 34 : 47),
    size: compact ? 18 : 25,
    font: bold,
    color: INVENTORY_COLORS.ink,
  });
  page.drawLine({
    start: { x: x + (compact ? 60 : 78), y: y + height - (compact ? 36 : 49) },
    end: { x: x + (compact ? 60 : 78), y: y + height - (compact ? 8 : 11) },
    thickness: 0.55,
    color: INVENTORY_COLORS.line,
  });
  const customerX = x + (compact ? 70 : 91);
  page.drawText('CLIENTE', {
    x: customerX,
    y: y + height - (compact ? 13 : 19),
    size: compact ? 5.2 : 6.5,
    font: bold,
    color: INVENTORY_COLORS.muted,
  });
  const customerSize = compact ? 7.2 : 8.3;
  const customerLines = wrapPdfText(regular, customer, customerSize, width - (compact ? 80 : 104), 2);
  customerLines.forEach((line, index) => page.drawText(line, {
    x: customerX,
    y: y + height - (compact ? 26 : 35) - index * (compact ? 8 : 10),
    size: customerSize,
    font: regular,
    color: INVENTORY_COLORS.ink,
  }));

  const summaryTop = y + height - headerHeight;
  const metrics = [
    { label: 'PRODUCTOS', value: String(allItems.length) },
    { label: 'UNIDADES', value: formatQuantity(totalUnits) },
    { label: 'BULTO', value: card.labelCount > 1 ? `${card.labelIndex}/${card.labelCount}` : '1/1' },
  ];
  const metricWidth = width / metrics.length;
  metrics.forEach((metric, index) => {
    const metricX = x + index * metricWidth;
    if (index > 0) {
      page.drawLine({
        start: { x: metricX, y: summaryTop - summaryHeight + 8 },
        end: { x: metricX, y: summaryTop - 8 },
        thickness: 0.45,
        color: INVENTORY_COLORS.line,
      });
    }
    page.drawText(metric.label, {
      x: metricX + (compact ? 9 : 12),
      y: summaryTop - (compact ? 10 : 15),
      size: compact ? 4.7 : 5.9,
      font: bold,
      color: INVENTORY_COLORS.muted,
    });
    page.drawText(metric.value, {
      x: metricX + (compact ? 9 : 12),
      y: summaryTop - (compact ? 21 : 34),
      size: compact ? 8.8 : 13,
      font: bold,
      color: INVENTORY_COLORS.ink,
    });
  });
  page.drawLine({
    start: { x, y: summaryTop - summaryHeight },
    end: { x: x + width, y: summaryTop - summaryHeight },
    thickness: 0.55,
    color: INVENTORY_COLORS.line,
  });

  const visibleRows = compact ? Math.max(1, card.items.length) : INVENTORY_ITEMS_PER_CARD;
  const rowHeight = contentHeight / visibleRows;
  const contentBottom = y + footerHeight;
  if (!card.items.length) {
    page.drawRectangle({
      x: x + 10,
      y: contentBottom + 18,
      width: width - 20,
      height: Math.max(42, contentHeight - 36),
      color: INVENTORY_COLORS.white,
      borderColor: INVENTORY_COLORS.line,
      borderWidth: 0.5,
    });
    page.drawText('SIN PRODUCTOS INFORMADOS', {
      x: x + 47,
      y: contentBottom + contentHeight / 2 + 4,
      size: 8.5,
      font: bold,
      color: INVENTORY_COLORS.muted,
    });
  } else {
    for (let index = 0; index < card.items.length; index += 1) {
      const rowY = contentBottom + contentHeight - (index + 1) * rowHeight;
      await drawCompactInventoryItem(
        page,
        pdf,
        fonts,
        card.items[index],
        index,
        { x, y: rowY, width, height: rowHeight },
        remoteImages,
      );
    }
  }

  const footerText = inventory.packageMappingComplete && inventory.ticketPackageId
    ? `PAQUETE ${inventory.ticketPackageId}`
    : card.labelCount > 1
      ? 'CONTENIDO COMPLETO DEL PEDIDO'
      : 'CONTENIDO DE ESTA ETIQUETA';
  page.drawLine({
    start: { x, y: y + footerHeight },
    end: { x: x + width, y: y + footerHeight },
    thickness: 0.55,
    color: INVENTORY_COLORS.line,
  });
  const footerAvailable = card.partCount > 1 ? width - 150 : width - 90;
  const footerSize = compact ? 5.5 : 6.5;
  page.drawText(wrapPdfText(bold, footerText, footerSize, footerAvailable, 1)[0] || '', {
    x: x + 10,
    y: y + (compact ? 8 : 10),
    size: footerSize,
    font: bold,
    color: INVENTORY_COLORS.muted,
  });
  if (card.partCount > 1) {
    const partText = `PARTE ${card.partIndex}/${card.partCount}`;
    page.drawText(partText, {
      x: x + width - 132,
      y: y + (compact ? 8 : 10),
      size: footerSize,
      font: bold,
      color: INVENTORY_COLORS.ink,
    });
  }
  page.drawRectangle({
    x: x + width - 72,
    y: y + (compact ? 7 : 9),
    width: compact ? 7 : 8,
    height: compact ? 7 : 8,
    color: INVENTORY_COLORS.white,
    borderColor: INVENTORY_COLORS.ink,
    borderWidth: 0.7,
  });
  page.drawText('REVISADO', {
    x: x + width - 59,
    y: y + (compact ? 8 : 10),
    size: compact ? 5.5 : 6.2,
    font: bold,
    color: INVENTORY_COLORS.muted,
  });
}

function paginateInventoryCards(cards) {
  const pages = [];
  let page = null;
  for (const card of cards) {
    const rowSpan = card.items.length <= 1 ? 1 : 2;
    let placement = null;
    while (!placement) {
      if (!page) {
        page = {
          occupied: Array.from({ length: INVENTORY_GRID_ROWS }, () => [false, false]),
          placements: [],
        };
        pages.push(page);
      }
      for (let row = 0; row <= INVENTORY_GRID_ROWS - rowSpan && !placement; row += 1) {
        for (let column = 0; column < 2 && !placement; column += 1) {
          const available = Array.from({ length: rowSpan }, (_, offset) => !page.occupied[row + offset][column]).every(Boolean);
          if (available) placement = { card, row, column, rowSpan };
        }
      }
      if (!placement) page = null;
    }
    for (let offset = 0; offset < placement.rowSpan; offset += 1) {
      page.occupied[placement.row + offset][placement.column] = true;
    }
    page.placements.push(placement);
  }
  return pages;
}

export async function appendTicketInventoryPages(pdf, ticketInventories, options = {}) {
  if (!Array.isArray(ticketInventories) || !ticketInventories.length) {
    return { inventoryPageCount: 0, inventoryTicketCount: 0 };
  }
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const remoteImages = await preloadInventoryImages(
    ticketInventories.map((entry) => entry.inventory),
    options.fetchProductImage || fetchPublicProductImage,
  );
  const cards = ticketInventories.flatMap((ticket) => {
    const inventory = ticket.inventory || {};
    const items = Array.isArray(inventory.items) ? inventory.items : [];
    const chunks = items.length
      ? Array.from({ length: Math.ceil(items.length / INVENTORY_ITEMS_PER_CARD) }, (_, index) => (
        items.slice(index * INVENTORY_ITEMS_PER_CARD, (index + 1) * INVENTORY_ITEMS_PER_CARD)
      ))
      : [[]];
    return chunks.map((chunk, index) => ({
      ...ticket,
      inventory,
      allItems: items,
      items: chunk,
      partIndex: index + 1,
      partCount: chunks.length,
    }));
  });

  const inventoryPages = paginateInventoryCards(cards);
  const inventoryPageCount = inventoryPages.length;
  const cardWidth = (A4_WIDTH - INVENTORY_MARGIN * 2 - INVENTORY_CARD_GAP) / 2;
  const gridRowHeight = (
    A4_HEIGHT
    - INVENTORY_MARGIN * 2
    - INVENTORY_HEADER_HEIGHT
    - INVENTORY_FOOTER_HEIGHT
    - INVENTORY_CARD_GAP * (INVENTORY_GRID_ROWS - 1)
  ) / INVENTORY_GRID_ROWS;

  for (let pageIndex = 0; pageIndex < inventoryPageCount; pageIndex += 1) {
    const placements = inventoryPages[pageIndex].placements;
    const pageCards = placements.map((placement) => placement.card);
    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    drawPickingPageHeader(
      page,
      { regular, bold },
      pageCards,
      ticketInventories.length,
      pageIndex + 1,
      inventoryPageCount,
    );
    for (const placement of placements) {
      const { column, row, rowSpan, card } = placement;
      const x = INVENTORY_MARGIN + column * (cardWidth + INVENTORY_CARD_GAP);
      const top = A4_HEIGHT - INVENTORY_MARGIN - INVENTORY_HEADER_HEIGHT - row * (gridRowHeight + INVENTORY_CARD_GAP);
      const cardHeight = gridRowHeight * rowSpan + INVENTORY_CARD_GAP * (rowSpan - 1);
      await drawInventoryCard(
        page,
        pdf,
        { regular, bold },
        card,
        { x, y: top - cardHeight, width: cardWidth, height: cardHeight },
        remoteImages,
      );
    }
  }
  return {
    inventoryPageCount,
    inventoryTicketCount: ticketInventories.length,
    inventoryCardCount: cards.length,
  };
}

export async function composeA4ShippingLabelSheet(pdfBuffers, selectedLabelIndexes = [], ticketReferences = []) {
  if (!Array.isArray(pdfBuffers) || pdfBuffers.length === 0) {
    throw new Error('Selecciona al menos una etiqueta para imprimir.');
  }

  const output = await PDFDocument.create();
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const cellWidth = (A4_WIDTH - PAGE_MARGIN * 2) / 2;
  const cellHeight = (A4_HEIGHT - PAGE_MARGIN * 2) / 2;

  let outputIndex = 0;
  for (let sourceIndex = 0; sourceIndex < pdfBuffers.length; sourceIndex += 1) {
    const pdfBuffer = pdfBuffers[sourceIndex];
    const source = await PDFDocument.load(pdfBuffer);
    const selected = selectedLabelIndexes[sourceIndex];
    const pages = Array.isArray(selected)
      ? selected.map((labelIndex) => source.getPage(labelIndex - 1))
      : source.getPages();
    const labels = await Promise.all(pages.map((page) => (
      output.embedPage(page, shippingLabelCropBox(page))
    )));

    for (let labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
      const label = labels[labelIndex];
      const reference = ticketReferences[sourceIndex]?.[labelIndex];
      const slot = outputIndex % LABELS_PER_PAGE;
      const page = slot === 0 ? output.addPage([A4_WIDTH, A4_HEIGHT]) : output.getPages().at(-1);
      if (slot === 0) {
        page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT, color: rgb(1, 1, 1) });
      }
      const maxWidth = cellWidth - CELL_PADDING * 2;
      const referenceHeight = reference ? LABEL_REFERENCE_HEIGHT : 0;
      const maxHeight = cellHeight - CELL_PADDING * 2 - referenceHeight;
      const scale = Math.min(maxWidth / label.width, maxHeight / label.height);
      const width = label.width * scale;
      const height = label.height * scale;
      const column = slot % 2;
      const row = Math.floor(slot / 2);
      const cellX = PAGE_MARGIN + column * cellWidth;
      const cellY = A4_HEIGHT - PAGE_MARGIN - (row + 1) * cellHeight;

      page.drawPage(label, {
        x: cellX + (cellWidth - width) / 2,
        y: cellY + referenceHeight + (cellHeight - referenceHeight - height) / 2,
        width,
        height,
      });

      if (reference) {
        const code = reference.code || ticketCode(reference.ticketNumber);
        const codeSize = 13;
        const codeWidth = bold.widthOfTextAtSize(code, codeSize);
        const codeX = cellX + (cellWidth - codeWidth) / 2;
        const codeY = cellY + 6;
        const lineY = codeY + 6;
        page.drawLine({
          start: { x: cellX + CELL_PADDING + 18, y: lineY },
          end: { x: codeX - 11, y: lineY },
          thickness: 0.65,
          color: INVENTORY_COLORS.line,
        });
        page.drawLine({
          start: { x: codeX + codeWidth + 11, y: lineY },
          end: { x: cellX + cellWidth - CELL_PADDING - 18, y: lineY },
          thickness: 0.65,
          color: INVENTORY_COLORS.line,
        });
        page.drawText(code, {
          x: codeX,
          y: codeY,
          size: codeSize,
          font: bold,
          color: INVENTORY_COLORS.ink,
        });
      }

      if (slot === 0) {
        const guideColor = rgb(0.82, 0.82, 0.82);
        page.drawLine({
          start: { x: A4_WIDTH / 2, y: PAGE_MARGIN },
          end: { x: A4_WIDTH / 2, y: A4_HEIGHT - PAGE_MARGIN },
          thickness: 0.5,
          color: guideColor,
          dashArray: [3, 3],
        });
        page.drawLine({
          start: { x: PAGE_MARGIN, y: A4_HEIGHT / 2 },
          end: { x: A4_WIDTH - PAGE_MARGIN, y: A4_HEIGHT / 2 },
          thickness: 0.5,
          color: guideColor,
          dashArray: [3, 3],
        });
      }
      outputIndex += 1;
    }
  }

  return output.save();
}

export async function buildA4ShippingLabelSheet(orders, getShippingLabel, getOrderInventory, options = {}) {
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new Error('Selecciona al menos una etiqueta para imprimir.');
  }
  if (orders.length > MAX_LABELS) {
    throw new Error(`Puedes imprimir hasta ${MAX_LABELS} etiquetas por vez.`);
  }

  const uniqueOrders = [];
  const seen = new Set();
  const sellerOrder = new Map();
  for (const value of orders) {
    const companyId = Number(value?.companyId);
    const orderId = String(value?.orderId || '').trim();
    const orderNumber = String(value?.orderNumber || orderId).trim();
    if (!Number.isInteger(companyId) || companyId <= 0 || !orderId) {
      throw new Error('La selección contiene un pedido inválido.');
    }
    const sellerKey = String(value?.sellerKey || `company:${companyId}`).trim().toLowerCase();
    if (!sellerOrder.has(sellerKey)) sellerOrder.set(sellerKey, sellerOrder.size);
    const key = `${companyId}:${orderId}`;
    if (!seen.has(key)) {
      seen.add(key);
      const labelIndex = Number(value?.labelIndex);
      uniqueOrders.push({
        companyId,
        orderId,
        orderNumber,
        sellerKey,
        labelIndexes: Number.isInteger(labelIndex) && labelIndex > 0 ? new Set([labelIndex]) : null,
      });
    } else {
      const order = uniqueOrders.find((entry) => `${entry.companyId}:${entry.orderId}` === key);
      const labelIndex = Number(value?.labelIndex);
      if (!Number.isInteger(labelIndex) || labelIndex <= 0) order.labelIndexes = null;
      else if (order.labelIndexes) order.labelIndexes.add(labelIndex);
    }
  }
  uniqueOrders.sort((left, right) => sellerOrder.get(left.sellerKey) - sellerOrder.get(right.sellerKey));

  const labels = new Array(uniqueOrders.length);
  const workerCount = Math.min(4, uniqueOrders.length);
  let nextIndex = 0;
  let stopped = false;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!stopped && nextIndex < uniqueOrders.length) {
      const index = nextIndex;
      nextIndex += 1;
      const order = uniqueOrders[index];
      try {
        const [result, inventory] = await Promise.all([
          withTimeout(
            getShippingLabel(order),
            `Falabella tardó demasiado en entregar la etiqueta de ${order.orderNumber}.`,
          ),
          getOrderInventory ? withTimeout(
            getOrderInventory(order),
            `Falabella tardó demasiado en entregar los productos de ${order.orderNumber}.`,
          ) : null,
        ]);
        if (!result?.ok || !result?.base64) {
          const error = new Error(`No se pudo obtener la etiqueta de ${order.orderNumber}: ${result?.error || 'Falabella no devolvió el archivo.'}`);
          error.providerStatus = Number(result?.status || 0);
          throw error;
        }
        if (String(result.mimeType || 'application/pdf').toLowerCase() !== 'application/pdf') {
          throw new Error(`La etiqueta de ${order.orderNumber} no está disponible en formato PDF.`);
        }
        labels[index] = Buffer.from(String(result.base64).replace(/\s+/g, ''), 'base64');
        if (getOrderInventory) {
          if (!inventory || inventory?.ok === false || inventory?.error) {
            const error = new Error(`No se pudo obtener el inventario de ${order.orderNumber}: ${inventory?.error || 'Falabella no devolvió los productos.'}`);
            error.providerStatus = Number(inventory?.status || 0);
            throw error;
          }
        }
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }));

  const pageCounts = await Promise.all(labels.map(async (label) => (
    await PDFDocument.load(label)
  ).getPageCount()));
  const printedLabels = uniqueOrders.map((order, index) => {
    const labelIndexes = order.labelIndexes
      ? [...order.labelIndexes].sort((left, right) => left - right)
      : Array.from({ length: pageCounts[index] }, (_, labelIndex) => labelIndex + 1);
    const invalidIndex = labelIndexes.find((labelIndex) => labelIndex > pageCounts[index]);
    if (invalidIndex) {
      throw new Error(`La etiqueta ${invalidIndex} de ${order.orderNumber} no existe en el documento de Falabella.`);
    }
    return {
      companyId: order.companyId,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      labelIndexes,
    };
  });
  const selectedIndexes = printedLabels.map((entry) => entry.labelIndexes);
  const labelCount = selectedIndexes.reduce((total, indexes) => total + indexes.length, 0);
  // La guía de armado y sus códigos se conservan disponibles en este módulo,
  // pero la impresión operativa entrega únicamente las etiquetas de Falabella.
  const pdf = await composeA4ShippingLabelSheet(labels, selectedIndexes);
  const pageCount = (await PDFDocument.load(pdf)).getPageCount();
  const labelPageCount = Math.ceil(labelCount / LABELS_PER_PAGE);
  return {
    ok: true,
    mimeType: 'application/pdf',
    base64: Buffer.from(pdf).toString('base64'),
    filename: `etiquetas-a4-${new Date().toISOString().slice(0, 10)}.pdf`,
    orderCount: uniqueOrders.length,
    labelCount,
    labelPageCount,
    inventoryPageCount: 0,
    inventoryTicketCount: 0,
    inventoryCardCount: 0,
    inventoryIncluded: false,
    pageCount,
    printedLabels,
  };
}
