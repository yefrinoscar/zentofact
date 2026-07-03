import { ipcMain } from 'electron';
import { homedir } from 'os';
import { isAbsolute, join } from 'path';
import {
  createFactura,
  sendFacturaToSunat,
  generateAcceptedFacturaPdf,
  generateAcceptedFacturaPdfBase64,
  generateAcceptedFacturaPreviewHtml,
  generatePreviewFacturaHtmlForVenta,
  listFacturas,
} from '@zentofact/core';
import type { FacturaFilter } from '@zentofact/core';

function normalizeOutputDir(outputDir?: string) {
  const fallbackDir = join(homedir(), 'boletas-emitidas');
  if (!outputDir?.trim()) return fallbackDir;
  return isAbsolute(outputDir) ? outputDir : join(homedir(), outputDir.replace(/^\.?[\\/]+/, ''));
}

export function registerFacturaHandlers() {
  ipcMain.handle('facturas:list', async (_e, filter: FacturaFilter) => {
    return listFacturas(filter);
  });

  ipcMain.handle('facturas:create', async (_e, input: any) => {
    return createFactura(input);
  });

  ipcMain.handle('facturas:send', async (_e, id: number) => {
    return sendFacturaToSunat(id);
  });

  ipcMain.handle('facturas:generate-pdf', async (_e, id: number, outputDir?: string) => {
    return generateAcceptedFacturaPdf(id, normalizeOutputDir(outputDir), 'A4');
  });

  ipcMain.handle('facturas:preview-html', async (_e, companyId: number, venta: any) => {
    return generatePreviewFacturaHtmlForVenta(companyId, venta, 'A4');
  });

  ipcMain.handle('facturas:preview-accepted-html', async (_e, id: number) => {
    return generateAcceptedFacturaPreviewHtml(id, 'A4');
  });
}
