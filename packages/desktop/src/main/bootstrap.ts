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

function configurePlaywrightBrowsers() {
  if (app.isPackaged) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'playwright-browsers');
    return;
  }

  const bundledBrowsersDir = path.resolve(app.getAppPath(), 'vendor', 'ms-playwright');
  if (fs.existsSync(bundledBrowsersDir)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsersDir;
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
