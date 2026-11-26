/** Reparto que pide etiqueta impresa para dejar el paquete en la agencia. */
export const SHALOM_CARRIER = 'shaloom';

/** Dos etiquetas, una abajo de otra, por hoja A4 horizontal; igual que la hoja Shalom de la bandeja. */
export const SHALOM_LABELS_PER_PAGE = 2;

export type ShalomLabel = {
  name: string;
  dni: string;
  phone: string;
  /** Agencia de destino: ciudad / distrito / dirección de la sede Shalom. */
  sede: string;
};

/** Campos que el vendedor tocó; los que faltan se toman del cliente. */
export type ShalomLabelDraft = Partial<ShalomLabel>;

export function resolveShalomLabel(
  draft: ShalomLabelDraft,
  customer: { name?: string; phone?: string; dni?: string },
): ShalomLabel {
  return {
    name: draft.name ?? customer.name ?? '',
    dni: draft.dni ?? customer.dni ?? '',
    phone: draft.phone ?? customer.phone ?? '',
    sede: draft.sede ?? '',
  };
}

/** Lo mínimo para que la agencia entregue: nombre, DNI, celular y sede. */
export function missingShalomLabelFields(label: ShalomLabel) {
  const missing: string[] = [];
  if (!label.name.trim()) missing.push('nombre');
  if (!/^\d{8}$/.test(label.dni.trim())) missing.push('DNI');
  if (!label.phone.trim()) missing.push('celular');
  if (!label.sede.trim()) missing.push('sede');
  return missing;
}

export function shalomLabelError(label: ShalomLabel) {
  const missing = missingShalomLabelFields(label);
  return missing.length ? `Completa la etiqueta Shalom: falta ${missing.join(', ')}.` : null;
}

/** Lo que se guarda en `shipping.shalom` del pedido para reimprimir desde la bandeja. */
export function shalomShippingPayload(label: ShalomLabel): ShalomLabel {
  return {
    name: label.name.trim(),
    dni: label.dni.trim(),
    phone: label.phone.trim(),
    sede: label.sede.trim(),
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Textos largos bajan de tamaño para quedarse en una línea, como en la plantilla de Excel. */
function valueSize(value: string) {
  const length = value.trim().length;
  if (length <= 32) return 8.5;
  if (length <= 44) return 7;
  if (length <= 60) return 5.6;
  return 4.8;
}

export type PrintableShalomLabel = ShalomLabel & { orderNumber?: string };

function labelCell(label: PrintableShalomLabel) {
  const rows: Array<[string, string]> = [
    ['NOMBRE', label.name.trim().toUpperCase()],
    ['DNI', label.dni.trim()],
    ['CELULAR', label.phone.trim()],
    ['SEDE', label.sede.trim()],
  ];
  const body = rows
    .map(([key, value]) => `<tr><th>${key}</th><td style="font-size:${valueSize(value)}mm">${escapeHtml(value)}</td></tr>`)
    .join('');
  const order = label.orderNumber ? `<p class="order">Pedido ${escapeHtml(label.orderNumber)}</p>` : '';
  return `<section class="cell"><table>${body}</table>${order}</section>`;
}

/** Hoja A4 horizontal con 2 etiquetas, una abajo de otra: cada una con su borde y el formato de la plantilla de Excel. */
export function shalomLabelSheetHtml(labels: PrintableShalomLabel[]) {
  const pages: string[] = [];
  for (let start = 0; start < labels.length; start += SHALOM_LABELS_PER_PAGE) {
    const cells = labels.slice(start, start + SHALOM_LABELS_PER_PAGE).map(labelCell).join('');
    pages.push(`<main class="page">${cells}</main>`);
  }
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Etiquetas Shalom</title>
<style>
  @page { size: A4 landscape; margin: 5mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body { font-family: Impact, "Haettenschweiler", "Arial Narrow Bold", "Arial Narrow", sans-serif; }
  .page {
    width: 287mm; height: 200mm;
    display: grid; grid-template-rows: 1fr 1fr; gap: 5mm;
    page-break-after: always; break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .cell {
    position: relative; display: flex; align-items: center; justify-content: center;
    min-width: 0; min-height: 0; padding: 5mm 12mm; border: .5mm solid #000;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 1.2mm 2mm; vertical-align: middle; text-align: center; line-height: 1.1; font-weight: 400; }
  th { width: 26%; font-size: 6.5mm; }
  td { overflow-wrap: anywhere; }
  .order { position: absolute; right: 4mm; bottom: 3mm; margin: 0; font: 600 3mm/1 Arial, sans-serif; color: #555; }
</style></head>
<body>${pages.join('')}</body></html>`;
}

/** Imprime desde un iframe oculto: no abre pestañas ni choca con bloqueadores de pop-ups. */
export function printShalomLabels(labels: PrintableShalomLabel[]) {
  if (!labels.length) return false;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return false;
  }
  doc.open();
  doc.write(shalomLabelSheetHtml(labels));
  doc.close();
  win.addEventListener('afterprint', () => window.setTimeout(() => frame.remove(), 1000), { once: true });
  // Respaldo por si el navegador no emite afterprint.
  window.setTimeout(() => frame.remove(), 60_000);
  win.focus();
  win.print();
  return true;
}
