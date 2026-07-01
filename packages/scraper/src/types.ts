export interface SiteProfile {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  usernameSubmitSelector?: string;
  loginSuccessIndicator: string;
  salesUrl: string;
  saleRowSelector: string;
}

export interface ScraperConfig {
  sellerUrl: string;
  username: string;
  password: string;
  headless?: boolean;
  /** Canal de navegador del sistema (p.ej. 'msedge' o 'chrome'). Si se define,
   * Playwright usa ese navegador instalado en vez de descargar Chromium. */
  channel?: string;
  slowMo?: number;
  authStatePath?: string;
  outputDir: string;
  dateFrom?: string;
  dateTo?: string;
  siteProfile?: Partial<SiteProfile>;
}

export interface RawFalabellaItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface RawFalabellaOrder {
  orderNumber: string;
  sellerOrderNumber?: string;
  purchaseDate: string;
  invoiceType?: string;
  clientDocNumber: string;
  clientName: string;
  total: number;
  items: RawFalabellaItem[];
}

export interface FalabellaExtract {
  extractedAt: string;
  config: Omit<ScraperConfig, 'password'>;
  totalOrders: number;
  orders: RawFalabellaOrder[];
}

export interface ScrapeError {
  orderIndex: number;
  page: number;
  reason: string;
  step?: string;
  stepLabel?: string;
  screenshotPath?: string;
  htmlPath?: string;
}
