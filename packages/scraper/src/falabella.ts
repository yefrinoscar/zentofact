import { Page } from 'playwright';
import type { ScraperConfig, SiteProfile, RawFalabellaOrder, RawFalabellaItem, ScrapeError } from './types';
import { dismissBlockingUi, isAuthenticationPage } from './browser';

export const DEFAULT_FALABELLA_PROFILE: SiteProfile = {
  loginUrl: 'https://sellercenter.falabella.com/user/auth/login',
  usernameSelector: '#email, input[name="email"]',
  passwordSelector: '#password, input[name="password"]',
  submitSelector: '#submit, input[type="submit"]',
  usernameSubmitSelector: '#submit, input[type="submit"]',
  loginSuccessIndicator: [
    '[data-testid="seller-header"]', 'nav', '.main-nav', 'header',
    '[class*="logged"]', '[class*="dashboard"]', '[class*="sidebar"]', '.navbar', '#main-menu',
  ].join(', '),
  salesUrl: 'https://sellercenter.falabella.com/order/invoice#/purchased-order-list',
  saleRowSelector: 'tr, [class*="row"], [class*="Row"]',
};

export function getProfile(overrides?: Partial<SiteProfile>): SiteProfile {
  return { ...DEFAULT_FALABELLA_PROFILE, ...overrides };
}

const DETAIL_API = 'seller-platforms.falabella.services/manage-orders/v1/order/number/';
const INVOICE_LIST_URL = 'https://sellercenter.falabella.com/order/invoice#/purchased-order-list';
const INVOICE_LIST_BASE_URL = 'https://sellercenter.falabella.com/order/invoice';
const SELLER_ORDER_ROUTE = '**/invoice-bff/v2/seller-order/**';
const DETAIL_CONCURRENCY = 4;

export async function extractOrders(
  page: Page,
  config: ScraperConfig,
  _profile: SiteProfile,
): Promise<{ orders: RawFalabellaOrder[]; errors: ScrapeError[]; totalReviewed: number }> {
  const pending = await extractPendingOrders(page, config, _profile);
  const orders = await hydrateOrderDetails(page, pending.orders, pending.errors);
  return { orders, errors: pending.errors, totalReviewed: pending.totalReviewed };
}

export async function extractPendingOrders(
  page: Page,
  config: ScraperConfig,
  _profile: SiteProfile,
): Promise<{ orders: RawFalabellaOrder[]; errors: ScrapeError[]; totalReviewed: number }> {
  const errors: ScrapeError[] = [];
  const today = new Date();
  const toDate = config.dateTo || new Date(today.getTime() + 86400000).toISOString().split('T')[0];
  const fromDate = config.dateFrom || new Date(today.getTime() - 7 * 86400000).toISOString().split('T')[0];

  const chunks = generateDateChunks(fromDate, toDate);
  console.log(`[falabella] ${chunks.length} chunks from ${fromDate} to ${toDate}`);

  await installSellerCenterLocalStorageFlags(page);

  const allOrders: RawFalabellaOrder[] = [];
  let totalReviewed = 0;
  const startTime = Date.now();
  for (const chunk of chunks) {
    const result = await extractChunk(page, chunk.from, chunk.to, errors);
    allOrders.push(...result.orders);
    totalReviewed += result.totalReviewed;
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`[falabella] Total pending: ${allOrders.length} / ${totalReviewed} reviewed (${elapsed}s)`);
  return { orders: allOrders, errors, totalReviewed };
}

async function installSellerCenterLocalStorageFlags(page: Page): Promise<void> {
  const applyFlags = () => {
    if (!location.hostname.includes('sellercenter.falabella.com')) return;

    const now = Date.now();
    localStorage.setItem('DECLINED_DATE', String(now));
    localStorage.setItem('common-coach-mark', JSON.stringify([
      '.support-coachmark',
      '.col_0_0',
      '.col_0_2',
      '.col_1_0',
      '.col_2_0',
      '.col_3_0',
    ]));
    localStorage.setItem('kampylePageLoadedTimestamp', String(now));
    localStorage.setItem('kampyleSessionPageCounter', '2');
    localStorage.setItem('kampyleUserPercentile', '52.740669160066055');
    localStorage.setItem('kampyleUserSession', String(now));
    localStorage.setItem('kampyleUserSessionsCount', '17');
    localStorage.setItem('kampyle_userid', '9133-9f9b-25eb-2567-f0a5-e512-6096-131b');
    localStorage.setItem('settlement-invoice-columns', JSON.stringify({
      deliveryOrderNumber: { show: true },
      createdAt: { show: true },
      fulfillmentInfo: { show: true },
      invoiceConfig: { show: true },
      documentUpload: { show: true },
    }));
    localStorage.setItem('tour_storage', JSON.stringify({ count: 1, finished: true }));
    localStorage.setItem('user-coach-mark', '4');

    localStorage.setItem('ngTempFbsOrders', JSON.stringify({
      reload: { times: 0 },
      datatable: {
        filter: 'PENDING',
        limit: 50,
        search: {},
        params: {
          group: 'TODAY',
          action: ['ALL'],
          carriers: 'FALABELLA_GROUP',
          pickup: 'DROP_OFF',
        },
      },
    }));
  };

  await page.addInitScript(applyFlags).catch(() => {});
  await page.evaluate(applyFlags).catch(() => {});
}

export async function hydrateOrderDetails(
  page: Page,
  orders: RawFalabellaOrder[],
  errors: ScrapeError[] = [],
): Promise<RawFalabellaOrder[]> {
  const hydrated: RawFalabellaOrder[] = new Array(orders.length);
  const startTime = Date.now();
  const context = page.context();
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = cursor++;
      if (currentIndex >= orders.length) return;

      const order = orders[currentIndex];
      const detailPage = await context.newPage();
      try {
        const detail = await fetchOrderDetail(detailPage, order.orderNumber, errors, currentIndex);
        hydrated[currentIndex] = {
          ...order,
          invoiceType: detail.invoiceType || order.invoiceType,
          clientDocNumber: detail.clientDocNumber || order.clientDocNumber,
          clientName: detail.clientName || order.clientName,
          total: detail.total || order.total,
          items: detail.items.length > 0 ? detail.items : order.items,
        };
      } finally {
        await detailPage.close().catch(() => {});
      }
    }
  };

  const workerCount = Math.min(DETAIL_CONCURRENCY, Math.max(1, orders.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[falabella] Details read: ${hydrated.length} orders (${elapsed}s)`);
  return hydrated;
}

function generateDateChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const fromD = new Date(from + 'T00:00:00');
  const toD = new Date(to + 'T00:00:00');
  let start = new Date(fromD);
  while (start < toD) {
    let end = new Date(start.getTime() + 30 * 86400000);
    if (end > toD) end = toD;
    chunks.push({ from: start.toISOString().split('T')[0], to: end.toISOString().split('T')[0] });
    start = new Date(end.getTime() + 86400000);
  }
  return chunks;
}

async function extractChunk(
  page: Page, fromDate: string, toDate: string, errors: ScrapeError[],
): Promise<{ orders: RawFalabellaOrder[]; totalReviewed: number }> {
  const orders: RawFalabellaOrder[] = [];
  let totalPages = 1;
  let totalReviewed = 0;

  for (let pageNum = 1; pageNum <= 50; pageNum++) {
    try {
      const json = await fetchSellerOrderPageThroughApp(page, pageNum, fromDate, toDate);
      const items = json.data || [];
      if (!items.length) break;
      if (pageNum === 1) totalPages = json.meta?.pagination?.totalPages || 1;
      totalReviewed += items.length;
      console.log(`[falabella] ${fromDate}→${toDate} p${pageNum}/${totalPages}: ${items.length}`);

      for (const item of items) {
        const cfg = item.invoiceConfig?.orderConfig;
        if (cfg?.restrictUpload && cfg?.reasonCodes?.includes('INVOICE_ALREADY_UPLOADED')) continue;
        const orderNum = item.deliveryOrderNumber || item.orderNumber;
        orders.push({
          orderNumber: orderNum,
          sellerOrderNumber: item.sellerOrderNumber,
          purchaseDate: item.createdAt,
          invoiceType: item.invoiceInstruction?.invoiceType || '',
          clientDocNumber: item.document?.id || '',
          clientName: [item.userName?.firstName, item.userName?.lastName1, item.userName?.lastName2].filter(Boolean).join(' ') || '',
          total: parseAmount(item.total || item.totalAmount || item.amount || item.grandTotal || '0'),
          items: [],
        });
      }
      if (pageNum >= totalPages) break;
    } catch (e: any) {
      await page.unroute('**/invoice-bff/v2/seller-order/**').catch(() => {});
      const currentUrl = page.url();
      errors.push({
        orderIndex: -1,
        page: pageNum,
        step: 'filtrar_ventas',
        stepLabel: 'Buscar órdenes sin documento',
        reason: `Error en página ${pageNum} (${fromDate}→${toDate}). ` +
          `Esperando respuesta de invoice-bff/v2/seller-order en ${currentUrl}. ` +
          `Timeout: ${e.message.includes('Timeout') ? 'la página no cargó a tiempo la lista de órdenes' : e.message}`
      });
      break;
    }
  }
  return { orders, totalReviewed };
}

async function fetchSellerOrderPageThroughApp(
  page: Page,
  pageNum: number,
  fromDate: string,
  toDate: string,
): Promise<any> {
  const tab = await page.context().newPage();
  await dismissBlockingUi(tab);

  let modalDismissTimer: ReturnType<typeof setInterval> | null = null;
  const startDismissInterval = () => {
    if (modalDismissTimer) clearInterval(modalDismissTimer);
    modalDismissTimer = setInterval(() => {
      dismissBlockingUi(tab).catch(() => {});
    }, 200);
  };

  startDismissInterval();

  await tab.unroute(SELLER_ORDER_ROUTE).catch(() => {});
  await tab.route(SELLER_ORDER_ROUTE, async (route) => {
    const u = new URL(route.request().url());
    u.searchParams.set('page', String(pageNum));
    u.searchParams.set('fromDate', fromDate);
    u.searchParams.set('toDate', toDate);
    try {
      const mod = await route.fetch({ url: u.toString() });
      await route.fulfill({ response: mod });
    } catch {
      await route.abort().catch(() => {});
    }
  });

  const listUrl = pageNum === 1
    ? INVOICE_LIST_URL
    : `${INVOICE_LIST_BASE_URL}?scrapePage=${pageNum}#/purchased-order-list`;

  try {
    await tab.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await dismissBlockingUi(tab);
    if (await isAuthenticationPage(tab)) {
      throw new Error('[Falabella Login] La sesión expiró antes de cargar Documentos Tributarios.');
    }

    const resp = await tab.waitForResponse(
      r => r.url().includes('invoice-bff/v2/seller-order') && r.status() === 200,
      { timeout: 60000 },
    );
    await dismissBlockingUi(tab);
    return resp.json();
  } finally {
    if (modalDismissTimer) clearInterval(modalDismissTimer);
    await tab.unroute(SELLER_ORDER_ROUTE).catch(() => {});
    await tab.close().catch(() => {});
  }
}

async function fetchOrderDetail(
  page: Page, deliveryOrderNumber: string, errors: ScrapeError[], orderIndex = -1,
): Promise<{ clientName: string; clientDocNumber: string; invoiceType: string; total: number; items: RawFalabellaItem[] }> {
  const viewUrl = `https://sellercenter.falabella.com/order/view/number/${deliveryOrderNumber}`;
  try {
    await dismissBlockingUi(page);
    const apiPromise = page.waitForResponse(
      r => r.url().includes(DETAIL_API + deliveryOrderNumber) && r.status() === 200,
      { timeout: 30000 },
    );
    await page.goto(viewUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissBlockingUi(page);
    const resp = await apiPromise;
    const json = await resp.json();
    const data = json.data || json;

    const grand = data.total?.grand || '0';
    const total = parseAmount(grand);

    const rawItems = Array.isArray(data.items) ? data.items : (data.items?.items || []);
    const items: RawFalabellaItem[] = rawItems.map((item: any) => ({
      sku: item.sellerSku || item.sku || '',
      name: item.product || item.name || item.productName || '',
      quantity: item.quantity || item.qty || 1,
      unitPrice: parseAmount(item.price || item.pricePaid || item.unitPrice || '0'),
    }));

    const clientName = data.address?.billing?.name || data.order?.customer || '';
    const clientDocNumber = data.order?.rut || '';
    const invoiceType = String(data.invoice?.invoiceType || '').toUpperCase();

    return { clientName, clientDocNumber, invoiceType, total, items };
  } catch (e: any) {
    errors.push({
      orderIndex,
      page: 0,
      reason: `detail ${deliveryOrderNumber}: ${e.message}`,
      step: 'leer_detalle',
      stepLabel: 'Leer detalle de ventas',
    });
    return { clientName: '', clientDocNumber: '', invoiceType: '', total: 0, items: [] };
  }
}

function parseAmount(raw: string): number {
  const cleaned = String(raw)
    .replace(/S\/\.?\s*/gi, '')
    .replace(/[^0-9,.\-]/g, '')
    .trim();
  if (!cleaned) return 0;
  const num = parseFloat(cleaned.replace(/,/g, ''));
  return isNaN(num) ? 0 : Math.round(num * 100) / 100;
}
