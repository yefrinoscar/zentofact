import { app } from 'electron';
import fs from 'fs';
import path from 'path';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDirIfMissing(sourceDir: string, targetDir: string) {
  if (!fs.existsSync(sourceDir) || fs.existsSync(targetDir)) {
    return;
  }

  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

// The database now lives in Neon Postgres. Only local file assets (PDF/XML/CDR
// output) live under the storage dir, so we just make sure any seeded assets
// are copied on first run.
function copySeedStorageIfNeeded(seedStorageDir: string, storageDir: string) {
  if (!fs.existsSync(seedStorageDir)) {
    return;
  }

  copyDirIfMissing(seedStorageDir, storageDir);
}

function getSeedStorageDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'storage-seed');
  }

  return path.resolve(app.getAppPath(), 'storage');
}

function findPuppeteerExecutable(baseDir: string): string | null {
  const candidates = [
    path.join(
      baseDir,
      'chrome-headless-shell',
      'mac_arm-148.0.7778.97',
      'chrome-headless-shell-mac-arm64',
      'chrome-headless-shell',
    ),
    path.join(
      baseDir,
      'chrome',
      'mac_arm-148.0.7778.97',
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const shellDir = path.join(baseDir, 'chrome-headless-shell');
  if (fs.existsSync(shellDir)) {
    for (const versionDir of fs.readdirSync(shellDir)) {
      const candidate = path.join(
        shellDir,
        versionDir,
        'chrome-headless-shell-mac-arm64',
        'chrome-headless-shell',
      );
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const chromeDir = path.join(baseDir, 'chrome');
  if (!fs.existsSync(chromeDir)) {
    return null;
  }

  for (const versionDir of fs.readdirSync(chromeDir)) {
    const candidate = path.join(
      chromeDir,
      versionDir,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function configurePuppeteerBrowser() {
  // Prefiere el navegador del sistema (Chrome/Edge) para generar los PDFs, igual
  // que el scraper. Así no se depende de un Chromium empaquetado (que en Macs con
  // MDM se queda bloqueado al validarse) y no hay que empaquetar navegadores.
  const systemExecutable = detectSystemBrowserExecutable();
  if (systemExecutable) {
    process.env.PUPPETEER_EXECUTABLE_PATH = systemExecutable;
    return;
  }

  // Fallback: Chromium empaquetado por Puppeteer, si existe.
  const bundledBrowserDir = app.isPackaged
    ? path.join(process.resourcesPath, 'puppeteer-browser')
    : path.resolve(app.getAppPath(), 'vendor', 'puppeteer');

  if (!fs.existsSync(bundledBrowserDir)) {
    return;
  }

  process.env.PUPPETEER_CACHE_DIR = bundledBrowserDir;
  const executablePath = findPuppeteerExecutable(bundledBrowserDir);
  if (executablePath) {
    process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
  }
}

/** Ruta al ejecutable de un navegador del sistema (Chrome o Edge), para usarlo
 *  como executablePath de Puppeteer. */
function detectSystemBrowserExecutable(): string | undefined {
  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
      : process.platform === 'win32'
        ? [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)']]
            .filter(Boolean)
            .flatMap((base) => [
              path.join(base as string, 'Google/Chrome/Application/chrome.exe'),
              path.join(base as string, 'Microsoft/Edge/Application/msedge.exe'),
            ])
        : ['/usr/bin/google-chrome', '/usr/bin/microsoft-edge', '/usr/bin/chromium'];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function detectSystemBrowserChannel(): string | undefined {
  // Navegadores del sistema basados en Chromium que Playwright puede usar por
  // canal, sin descargar nada. Útil cuando la validación del binario
  // headless-shell de Playwright está bloqueada (Macs con MDM corporativo).
  const candidates: Array<{ channel: string; macApp: string; winRelative: string }> = [
    { channel: 'chrome', macApp: '/Applications/Google Chrome.app', winRelative: 'Google/Chrome/Application/chrome.exe' },
    { channel: 'msedge', macApp: '/Applications/Microsoft Edge.app', winRelative: 'Microsoft/Edge/Application/msedge.exe' },
  ];
  for (const candidate of candidates) {
    if (process.platform === 'darwin' && fs.existsSync(candidate.macApp)) return candidate.channel;
    if (process.platform === 'win32') {
      const bases = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)']].filter(Boolean) as string[];
      if (bases.some((base) => fs.existsSync(path.join(base, candidate.winRelative)))) return candidate.channel;
    }
  }
  return undefined;
}

function configurePlaywrightBrowsers() {
  const browsersDir = app.isPackaged
    ? path.join(process.resourcesPath, 'playwright-browsers')
    : path.resolve(app.getAppPath(), 'vendor', 'ms-playwright');

  if (app.isPackaged || fs.existsSync(browsersDir)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
  }

  // Prefiere un navegador del sistema (Chrome/Edge) si está instalado: son
  // Chromium, suelen estar aprobados en equipos corporativos y evitan depender
  // del binario headless-shell de Playwright (que en Macs con MDM se queda
  // bloqueado al validarse). Si no hay ninguno, se usa el Chromium empaquetado.
  if (!process.env.SCRAPER_BROWSER_CHANNEL) {
    const channel = detectSystemBrowserChannel();
    if (channel) process.env.SCRAPER_BROWSER_CHANNEL = channel;
  }
}

export function prepareDesktopStorage() {
  const userDataDir = app.getPath('userData');
  const storageDir = path.join(userDataDir, 'storage');
  const seedStorageDir = getSeedStorageDir();

  configurePuppeteerBrowser();
  configurePlaywrightBrowsers();
  ensureDir(userDataDir);
  copySeedStorageIfNeeded(seedStorageDir, storageDir);
  ensureDir(storageDir);

  // DB connection comes from DATABASE_URL_POSTGRES (Neon). Only the local file
  // storage path is configured here.
  process.env.STORAGE_PATH = storageDir;

  return {
    storageDir,
    seedStorageDir,
  };
}
