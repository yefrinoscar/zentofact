import { chromium, Browser, BrowserContext, Locator, Page } from 'playwright';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { dirname } from 'path';
import type { ScraperConfig, SiteProfile } from './types';
import { ensureDir } from './utils';

const INVOICE_LIST_URL = 'https://sellercenter.falabella.com/order/invoice#/purchased-order-list';
const AUTH_URL_PATTERN = /access-key-corp\.falabella\.tech|\/user\/auth\/login|\/auth\/login|openid-connect|login_hint=|redirect_to=|kc_action=/i;
const AUTH_TEXT_PATTERN = /forgot password|olvid[eé] mi contraseña|correo electr[oó]nico|email|password|registro|login|ingresar/i;

export async function createBrowser(
  config: ScraperConfig,
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await launchBrowser(config);

  let storageState: any = undefined;
  if (config.authStatePath && existsSync(config.authStatePath)) {
    try { storageState = JSON.parse(readFileSync(config.authStatePath, 'utf-8')); } catch {}
  }

  const context = storageState
    ? await browser.newContext({ storageState: config.authStatePath })
    : await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });

  const page = await context.newPage();
  await attachModalDismissal(page);

  return { browser, context, page };
}

/**
 * Lanza el navegador usando el primero que esté disponible: el canal preferido
 * (env/config), luego Chrome y Edge del sistema, y por último el Chromium
 * empaquetado de Playwright. Esto evita depender del binario headless-shell, que
 * en equipos con MDM corporativo se queda bloqueado al validarse.
 */
async function launchBrowser(config: ScraperConfig): Promise<Browser> {
  const preferred = process.env.SCRAPER_BROWSER_CHANNEL || config.channel || undefined;
  // undefined = Chromium empaquetado por Playwright (fallback final).
  const candidates: Array<string | undefined> = [preferred, 'chrome', 'msedge', undefined];
  const tried = new Set<string>();

  let lastError: unknown;
  for (const channel of candidates) {
    const key = channel ?? '__bundled__';
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      return await chromium.launch({
        headless: config.headless ?? true,
        channel: channel || undefined,
        slowMo: config.slowMo ?? 0,
      });
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message.split('\n')[0] : String(lastError);
  throw new Error(
    `No se pudo abrir ningún navegador (Chrome, Edge ni Chromium). Instala Google Chrome o Microsoft Edge. Detalle: ${detail}`,
  );
}

export async function ensureAuthenticated(
  page: Page,
  config: ScraperConfig,
  _profile: SiteProfile,
): Promise<void> {
  const hasStoredSession = await hasStoredSellerSession(page, config);
  await page.goto(hasStoredSession ? INVOICE_LIST_URL : config.sellerUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(hasStoredSession ? 3000 : 2000);
  if (await isSellerCenterAuthenticated(page)) {
    await finalizeAuthenticatedSession(page);
    return;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const url = page.url();

    if (await isSellerCenterAuthenticated(page)) {
      await finalizeAuthenticatedSession(page);
      return;
    }

    if (url.includes('access-key-corp.falabella.tech')) {
      await page.waitForSelector('#password', { timeout: 15000 }).catch(() => {
        throw new Error('[Keycloak] No se encontró el campo de contraseña');
      });
      await page.fill('#password', config.password).catch(() => {
        throw new Error('[Keycloak] No se encontró el campo de contraseña');
      });
      await clickFirstReady(
        page,
        ['#login', 'button[type="submit"]', 'button:has-text("Ingresar")', 'button:has-text("Iniciar sesión")'],
        15000,
        '[Keycloak] No se encontró el botón de login',
      );
      await page.waitForURL('**/sellercenter.falabella.com/**', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      if (await isSellerCenterAuthenticated(page)) {
        await finalizeAuthenticatedSession(page);
        return;
      }
      continue;
    }

    if (url.includes('/auth/login')) {
      if (await isSellerCenterAuthenticated(page)) {
        await finalizeAuthenticatedSession(page);
        return;
      }
      const hasEmail = await page.locator('#email').isVisible({ timeout: 5000 }).catch(() => false);
      if (hasEmail) {
        await page.fill('#email', config.username).catch(() => {
          throw new Error('[Falabella Login/Paso 1] No se encontró el campo de email');
        });
        await clickFirstReady(
          page,
          ['#submit', 'button[type="submit"]', 'button:has-text("Continuar")', 'button:has-text("Siguiente")'],
          15000,
          '[Falabella Login/Paso 1] No se encontró el botón Continuar después de escribir el email',
        );
        await waitForPasswordOrAuthenticated(page, 20000);
        if (await isSellerCenterAuthenticated(page)) {
          await finalizeAuthenticatedSession(page);
          return;
        }
      }

      if (await isSellerCenterAuthenticated(page)) {
        await finalizeAuthenticatedSession(page);
        return;
      }
      await page.waitForSelector('#password', { timeout: 15000 }).catch(() => {
        throw new Error('[Falabella Login/Paso 2] No se encontró el campo de contraseña');
      });
      await page.fill('#password', config.password).catch(() => {
        throw new Error('[Falabella Login/Paso 2] No se encontró el campo de contraseña');
      });
      await page.waitForTimeout(750);
      await clickFirstReady(
        page,
        ['#submit', 'button[type="submit"]', 'button:has-text("Ingresar")', 'button:has-text("Iniciar sesión")'],
        20000,
        '[Falabella Login/Paso 2] No se encontró el botón Ingresar después de escribir la contraseña',
      );
      await page.waitForURL('**/sellercenter.falabella.com/**', { timeout: 20000 }).catch(() => {
        throw new Error('[Falabella Login] No se pudo cargar Seller Center después del login');
      });
      await page.waitForTimeout(1500);
      if (await isSellerCenterAuthenticated(page)) {
        await finalizeAuthenticatedSession(page);
        return;
      }
      continue;
    }

    await page.waitForTimeout(500);
  }

  throw new Error('[Falabella Login] No se pudo autenticar después de 3 intentos');
}

async function waitForPasswordOrAuthenticated(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isSellerCenterAuthenticated(page)) return;
    const hasPassword = await page.locator('#password, input[name="password"], input[type="password"]').first().isVisible().catch(() => false);
    if (hasPassword) return;
    await page.waitForTimeout(500);
  }

  if (await isSellerCenterAuthenticated(page)) return;
  throw new Error('[Falabella Login/Paso 2] No apareció el campo de contraseña ni se detectó sesión iniciada después de enviar el email');
}

async function hasStoredSellerSession(page: Page, config: ScraperConfig): Promise<boolean> {
  const states: any[] = [];

  if (config.authStatePath && existsSync(config.authStatePath)) {
    try {
      states.push(JSON.parse(readFileSync(config.authStatePath, 'utf-8')));
    } catch {
      // ignore invalid saved state
    }
  }

  try {
    states.push(await page.context().storageState());
  } catch {
    // ignore unavailable context state
  }

  return states.some(storageStateHasSellerSession);
}

export async function isAuthenticationPage(page: Page): Promise<boolean> {
  const url = page.url();
  if (AUTH_URL_PATTERN.test(url)) return true;

  const pageState = await page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const hasLoginField = !!document.querySelector('#email, input[name="email"], #username, input[name="username"], #password, input[name="password"], input[type="password"]');
    return { text, hasLoginField };
  }).catch(() => ({ text: '', hasLoginField: false }));

  if (pageState.hasLoginField) return true;
  return AUTH_TEXT_PATTERN.test(pageState.text)
    && !/productos|órdenes|pagos|mi cuenta|documentos tributarios|ventas brutas|fulfillment/i.test(pageState.text);
}

function storageStateHasSellerSession(state: any): boolean {
  if (!state || typeof state !== 'object') return false;

  const nowSeconds = Date.now() / 1000;
  const hasRelevantCookie = Array.isArray(state.cookies) && state.cookies.some((cookie: any) => {
    const domain = String(cookie.domain || '');
    const name = String(cookie.name || '');
    const notExpired = !cookie.expires || cookie.expires < 0 || cookie.expires > nowSeconds;
    const isFalabellaDomain = /falabella|sellercenter|access-key-corp/i.test(domain);
    const looksLikeSession = /session|auth|token|keycloak|identity|access|refresh|jwt|user/i.test(name);
    return notExpired && isFalabellaDomain && looksLikeSession;
  });

  if (hasRelevantCookie) return true;

  return Array.isArray(state.origins) && state.origins.some((origin: any) => {
    const originUrl = String(origin.origin || '');
    if (!/falabella|sellercenter|access-key-corp/i.test(originUrl)) return false;
    const items = Array.isArray(origin.localStorage) ? origin.localStorage : [];
    return items.some((item: any) => {
      const key = String(item.name || '');
      const value = String(item.value || '');
      if (key === 'common-coach-mark') return false;
      return /session|auth|token|keycloak|identity|access|refresh|jwt|user|seller/i.test(key)
        || /eyJ|token|session|authenticated/i.test(value);
    });
  });
}

async function isSellerCenterAuthenticated(page: Page): Promise<boolean> {
  const url = page.url();
  if (AUTH_URL_PATTERN.test(url)) return false;

  const pageState = await page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const hasLoginField = !!document.querySelector('#email, input[name="email"], #password, input[name="password"]');
    const sellerSignals = ['Productos', 'Órdenes', 'Pagos', 'Mi cuenta', 'Fulfillment', 'Ventas brutas', 'Documentos tributarios'];
    const signalCount = sellerSignals.filter(signal => text.includes(signal)).length;
    return { hasLoginField, signalCount, text };
  }).catch(() => ({ hasLoginField: false, signalCount: 0, text: '' }));

  if (pageState.signalCount >= 2) return true;
  if (pageState.hasLoginField) return false;
  if (AUTH_TEXT_PATTERN.test(pageState.text)) return false;

  return url.includes('sellercenter.falabella.com') && pageState.signalCount >= 1;
}

async function finalizeAuthenticatedSession(page: Page): Promise<void> {
  await page.goto(INVOICE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await dismissBlockingUi(page);

  if (await isAuthenticationPage(page)) {
    throw new Error('[Falabella Login] La sesión no quedó autenticada. Falabella volvió a mostrar la pantalla de login.');
  }

  if (!(await isSellerCenterAuthenticated(page))) {
    throw new Error(`[Falabella Login] No se pudo confirmar la sesión en Seller Center. URL actual: ${page.url()}`);
  }
}

async function clickFirstReady(
  page: Page,
  selectors: string[],
  timeoutMs: number,
  errorMessage: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastClickError = '';

  while (Date.now() < deadline) {
    await dismissBlockingUi(page);

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const exists = await locator.count().then(count => count > 0).catch(() => false);
      if (!exists) continue;

      const visible = await locator.isVisible().catch(() => false);
      const enabled = await locator.isEnabled().catch(() => false);
      if (!visible || !enabled) continue;

      try {
        await clickWithModalGuard(page, locator);
        return;
      } catch (e: any) {
        lastClickError = e?.message || String(e);
      }
    }

    await page.waitForTimeout(250);
  }

  const visibleButtons = await getVisibleButtonTexts(page);
  const suffix = [
    visibleButtons ? `Botones visibles: ${visibleButtons}` : '',
    lastClickError ? `Último error de click: ${lastClickError}` : '',
  ].filter(Boolean).join('. ');
  throw new Error(`${errorMessage}${suffix ? `. ${suffix}` : ''}`);
}

async function getVisibleButtonTexts(page: Page): Promise<string> {
  return page
    .locator('button, [role="button"], input[type="submit"]')
    .evaluateAll((elements) => elements
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .slice(0, 8)
      .map((element) => {
        if (element instanceof HTMLInputElement) return element.value || element.getAttribute('aria-label') || '';
        return element.textContent?.replace(/\s+/g, ' ').trim() || element.getAttribute('aria-label') || '';
      })
      .filter(Boolean)
      .join(', '))
    .catch(() => '');
}

async function clickWithModalGuard(page: Page, locator: Locator): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    await dismissBlockingUi(page);
    await locator.scrollIntoViewIfNeeded().catch(() => {});

    try {
      await locator.click({ timeout: 1500, trial: true });
    } catch (e) {
      lastError = e;
      await dismissBlockingUi(page);
      await page.waitForTimeout(150);
      continue;
    }

    try {
      await locator.click({ timeout: 5000 });
      return;
    } catch (e) {
      lastError = e;
      if (!isRetryableClickError(e)) throw e;
      await dismissBlockingUi(page);
      await page.waitForTimeout(150);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryableClickError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /intercepts pointer events|another element would receive the click|not visible|not stable|element is outside of the viewport|timeout/i.test(message);
}

function installBlockingUiGuard(): void {
  const win = window as typeof window & {
    __boletasBlockingUiGuardInstalled?: boolean;
    __boletasBlockingUiObserver?: MutationObserver;
    __boletasBlockingUiTimer?: number;
    __boletasDismissBlockingUi?: () => void;
    __boletasInstallBlockingUiGuard?: () => void;
  };

  if (win.__boletasBlockingUiGuardInstalled) return;
  win.__boletasBlockingUiGuardInstalled = true;

  try {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false });
  } catch {
    // ignore if the property is not configurable
  }

  const surveyPattern = /que te parece la experiencia de carga de documentos tributarios|qué te parece la experiencia de carga de documentos tributarios|cuentanos que opinas del proceso de carga de documentos tributarios|cuéntanos qué opinas del proceso de carga de documentos tributarios|experiencia de carga|carga de documentos tributarios/i;
  const dismissLabelPattern = /cancelar|cancel|cerrar|close/i;
  const modalSelectors = [
    '.settlement-invoice-modal-content',
    '.settlement-invoice-modal-wrap',
    '.settlement-invoice-modal',
    '.ant-modal-root',
    '.ant-modal-wrap',
    '.ant-modal',
    '.ant-modal-mask',
    '.swal2-container',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="modal"]',
    '[class*="popup"]',
    '[class*="overlay"]',
    '[class*="backdrop"]',
    '[class*="mask"]',
    '.fixed.inset-0',
  ].join(', ');
  const closeSelector = [
    '[aria-label="Close"]',
    '[aria-label="Cerrar"]',
    '.settlement-invoice-modal-close',
    '.ant-modal-close',
    '.close',
  ].join(', ');

  const normalizeText = (value: string | null | undefined): string =>
    (value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const hideElement = (element: HTMLElement | null | undefined) => {
    if (!element) return;
    element.setAttribute('data-boletas-hidden-modal', 'true');
    element.setAttribute('aria-hidden', 'true');
    element.style.setProperty('display', 'none', 'important');
    element.style.setProperty('visibility', 'hidden', 'important');
    element.style.setProperty('pointer-events', 'none', 'important');
    element.style.setProperty('opacity', '0', 'important');
  };

  const clickDismissButton = (root: ParentNode): boolean => {
    const buttons = Array.from(root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
    for (const button of buttons) {
      const label = normalizeText(
        button.textContent
        || button.getAttribute('aria-label')
        || (button instanceof HTMLInputElement ? button.value : ''),
      );
      if (!dismissLabelPattern.test(label)) continue;
      if (!(button instanceof HTMLElement)) continue;
      button.click();
      return true;
    }
    return false;
  };

  const isSurveyElement = (element: Element | null): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    return surveyPattern.test(normalizeText(element.innerText || element.textContent || ''));
  };

  const isModalContainer = (element: Element | null): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    return element.matches(modalSelectors);
  };

  const hideRelatedContainers = (element: HTMLElement) => {
    let current: HTMLElement | null = element;
    for (let depth = 0; current && depth < 5; depth++) {
      if (current === document.body || current === document.documentElement) break;
      if (depth === 0 || isSurveyElement(current) || isModalContainer(current)) {
        hideElement(current);
      }
      current = current.parentElement;
    }

    document.querySelectorAll(modalSelectors).forEach((candidate) => {
      if (!(candidate instanceof HTMLElement)) return;
      if (candidate === element || candidate.contains(element) || element.contains(candidate) || isSurveyElement(candidate)) {
        hideElement(candidate);
      }
    });

    document.querySelectorAll('.ant-modal-mask, [class*="overlay"], [class*="backdrop"], [class*="mask"], .swal2-container')
      .forEach((candidate) => {
        if (candidate instanceof HTMLElement) hideElement(candidate);
      });
  };

  const dismiss = () => {
    if (!document.body) return;

    const surveyNodes = new Set<HTMLElement>();

    document.querySelectorAll(modalSelectors).forEach((element) => {
      if (isSurveyElement(element)) surveyNodes.add(element);
    });

    if (surveyPattern.test(normalizeText(document.body.innerText))) {
      document.querySelectorAll('div, section, aside').forEach((element) => {
        if (isSurveyElement(element)) surveyNodes.add(element);
      });
    }

    if (surveyNodes.size === 0) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }

    for (const node of surveyNodes) {
      if (clickDismissButton(node)) {
        hideRelatedContainers(node);
        continue;
      }

      const closeButton = node.querySelector(closeSelector);
      if (closeButton instanceof HTMLElement) {
        closeButton.click();
      }
      hideRelatedContainers(node);
    }

    clickDismissButton(document);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };

  win.__boletasDismissBlockingUi = dismiss;
  win.__boletasInstallBlockingUiGuard = () => {
    if (!document.body) {
      window.setTimeout(win.__boletasInstallBlockingUiGuard!, 100);
      return;
    }

    dismiss();

    if (!win.__boletasBlockingUiObserver) {
      win.__boletasBlockingUiObserver = new MutationObserver(() => dismiss());
      win.__boletasBlockingUiObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'open', 'aria-hidden'],
      });
    }

    if (!win.__boletasBlockingUiTimer) {
      win.__boletasBlockingUiTimer = window.setInterval(dismiss, 250);
    }
  };

  win.__boletasInstallBlockingUiGuard();
}

export async function dismissBlockingUi(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __boletasDismissBlockingUi?: () => void;
      __boletasInstallBlockingUiGuard?: () => void;
    };

    if (typeof win.__boletasInstallBlockingUiGuard === 'function') {
      win.__boletasInstallBlockingUiGuard();
    }
    if (typeof win.__boletasDismissBlockingUi === 'function') {
      win.__boletasDismissBlockingUi();
    }
  }).catch(() => {});

  await page.keyboard.press('Escape').catch(() => {});
}

export async function attachModalDismissal(page: Page): Promise<void> {
  await page.addInitScript(installBlockingUiGuard);
  await page.evaluate(installBlockingUiGuard).catch(() => {});
}

export async function saveAuthState(context: BrowserContext, filePath: string): Promise<void> {
  if (!filePath) return;
  const state = await context.storageState();
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}
