import { ipcMain } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { FalabellaWorkflow, mapOrders } from '@boletas/scraper';
import type { ScraperConfig, FalabellaExtract } from '@boletas/scraper';

let workflow: FalabellaWorkflow | null = null;

function normalizeScraperPath(targetPath: string | undefined, fallbackName: string) {
  const baseDir = path.join(os.homedir(), '.boletas-sunat');

  if (!targetPath?.trim()) {
    return path.join(baseDir, fallbackName);
  }

  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  const normalized = targetPath.replace(/^\.?[\\/]+/, '');
  return path.join(baseDir, normalized || fallbackName);
}

function normalizeScraperConfig(config: ScraperConfig): ScraperConfig {
  return {
    ...config,
    outputDir: normalizeScraperPath(config.outputDir, 'data'),
    authStatePath: normalizeScraperPath(config.authStatePath, 'falabella-session.json'),
  };
}

export function registerScraperHandlers() {
  ipcMain.handle('scraper:init', async (_e, config: ScraperConfig) => {
    if (workflow) {
      await workflow.cleanup();
      workflow = null;
    }
    workflow = new FalabellaWorkflow(normalizeScraperConfig(config));
    return { success: true };
  });

  ipcMain.handle('scraper:get-state', async () => {
    if (!workflow) return { error: 'Workflow no inicializado' };
    return { state: workflow.getState(), preview: workflow.getPreview() };
  });

  ipcMain.handle('scraper:step-abrir', async () => {
    if (!workflow) return { error: 'Workflow no inicializado' };
    const result = await workflow.abrirNavegador();
    return { result, state: workflow.getState() };
  });

  ipcMain.handle('scraper:step-login', async () => {
    if (!workflow) return { error: 'Workflow no inicializado' };
    const result = await workflow.loginFalabella();
    return { result, state: workflow.getState() };
  });

  ipcMain.handle('scraper:step-filtrar', async () => {
    if (!workflow) return { error: 'Workflow no inicializado' };
    const result = await workflow.filtrarVentasPendientes();
    return { result, state: workflow.getState() };
  });

  ipcMain.handle('scraper:step-leer', async () => {
    if (!workflow) return { error: 'Workflow no inicializado' };
    const result = await workflow.leerDetalleVentas();
    return { result, state: workflow.getState() };
  });

  ipcMain.handle('scraper:step-exportar', async () => {
    if (!workflow) return { error: 'Workflow no inicializado' };
    const result = await workflow.exportarJson();
    return { result, state: workflow.getState() };
  });

  ipcMain.handle('scraper:step-convertir', async () => {
    if (!workflow) return { error: 'Workflow no inicializado' };
    const result = await workflow.convertirAVentaItems();
    return { result, state: workflow.getState(), ventas: JSON.parse(JSON.stringify(workflow.getVentas())) };
  });

  ipcMain.handle('scraper:get-ventas', async () => {
    if (!workflow) return { ventas: [] };
    return { ventas: JSON.parse(JSON.stringify(workflow.getVentas())) };
  });

  ipcMain.handle('scraper:run-all', async (event) => {
    if (!workflow) return { error: 'Workflow no inicializado' };
    const { ventas, state } = await workflow.runAll((s, p) => {
      event.sender.send('scraper:step-progress', { state: s, preview: p });
    });
    return {
      ventas: JSON.parse(JSON.stringify(ventas)),
      rawOrders: JSON.parse(JSON.stringify(workflow.getRawOrders())),
      state,
    };
  });

  ipcMain.handle('scraper:cleanup', async () => {
    if (workflow) {
      await workflow.cleanup();
      workflow = null;
    }
    return { success: true };
  });

  ipcMain.handle('scraper:load-orders', async (_e, filePath: string) => {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      let orders: any[] = [];
      if (Array.isArray(data)) {
        orders = data;
      } else if (data.orders && Array.isArray(data.orders)) {
        orders = data.orders;
      } else if (data.data && Array.isArray(data.data)) {
        orders = data.data;
      } else {
        for (const key of Object.keys(data)) {
          if (Array.isArray(data[key]) && data[key].length > 0) {
            orders = data[key];
            break;
          }
        }
      }

      if (orders.length === 0) {
        return { error: `No se encontraron ventas. Estructura detectada: ${JSON.stringify(Object.keys(data))}` };
      }

      const first = orders[0];
      const isRaw = first && typeof first === 'object'
        && ('clientDocNumber' in first || 'purchaseDate' in first || 'items' in first)
        && !('client' in first);

      const ventas = isRaw
        ? []
        : orders;
      return isRaw
        ? { orders: JSON.parse(JSON.stringify(orders)), orderCount: orders.length, isRaw: true }
        : { ventas: JSON.parse(JSON.stringify(ventas)), orderCount: ventas.length, isRaw: false };
    } catch (e: any) {
      return { error: `Error al cargar: ${e.message}` };
    }
  });

  ipcMain.handle('scraper:export-orders', async (_e, { filePath, ventas }: { filePath: string; ventas: any[] }) => {
    try {
      const extract: FalabellaExtract = {
        extractedAt: new Date().toISOString(),
        config: {} as any,
        totalOrders: ventas.length,
        orders: ventas,
      };
      writeFileSync(filePath, JSON.stringify(extract, null, 2), 'utf-8');
      return { success: true, path: filePath };
    } catch (e: any) {
      return { error: `Error al exportar: ${e.message}` };
    }
  });

  ipcMain.handle('scraper:convert-orders', async (_e, orders: any[]) => {
    try {
      if (!orders || orders.length === 0) {
        return { error: 'No hay órdenes para convertir.' };
      }
      const first = orders[0];
      const ventas = 'orderNumber' in first
        ? mapOrders(orders)
        : orders;
      return { ventas: JSON.parse(JSON.stringify(ventas)), orderCount: ventas.length };
    } catch (e: any) {
      return { error: `Error al convertir: ${e.message}` };
    }
  });
}
