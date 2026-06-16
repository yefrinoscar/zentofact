import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import fs from 'fs';
import os from 'os';

export function registerFileHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle('get-home-dir', async () => os.homedir());
  ipcMain.handle('select-certificate', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar certificado digital',
      filters: [{ name: 'Certificados', extensions: ['pfx', 'p12', 'pem'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('select-output-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar carpeta de salida',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('select-input-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar archivo de ventas',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('select-pdf-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('select-save-file', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar archivo',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return null;
    return result.filePath;
  });

  ipcMain.handle('read-input-file', async (_e, filePath: string) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  });

  ipcMain.handle('read-text-file', async (_e, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('read-file-data-url', async (_e, filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp'
      ? 'image/webp'
      : 'image/png';
    const base64 = fs.readFileSync(filePath, { encoding: 'base64' });
    return `data:${mime};base64,${base64}`;
  });

  ipcMain.handle('read-cert-base64', async (_e, filePath: string) => {
    return fs.readFileSync(filePath, { encoding: 'base64' });
  });

  ipcMain.handle('read-file-base64', async (_e, filePath: string) => {
    return fs.readFileSync(filePath, { encoding: 'base64' });
  });

  ipcMain.handle('read-cert-file', async (_e, filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext === 'pem') {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return fs.readFileSync(filePath, { encoding: 'base64' });
  });

  ipcMain.handle('open-output-dir', async (_e, dirPath: string) => {
    const { shell } = await import('electron');
    shell.openPath(dirPath);
  });
}
