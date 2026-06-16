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

function readRequiredBrowserDirs() {
  const playwrightCorePkg = require.resolve('playwright-core/package.json');
  const browsersJsonPath = path.join(path.dirname(playwrightCorePkg), 'browsers.json');
  const browsersJson = JSON.parse(fs.readFileSync(browsersJsonPath, 'utf8'));

  const directoryByBrowserName = {
    chromium: (revision) => `chromium-${revision}`,
    'chromium-headless-shell': (revision) => `chromium_headless_shell-${revision}`,
    ffmpeg: (revision) => `ffmpeg-${revision}`,
  };

  return browsersJson.browsers
    .filter((browser) => browser.name in directoryByBrowserName)
    .map((browser) => directoryByBrowserName[browser.name](browser.revision));
}

function copyRequiredBrowsers() {
  const cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const targetDir = path.join(__dirname, '..', 'vendor', 'ms-playwright');
  const requiredDirs = readRequiredBrowserDirs();

  if (!fs.existsSync(cacheDir)) {
    throw new Error(`No existe la caché de Playwright: ${cacheDir}`);
  }

  ensureDir(path.dirname(targetDir));
  emptyDir(targetDir);

  for (const dirName of requiredDirs) {
    const sourceDir = path.join(cacheDir, dirName);
    const destDir = path.join(targetDir, dirName);

    if (!fs.existsSync(sourceDir)) {
      throw new Error(
        `Falta el navegador requerido de Playwright: ${sourceDir}. Ejecuta "npx playwright install chromium".`,
      );
    }

    fs.cpSync(sourceDir, destDir, { recursive: true });
    console.log(`Copied ${dirName}`);
  }
}

copyRequiredBrowsers();
