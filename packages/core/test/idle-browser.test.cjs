const test = require('node:test');
const assert = require('node:assert/strict');

const { createIdleBrowser } = require('../dist/utils/idle-browser.js');

function fakeLauncher() {
  const browsers = [];
  const launch = async () => {
    const browser = {
      connected: true,
      pages: [],
      closed: false,
      async newPage() {
        const page = { closed: false, async close() { page.closed = true; } };
        browser.pages.push(page);
        return page;
      },
      async close() {
        browser.closed = true;
        browser.connected = false;
      },
    };
    browsers.push(browser);
    return browser;
  };
  return { launch, browsers };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('cierra Chromium cuando queda inactivo y lo relanza en el siguiente uso', async () => {
  const { launch, browsers } = fakeLauncher();
  const pool = createIdleBrowser({ launch, idleMs: 20 });

  assert.equal(await pool.withPage(async () => 'pdf-1'), 'pdf-1');
  assert.equal(browsers.length, 1);
  assert.equal(browsers[0].pages[0].closed, true);
  assert.equal(browsers[0].closed, false);

  await wait(40);
  assert.equal(browsers[0].closed, true, 'el navegador inactivo debe liberarse');

  await pool.withPage(async () => 'pdf-2');
  assert.equal(browsers.length, 2, 'un uso posterior relanza el navegador');
  await pool.close();
});

test('cierra la pestaña aunque el render falle', async () => {
  const { launch, browsers } = fakeLauncher();
  const pool = createIdleBrowser({ launch, idleMs: 1_000 });

  await assert.rejects(pool.withPage(async () => { throw new Error('render roto'); }), /render roto/);
  assert.equal(browsers[0].pages[0].closed, true);
  await pool.close();
});

test('comparte un solo navegador entre usos concurrentes y no lo cierra mientras hay trabajo', async () => {
  const { launch, browsers } = fakeLauncher();
  const pool = createIdleBrowser({ launch, idleMs: 10 });

  let release;
  const slow = pool.withPage(() => new Promise((resolve) => { release = resolve; }));
  const fast = pool.withPage(async () => 'rápido');
  assert.equal(await fast, 'rápido');

  await wait(30);
  assert.equal(browsers.length, 1, 'no debe lanzar un segundo Chromium');
  assert.equal(browsers[0].closed, false, 'no se cierra con un PDF en curso');

  release('lento');
  assert.equal(await slow, 'lento');
  await wait(30);
  assert.equal(browsers[0].closed, true);
});

test('relanza si Chromium se desconectó', async () => {
  const { launch, browsers } = fakeLauncher();
  const pool = createIdleBrowser({ launch, idleMs: 1_000 });

  await pool.withPage(async () => null);
  browsers[0].connected = false;
  await pool.withPage(async () => null);
  assert.equal(browsers.length, 2);
  await pool.close();
});
