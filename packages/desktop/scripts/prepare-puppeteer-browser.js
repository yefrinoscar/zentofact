const fs = require('fs');
const os = require('os');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyDirIfExists(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return false;
  }

  fs.cpSync(sourceDir, targetDir, { recursive: true });
  console.log(`Copied ${path.basename(sourceDir)}`);
  return true;
}

function copyBundledPuppeteerBrowsers() {
  const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer');
  const targetDir = path.join(__dirname, '..', 'vendor', 'puppeteer');
  const browserDirs = ['chrome-headless-shell'];

  if (!fs.existsSync(cacheDir)) {
    throw new Error(`No existe la caché de Puppeteer: ${cacheDir}`);
  }

  ensureDir(path.dirname(targetDir));
  emptyDir(targetDir);

  let copied = 0;
  for (const dirName of browserDirs) {
    const sourceDir = path.join(cacheDir, dirName);
    const destDir = path.join(targetDir, dirName);
    if (copyDirIfExists(sourceDir, destDir)) {
      copied += 1;
    }
  }

  if (copied === 0) {
    throw new Error(
      `No se encontraron navegadores de Puppeteer en ${cacheDir}. Ejecuta "npx puppeteer browsers install chrome".`,
    );
  }
}

copyBundledPuppeteerBrowsers();
