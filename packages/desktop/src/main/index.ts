import { app, BrowserWindow, nativeImage, shell } from 'electron';
import { join, resolve } from 'path';
import dotenv from 'dotenv';
import { prepareDesktopStorage } from './bootstrap';

// @boletas/core throws at import time if DATABASE_URL_POSTGRES is missing, so the
// .env must be loaded here (before any core import) for the app to even start.
// In dev the main process runs with cwd = packages/desktop, so core's own
// dotenv.config() can't find the monorepo-root .env. In a packaged build there is
// no cwd .env at all — it's bundled into Resources via build.extraResources.
if (app.isPackaged) {
  dotenv.config({ path: join(process.resourcesPath, '.env') });
} else {
  dotenv.config({ path: resolve(app.getAppPath(), '..', '..', '.env') });
}

let mainWindow: BrowserWindow | null = null;

function getIconPath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icon.png')
    : join(__dirname, '../../resources/icon.png');
}

function createWindow(): void {
  const iconPath = getIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });
}

function loadWindow(): void {
  if (!mainWindow) {
    throw new Error('Cannot load the desktop window before it is created.');
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function registerHandlers() {
  const [
    { registerWorkflowHandlers },
    { registerFileHandlers },
    { registerCompanyHandlers },
    { registerBranchHandlers },
    { registerBoletaHandlers },
    { registerCorrelativeHandlers },
    { registerScraperHandlers },
    { registerFalabellaApiHandlers },
  ] = await Promise.all([
    import('./ipc/workflow'),
    import('./ipc/files'),
    import('./ipc/company'),
    import('./ipc/branch'),
    import('./ipc/boletas'),
    import('./ipc/correlatives'),
    import('./ipc/scraper'),
    import('./ipc/falabella-api'),
  ]);

  registerWorkflowHandlers();
  registerFileHandlers(mainWindow!);
  registerCompanyHandlers();
  registerBranchHandlers();
  registerBoletaHandlers();
  registerCorrelativeHandlers();
  registerScraperHandlers();
  registerFalabellaApiHandlers();
}

app.whenReady().then(async () => {
  prepareDesktopStorage();

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(getIconPath());
  }

  createWindow();
  await registerHandlers();
  loadWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    loadWindow();
  }
});
