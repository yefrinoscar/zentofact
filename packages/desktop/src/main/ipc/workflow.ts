import { ipcMain } from 'electron';
import os from 'os';
import path from 'path';
import { processWorkflow, validateConfig, validateVentas, sanitizeVentaItem } from '@zentofact/core';
import type { CoreConfig, VentaItem } from '@zentofact/core';

function normalizeOutputDir(outputDir: string | undefined) {
  const fallbackDir = path.join(os.homedir(), 'boletas-emitidas');

  if (!outputDir?.trim()) {
    return fallbackDir;
  }

  return path.isAbsolute(outputDir) ? outputDir : path.join(os.homedir(), outputDir.replace(/^\.?[\\/]+/, ''));
}

export function registerWorkflowHandlers() {
  ipcMain.handle('validate-config', async (_e, config: CoreConfig) => {
    return validateConfig(config);
  });

  ipcMain.handle('validate-ventas', async (_e, ventas: VentaItem[]) => {
    return validateVentas(ventas);
  });

  ipcMain.handle('process-workflow', async (event, config: CoreConfig, ventas: VentaItem[]) => {
    try {
      const normalizedConfig = {
        ...config,
        outputDir: normalizeOutputDir(config.outputDir),
      };
      const cleanVentas = ventas.map(sanitizeVentaItem);
      const result = await processWorkflow(
        normalizedConfig,
        cleanVentas,
        (current, total, status) => {
          event.sender.send('workflow-progress', { current, total, status });
        },
      );
      return { success: true, result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
