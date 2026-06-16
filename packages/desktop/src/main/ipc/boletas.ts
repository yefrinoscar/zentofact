import { ipcMain } from 'electron';
import { homedir } from 'os';
import { isAbsolute, join } from 'path';
import { generateAcceptedBoletaPdf, generateDailySummaryPdfs, generatePreviewBoletaHtmlForVenta, generatePreviewCreditNoteHtml, listBoletas, listFacturas, listCreditNotes, listDailySummaries, refreshDailySummaryStatus } from '@boletas/core';
import type { BoletaFilter, FacturaFilter, CreditNoteFilter, DailySummaryFilter } from '@boletas/core';

function normalizeOutputDir(outputDir?: string) {
  const fallbackDir = join(homedir(), 'boletas-emitidas');

  if (!outputDir?.trim()) {
    return fallbackDir;
  }

  return isAbsolute(outputDir) ? outputDir : join(homedir(), outputDir.replace(/^\.?[\\/]+/, ''));
}

export function registerBoletaHandlers() {
  ipcMain.handle('boletas:list', async (_e, filter: BoletaFilter) => {
    return listBoletas(filter);
  });

  ipcMain.handle('facturas:list', async (_e, filter: FacturaFilter) => {
    return listFacturas(filter);
  });

  ipcMain.handle('credit-notes:list', async (_e, filter: CreditNoteFilter) => {
    return listCreditNotes(filter);
  });

  ipcMain.handle('daily-summaries:list', async (_e, filter: DailySummaryFilter) => {
    return listDailySummaries(filter);
  });

  ipcMain.handle('daily-summaries:refresh-status', async (_e, id: number) => {
    return refreshDailySummaryStatus(id);
  });

  ipcMain.handle('boletas:generate-pdf', async (_e, id: number, outputDir?: string) => {
    return generateAcceptedBoletaPdf(id, normalizeOutputDir(outputDir), 'A4');
  });

  ipcMain.handle('boletas:preview-html', async (_e, companyId: number, venta: any) => {
    return generatePreviewBoletaHtmlForVenta(companyId, venta, 'A4');
  });

  ipcMain.handle('credit-notes:preview-html', async (_e, id: number) => {
    return generatePreviewCreditNoteHtml(id, 'A4');
  });

  ipcMain.handle('daily-summaries:generate-pdfs', async (_e, id: number, outputDir?: string) => {
    return generateDailySummaryPdfs(id, normalizeOutputDir(outputDir), 'A4');
  });
}
