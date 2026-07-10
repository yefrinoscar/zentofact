import puppeteer, { Browser } from 'puppeteer';
import { generateQRDataUrl, buildQRString } from '../utils/qr-generator';
import { numeroALetras } from '../utils/number-to-words';

export type PdfFormat = 'A4' | 'A5' | '80mm' | '50mm' | 'ticket';

const FORMAT_DIMS: Record<PdfFormat, { width: string; height: string }> = {
  'A4':     { width: '210mm', height: '297mm' },
  'A5':     { width: '148mm', height: '210mm' },
  '80mm':   { width: '80mm',  height: '297mm' },
  '50mm':   { width: '50mm',  height: '150mm' },
  'ticket': { width: '50mm',  height: '150mm' },
};

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return _browser;
}

export interface PdfBoletaData {
  company: {
    ruc: string;
    razonSocial: string;
    nombreComercial?: string;
    direccion: string;
    ubigeo: string;
  };
  branch: {
    codigo: string;
    nombre: string;
    direccion: string;
  };
  client: {
    tipoDocumento: string;
    numeroDocumento: string;
    razonSocial: string;
    direccion?: string;
  };
  serie: string;
  correlativo: string;
  numeroCompleto: string;
  fechaEmision: string;
  moneda: string;
  detalles: Array<{
    codigo: string;
    descripcion: string;
    unidad: string;
    cantidad: number;
    mto_valor_unitario: number;
    tip_afe_igv: string;
    porcentaje_igv: number;
  }>;
  mtoOperGravadas: string;
  mtoOperExoneradas: string;
  mtoOperInafectas: string;
  mtoOperGratuitas: string;
  mtoIgv: string;
  mtoIgvGratuitas: string;
  mtoIsc: string;
  mtoIcbper: string;
  totalImpuestos: string;
  subTotal: string;
  mtoImpVenta: string;
  codigoHash?: string;
  logoPath?: string;
  documentTypeCode?: string;
  documentTitle?: string;
  printDocumentLabel?: string;
  observations?: Array<{
    label: string;
    value: string;
  }>;
}

export async function generateBoletaPreviewHtml(data: PdfBoletaData, format: PdfFormat): Promise<string> {
  const isTicket = format === '80mm' || format === '50mm' || format === 'ticket';

  const qrString = buildQRString({
    ruc: data.company.ruc,
    tipoDocumento: data.documentTypeCode || '03',
    serie: data.serie,
    correlativo: data.correlativo,
    mtoIgv: data.mtoIgv,
    mtoImpVenta: data.mtoImpVenta,
    fechaEmision: data.fechaEmision,
    tipoDocCliente: data.client.tipoDocumento,
    numDocCliente: data.client.numeroDocumento,
  });
  const qrImage = await generateQRDataUrl(qrString);
  const montoLetras = numeroALetras(parseFloat(data.mtoImpVenta));

  return buildHtml(data, qrImage, montoLetras, isTicket);
}

export async function generateBoletaPdf(data: PdfBoletaData, format: PdfFormat): Promise<Buffer> {
  const html = await generateBoletaPreviewHtml(data, format);

  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });

  const dims = FORMAT_DIMS[format];
  const pdf = await page.pdf({
    width: dims.width,
    height: dims.height,
    printBackground: true,
    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
  });

  await page.close();
  return Buffer.from(pdf);
}

function buildHtml(data: PdfBoletaData, qrImage: string, montoLetras: string, compact: boolean): string {
  if (compact) return buildTicketHtml(data, qrImage, montoLetras);

  const s = style();
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${s}</style></head><body>
  <div class="page a4">
    ${buildHeader(data)}
    ${buildSectionBar()}
    ${buildClient(data)}
    ${buildTable(data)}
    ${buildBottom(data, qrImage, montoLetras)}
  </div>
</body></html>`;
}

function style(): string {
  return `
*{margin:0;padding:0;box-sizing:border-box}
@page{margin:0}
html,body{width:210mm;min-height:297mm;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;padding:8.4mm 3.2mm 3.2mm 3.2mm;background:#fff}
.b{font-weight:700}
.r{text-align:right}
.c{text-align:center}

.header{height:38.6mm;display:grid;grid-template-columns:1fr 84mm;column-gap:8mm;align-items:start}
.brand{padding:3.2mm 0 0 7mm}
.brand-identity{display:inline-flex;flex-direction:column;align-items:center;max-width:78mm}
.brand-row{min-height:17mm;display:flex;align-items:center;justify-content:center;gap:3mm}
.brand-logo img{max-width:57mm;max-height:16mm;display:block}
.brand-fallback{display:flex;align-items:center;gap:2.8mm;min-width:0}
.brand-emblem{width:13.4mm;height:13.4mm;border-radius:2.3mm;background:#004a86;color:#fff;font-size:26px;font-weight:900;line-height:13.4mm;text-align:center;font-style:italic}
.brand-name{font-size:16.5px;line-height:1.02;font-weight:900;color:#004a86;white-space:normal;max-width:64mm}
.brand-legal{font-size:7.4px;line-height:1.1;color:#004a86;font-weight:700;margin-left:1mm;max-width:48mm}
.brand-address{margin-top:2.2mm;text-align:center;font-size:7.6px;line-height:1.25;color:#004a86;font-weight:700;max-width:78mm}

.doc-box{height:35.8mm;border:2px solid #000;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6.2mm;font-weight:800;text-align:center}
.doc-ruc{font-size:16.4px}
.doc-title{font-size:18px;text-transform:uppercase}
.doc-number{font-size:17px}

.section-bar{height:5.6mm;display:grid;grid-template-columns:60% 40%;background:#004a86;color:#fff;font-size:9px;font-weight:800;text-align:center;align-items:center;text-transform:uppercase}

.client{height:31.2mm;display:grid;grid-template-columns:64% 36%;font-size:7.6px;line-height:1.22;border-left:1px solid transparent;border-right:1px solid transparent}
.client-left{padding:2.2mm 0 0 2mm}
.client-right{padding:2.2mm 0 0 2mm}
.client-row{display:grid;grid-template-columns:28mm 3mm 1fr;min-height:7.2mm;align-items:start}
.client-right .client-row{grid-template-columns:21mm 3mm 1fr}
.client-label{font-weight:800}

.items{width:100%;border-collapse:collapse;table-layout:fixed;font-size:7.2px}
.items col.code{width:15%}
.items col.desc{width:43.5%}
.items col.um{width:5.2%}
.items col.qty{width:6.8%}
.items col.value{width:9%}
.items col.price{width:10.5%}
.items col.total{width:10%}
.items th{height:4.8mm;border:1px solid #000;background:#d8d8d8;font-size:7px;font-weight:800;text-align:center;vertical-align:middle;padding:0 .8mm;line-height:1.05}
.items td{border-left:1px solid #000;border-right:1px solid #000;border-top:0;border-bottom:0;font-size:7.1px;line-height:1.1;vertical-align:top;padding:.6mm .9mm}
.items tbody tr.item-row{height:4.4mm}
.items tbody tr.filler-row td{height:auto}
.items tbody tr.last-line td{height:0;border-top:1px solid #000;padding:0}

.bottom{position:relative;height:61mm}
.monto-letras{position:absolute;left:0;top:9.5mm;font-size:7.3px;font-weight:800;text-transform:uppercase}
.print-note{position:absolute;left:5mm;top:38.5mm;width:61mm;font-size:6px;line-height:1.25;text-align:center}
.qr{position:absolute;left:70.5mm;top:18.8mm;width:33mm;height:33mm}
.totals-box{position:absolute;right:1.2mm;top:16mm;width:98mm;border:2px solid #000;border-radius:7px;overflow:hidden}
.totals-box table{width:100%;border-collapse:collapse;font-size:7.4px;font-weight:800}
.totals-box td{height:5.15mm;padding:0 2.3mm;vertical-align:middle}
.totals-box td.currency{width:12mm;text-align:center;border-left:1px solid #000}
.totals-box td.amount{width:31mm;text-align:right}
`;
}

function buildHeader(data: PdfBoletaData): string {
  let logoHtml = '';
  if (data.logoPath) {
    const imgTag = fsImg(data.logoPath);
    if (imgTag) logoHtml = `<div class="brand-logo">${imgTag}</div>`;
  }
  const displayName = data.company.nombreComercial?.trim() || data.company.razonSocial;
  const documentTitle = data.documentTitle || 'BOLETA ELECTRÓNICA';
  const legalName = data.company.nombreComercial?.trim()
    ? `<div class="brand-legal">${esc(data.company.razonSocial)}</div>` : '';
  const fallback = `<div class="brand-fallback">
      <div class="brand-emblem">${esc(initial(displayName))}</div>
      <div>
        <div class="brand-name">${esc(displayName)}</div>
        ${legalName}
      </div>
    </div>`;

  return `<div class="header">
    <div class="brand"><div class="brand-identity">
      <div class="brand-row">${logoHtml || fallback}</div>
      <div class="brand-address">${esc(data.company.direccion || data.branch.direccion || '')}</div>
    </div></div>
    <div class="doc-box">
      <div class="doc-ruc">R.U.C. N&deg; ${esc(data.company.ruc)}</div>
      <div class="doc-title">${esc(documentTitle)}</div>
      <div class="doc-number">N&deg; ${esc(data.serie)}-${esc(data.correlativo)}</div>
    </div>
  </div>`;
}

function buildSectionBar(): string {
  return `<div class="section-bar">
    <div>INFORMACI&Oacute;N DEL CLIENTE</div>
    <div>OBSERVACIONES</div>
  </div>`;
}

function buildClient(data: PdfBoletaData): string {
  const docLabel = doctype(data.client.tipoDocumento);
  const date = formatDate(data.fechaEmision);
  const observations = data.observations?.length
    ? data.observations
    : [{ label: 'Periodo', value: date }];
  return `<div class="client">
    <div class="client-left">
      ${clientRow('Se&ntilde;or(es)', data.client.razonSocial)}
      ${clientRow('Direcci&oacute;n', data.client.direccion || '')}
      ${clientRow(docLabel, data.client.numeroDocumento)}
      ${clientRow('Fecha Emisi&oacute;n', date)}
    </div>
    <div class="client-right">
      ${observations.map((obs) => clientRow(obs.label, obs.value)).join('')}
    </div>
  </div>`;
}

function clientRow(label: string, value: string): string {
  return `<div class="client-row">
    <div class="client-label">${label}</div>
    <div>:</div>
    <div>${esc(value)}</div>
  </div>`;
}

function buildTable(data: PdfBoletaData): string {
  const rows = data.detalles.map(d => {
    const value = num(d.mto_valor_unitario);
    const quantity = num(d.cantidad);
    const total = quantity * value;
    const price = priceWithTax(d);
    return `<tr class="item-row">
      <td>${esc(d.codigo)}</td>
      <td>${esc(d.descripcion)}</td>
      <td>${esc(d.unidad)}</td>
      <td class="c">${formatQty(quantity)}</td>
      <td class="r">${formatUnit(value)}</td>
      <td class="r">${formatUnit(price)}</td>
      <td class="r">${formatMoney(total)}</td>
    </tr>`;
  }).join('');
  const fillerHeight = Math.max(45, 136.3 - data.detalles.length * 4.4);

  return `<table class="items">
    <colgroup>
      <col class="code"><col class="desc"><col class="um"><col class="qty"><col class="value"><col class="price"><col class="total">
    </colgroup>
    <thead><tr>
      <th>CODIGO</th>
      <th>DESCRIPCI&Oacute;N DEL PRODUCTO</th>
      <th>U.M.</th>
      <th>CANT.</th>
      <th>VALOR UNIT.</th>
      <th>PRECIO UNIT.</th>
      <th>VALOR VENTA</th>
    </tr></thead>
    <tbody>
      ${rows}
      <tr class="filler-row"><td style="height:${fillerHeight.toFixed(1)}mm"></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr class="last-line"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
    </tbody>
  </table>`;
}

function buildBottom(data: PdfBoletaData, qrImage: string, montoLetras: string): string {
  const printDocumentLabel = data.printDocumentLabel || 'BOLETA ELECTRÓNICA';
  return `<div class="bottom">
    <div class="monto-letras">${esc(formatMontoLetras(montoLetras))}</div>
    <div class="print-note">
      <div>Representaci&oacute;n Impresa de ${esc(printDocumentLabel)}.</div>
      <div>Esta puede ser consultada en www.sunat.gob.pe</div>
    </div>
    <img class="qr" src="${qrImage}" alt="QR" />
    ${buildTotals(data)}
  </div>`;
}

function buildTotals(data: PdfBoletaData): string {
  return `<div class="totals-box">
    <table>
      ${totalRow('OP. GRAVADA', data.mtoOperGravadas)}
      ${totalRow('OP. INAFECTA', data.mtoOperInafectas)}
      ${totalRow('OP. EXONERADA', data.mtoOperExoneradas)}
      ${totalRow('OP. GRATUITA', data.mtoOperGratuitas)}
      ${totalRow('IGV(18%)', data.mtoIgv)}
      ${totalRow('IMPORTE TOTAL', data.mtoImpVenta)}
    </table>
  </div>`;
}

function totalRow(label: string, value: string): string {
  return `<tr>
    <td>${label}</td>
    <td class="currency">S/</td>
    <td class="amount">${formatMoney(value)}</td>
  </tr>`;
}

function buildTicketHtml(data: PdfBoletaData, qrImage: string, montoLetras: string): string {
  const rows = data.detalles.map(d => {
    const value = num(d.mto_valor_unitario);
    const quantity = num(d.cantidad);
    return `<tr>
      <td>${esc(d.descripcion)}<br><span>${esc(d.codigo)} / ${esc(d.unidad)}</span></td>
      <td class="r">${formatQty(quantity)}</td>
      <td class="r">${formatMoney(quantity * value)}</td>
    </tr>`;
  }).join('');
  const hashLine = data.codigoHash
    ? `<div>Hash: ${esc(data.codigoHash)}</div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${ticketStyle()}</style></head><body>
  <div class="ticket">
    <div class="center b company">${esc(data.company.nombreComercial || data.company.razonSocial)}</div>
    <div class="center small">${esc(data.company.razonSocial)}</div>
    <div class="center small">${esc(data.company.direccion)}</div>
    <div class="center box">
      <div>R.U.C. N&deg; ${esc(data.company.ruc)}</div>
      <div>BOLETA ELECTR&Oacute;NICA</div>
      <div>N&deg; ${esc(data.serie)}-${esc(data.correlativo)}</div>
    </div>
    <div class="line"></div>
    <div><b>Cliente:</b> ${esc(data.client.razonSocial)}</div>
    <div><b>${doctype(data.client.tipoDocumento)}:</b> ${esc(data.client.numeroDocumento)}</div>
    <div><b>Fecha:</b> ${formatDate(data.fechaEmision)}</div>
    <table><thead><tr><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="line"></div>
    ${ticketTotal('OP. GRAVADA', data.mtoOperGravadas)}
    ${ticketTotal('OP. INAFECTA', data.mtoOperInafectas)}
    ${ticketTotal('OP. EXONERADA', data.mtoOperExoneradas)}
    ${ticketTotal('IGV(18%)', data.mtoIgv)}
    ${ticketTotal('TOTAL', data.mtoImpVenta, true)}
    <div class="letters">${esc(formatMontoLetras(montoLetras))}</div>
    <img class="qr" src="${qrImage}" alt="QR" />
    <div class="center tiny">Representaci&oacute;n impresa de BOLETA ELECTR&Oacute;NICA.</div>
    <div class="center tiny">www.sunat.gob.pe</div>
    <div class="tiny">${hashLine}</div>
  </div>
</body></html>`;
}

function ticketStyle(): string {
  return `
*{margin:0;padding:0;box-sizing:border-box}
@page{margin:0}
body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;font-size:7px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ticket{width:100%;padding:2mm 1.7mm}
.center{text-align:center}
.r{text-align:right}
.b{font-weight:800}
.company{font-size:9px;margin-bottom:1mm}
.small{font-size:6.4px;line-height:1.2}
.tiny{font-size:5.5px;line-height:1.2}
.box{border:1px solid #000;margin:2mm 0;padding:1.5mm;font-weight:800;font-size:7.6px;line-height:1.35}
.line{border-top:1px solid #000;margin:1.5mm 0}
table{width:100%;border-collapse:collapse;margin:1.5mm 0}
th,td{font-size:6.3px;border-bottom:.5px solid #000;padding:.8mm .3mm;vertical-align:top}
td span{font-size:5.6px}
.total{font-weight:800;font-size:7.4px}
.total-row{display:flex;justify-content:space-between;margin:.8mm 0}
.letters{font-size:6px;font-weight:800;text-transform:uppercase;margin:2mm 0}
.qr{display:block;width:24mm;height:24mm;margin:1mm auto}
`;
}

function ticketTotal(label: string, value: string, strong = false): string {
  return `<div class="total-row${strong ? ' total' : ''}"><span>${label}</span><span>S/ ${formatMoney(value)}</span></div>`;
}

function doctype(tipo: string): string {
  const map: Record<string, string> = { '1': 'D.N.I', '4': 'C.E.', '6': 'R.U.C', '7': 'Pasaporte', '0': 'Sin Doc' };
  return map[tipo] || 'Doc.';
}

function fsImg(path: string): string {
  try {
    const fs = require('fs');
    const base64 = fs.readFileSync(path, { encoding: 'base64' });
    const ext = path.split('.').pop()?.toLowerCase() || 'png';
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    return `<img src="data:${mime};base64,${base64}" />`;
  } catch {
    return '';
  }
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initial(value: string): string {
  const clean = value.trim();
  return clean ? clean[0].toUpperCase() : 'B';
}

function num(value: string | number | undefined | null): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: string | number): string {
  return num(value).toFixed(2);
}

function formatUnit(value: string | number): string {
  const fixed = num(value).toFixed(2);
  return fixed.endsWith('0') ? fixed.replace(/0$/, '') : fixed;
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function priceWithTax(detail: PdfBoletaData['detalles'][number]): number {
  const value = num(detail.mto_valor_unitario);
  if (detail.tip_afe_igv !== '10') return value;
  return value * (1 + num(detail.porcentaje_igv) / 100);
}

function formatDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getFullYear()),
  ].join('/');
}

function formatMontoLetras(value: string): string {
  return `${value.replace(/\s+con\s+/i, ' Y ').toUpperCase()} SOLES.`;
}
