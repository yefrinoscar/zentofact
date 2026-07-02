import { ipcMain } from 'electron';
import { getCorrelatives } from '@zentofact/core';

export function registerCorrelativeHandlers() {
  ipcMain.handle('correlatives:get', async (_e, branchId: number) => {
    return getCorrelatives(branchId);
  });
}
