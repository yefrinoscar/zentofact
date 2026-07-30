import { PDFDocument, rgb } from 'pdf-lib';

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
export const LABELS_PER_PAGE = 4;

const PAGE_MARGIN = 12;
const CELL_PADDING = 8;
const MAX_LABELS = 500;
const LABEL_TIMEOUT_MS = 45_000;
const LABEL_WIDTH_RATIO = 0.445;
const LABEL_HEIGHT_RATIO = 0.495;

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

export async function composeA4ShippingLabelSheet(pdfBuffers, selectedLabelIndexes = []) {
  if (!Array.isArray(pdfBuffers) || pdfBuffers.length === 0) {
    throw new Error('Selecciona al menos una etiqueta para imprimir.');
  }

  const output = await PDFDocument.create();
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

    for (const label of labels) {
      const slot = outputIndex % LABELS_PER_PAGE;
      const page = slot === 0 ? output.addPage([A4_WIDTH, A4_HEIGHT]) : output.getPages().at(-1);
      if (slot === 0) {
        page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT, color: rgb(1, 1, 1) });
      }
      const maxWidth = cellWidth - CELL_PADDING * 2;
      const maxHeight = cellHeight - CELL_PADDING * 2;
      const scale = Math.min(maxWidth / label.width, maxHeight / label.height);
      const width = label.width * scale;
      const height = label.height * scale;
      const column = slot % 2;
      const row = Math.floor(slot / 2);
      const cellX = PAGE_MARGIN + column * cellWidth;
      const cellY = A4_HEIGHT - PAGE_MARGIN - (row + 1) * cellHeight;

      page.drawPage(label, {
        x: cellX + (cellWidth - width) / 2,
        y: cellY + (cellHeight - height) / 2,
        width,
        height,
      });

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

export async function buildA4ShippingLabelSheet(orders, getShippingLabel) {
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new Error('Selecciona al menos una etiqueta para imprimir.');
  }
  if (orders.length > MAX_LABELS) {
    throw new Error(`Puedes imprimir hasta ${MAX_LABELS} etiquetas por vez.`);
  }

  const uniqueOrders = [];
  const seen = new Set();
  for (const value of orders) {
    const companyId = Number(value?.companyId);
    const orderId = String(value?.orderId || '').trim();
    const orderNumber = String(value?.orderNumber || orderId).trim();
    if (!Number.isInteger(companyId) || companyId <= 0 || !orderId) {
      throw new Error('La selección contiene un pedido inválido.');
    }
    const key = `${companyId}:${orderId}`;
    if (!seen.has(key)) {
      seen.add(key);
      const labelIndex = Number(value?.labelIndex);
      uniqueOrders.push({
        companyId,
        orderId,
        orderNumber,
        labelIndexes: Number.isInteger(labelIndex) && labelIndex > 0 ? new Set([labelIndex]) : null,
      });
    } else {
      const order = uniqueOrders.find((entry) => `${entry.companyId}:${entry.orderId}` === key);
      const labelIndex = Number(value?.labelIndex);
      if (!Number.isInteger(labelIndex) || labelIndex <= 0) order.labelIndexes = null;
      else if (order.labelIndexes) order.labelIndexes.add(labelIndex);
    }
  }

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
        const result = await withTimeout(
          getShippingLabel(order),
          `Falabella tardó demasiado en entregar la etiqueta de ${order.orderNumber}.`,
        );
        if (!result?.ok || !result?.base64) {
          const error = new Error(`No se pudo obtener la etiqueta de ${order.orderNumber}: ${result?.error || 'Falabella no devolvió el archivo.'}`);
          error.providerStatus = Number(result?.status || 0);
          throw error;
        }
        if (String(result.mimeType || 'application/pdf').toLowerCase() !== 'application/pdf') {
          throw new Error(`La etiqueta de ${order.orderNumber} no está disponible en formato PDF.`);
        }
        labels[index] = Buffer.from(String(result.base64).replace(/\s+/g, ''), 'base64');
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
  const pdf = await composeA4ShippingLabelSheet(labels, selectedIndexes);
  const labelCount = selectedIndexes.reduce((total, indexes) => total + indexes.length, 0);
  const pageCount = (await PDFDocument.load(pdf)).getPageCount();
  return {
    ok: true,
    mimeType: 'application/pdf',
    base64: Buffer.from(pdf).toString('base64'),
    filename: `etiquetas-a4-${new Date().toISOString().slice(0, 10)}.pdf`,
    orderCount: uniqueOrders.length,
    labelCount,
    pageCount,
    printedLabels,
  };
}
