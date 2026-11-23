// Chromium compartido que se cierra solo tras un periodo sin uso.
// Un navegador vivo durante toda la vida del proceso acumula memoria
// (en Railway la RAM del API crecía ~15–50 MB/día hasta el siguiente deploy).

export interface IdleBrowserPage {
  close(): Promise<unknown>;
}

export interface IdleBrowserHandle {
  readonly connected: boolean;
  newPage(): Promise<IdleBrowserPage>;
  close(): Promise<unknown>;
}

export interface IdleBrowserOptions<B> {
  launch: () => Promise<B>;
  idleMs?: number;
}

export function createIdleBrowser<B extends IdleBrowserHandle>({
  launch,
  idleMs = 60_000,
}: IdleBrowserOptions<B>) {
  let browserPromise: Promise<B> | null = null;
  let active = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  async function close() {
    cancelIdle();
    const pending = browserPromise;
    browserPromise = null;
    if (!pending) return;
    const browser = await pending.catch(() => null);
    await browser?.close().catch(() => undefined);
  }

  function scheduleIdle() {
    cancelIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (active === 0) void close();
    }, idleMs);
    idleTimer.unref?.();
  }

  async function acquire(): Promise<B> {
    while (browserPromise) {
      const pending = browserPromise;
      const current = await pending.catch(() => null);
      if (current?.connected) return current;
      // Otro uso concurrente pudo haber relanzado mientras esperábamos.
      if (browserPromise === pending) browserPromise = null;
    }
    const launching = launch();
    browserPromise = launching;
    launching.catch(() => {
      if (browserPromise === launching) browserPromise = null;
    });
    return launching;
  }

  type Page = Awaited<ReturnType<B['newPage']>>;

  async function withPage<T>(work: (page: Page) => Promise<T>): Promise<T> {
    active += 1;
    cancelIdle();
    try {
      const browser = await acquire();
      const page = (await browser.newPage()) as Page;
      try {
        return await work(page);
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      active -= 1;
      if (active === 0) scheduleIdle();
    }
  }

  return { withPage, close };
}
