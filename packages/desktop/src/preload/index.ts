import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  validateConfig: (config: any) => ipcRenderer.invoke('validate-config', config),
  validateVentas: (ventas: any) => ipcRenderer.invoke('validate-ventas', ventas),
  processWorkflow: (config: any, ventas: any) =>
    ipcRenderer.invoke('process-workflow', config, ventas),
  selectCertificate: () => ipcRenderer.invoke('select-certificate'),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  selectInputFile: () => ipcRenderer.invoke('select-input-file'),
  selectPdfFile: () => ipcRenderer.invoke('select-pdf-file'),
  selectSaveFile: () => ipcRenderer.invoke('select-save-file'),
  readInputFile: (filePath: string) => ipcRenderer.invoke('read-input-file', filePath),
  readTextFile: (filePath: string) => ipcRenderer.invoke('read-text-file', filePath),
  readFileDataUrl: (filePath: string) => ipcRenderer.invoke('read-file-data-url', filePath),
  readCertBase64: (filePath: string) => ipcRenderer.invoke('read-cert-base64', filePath),
  readFileBase64: (filePath: string) => ipcRenderer.invoke('read-file-base64', filePath),
  readCertFile: (filePath: string) => ipcRenderer.invoke('read-cert-file', filePath),
  openOutputDir: (dirPath: string) => ipcRenderer.invoke('open-output-dir', dirPath),
  onProgress: (callback: (data: { current: number; total: number; status: string }) => void) => {
    ipcRenderer.on('workflow-progress', (_e: any, data: any) => callback(data));
  },

  // Company CRUD
  listCompanies: () => ipcRenderer.invoke('company:list'),
  getCompany: (id: number) => ipcRenderer.invoke('company:get', id),
  createCompany: (data: any) => ipcRenderer.invoke('company:create', data),
  updateCompany: (id: number, data: any) => ipcRenderer.invoke('company:update', id, data),
  deleteCompany: (id: number) => ipcRenderer.invoke('company:delete', id),
  testSunatConnection: (id: number, environment: 'beta' | 'produccion') => ipcRenderer.invoke('company:test-sunat', id, environment),
  getActiveCompanyId: () => ipcRenderer.invoke('company:get-active'),
  setActiveCompanyId: (id: number | null) => ipcRenderer.invoke('company:set-active', id),
  falabellaApiGetOrders: (companyId: number, filters: any) => ipcRenderer.invoke('falabella-api:get-orders', { companyId, filters }),
  falabellaApiMonthSummary: (companyId: number, month: string) => ipcRenderer.invoke('falabella-api:month-summary', { companyId, month }),
  falabellaApiGetOrderItems: (companyId: number, orderId: string | number) => ipcRenderer.invoke('falabella-api:get-order-items', { companyId, orderId }),
  falabellaApiBuildBoletaVenta: (companyId: number, order: any) => ipcRenderer.invoke('falabella-api:build-boleta-venta', { companyId, order }),
  falabellaApiResolveOrderIds: (payload: any) => ipcRenderer.invoke('falabella-api:resolve-order-ids', payload),
  falabellaApiResolveDocument: (companyId: number, orderNumber: string) => ipcRenderer.invoke('falabella-api:resolve-document', { companyId, orderNumber }),
  falabellaApiUploadInvoicePdf: (payload: any) => ipcRenderer.invoke('falabella-api:upload-invoice-pdf', payload),
  falabellaApiUploadBoletaPdf: (payload: any) => ipcRenderer.invoke('falabella-api:upload-boleta-pdf', payload),

  // Branch
  listBranches: (companyId: number) => ipcRenderer.invoke('branch:list', companyId),
  createBranch: (data: any) => ipcRenderer.invoke('branch:create', data),
  updateBranch: (id: number, data: any) => ipcRenderer.invoke('branch:update', id, data),

  // Boletas y facturas
  listBoletas: (filter: any) => ipcRenderer.invoke('boletas:list', filter),
  createBoleta: (input: any) => ipcRenderer.invoke('boletas:create', input),
  sendBoletaToSunat: (id: number) => ipcRenderer.invoke('boletas:send', id),
  listFacturas: (filter: any) => ipcRenderer.invoke('facturas:list', filter),
  createFactura: (input: any) => ipcRenderer.invoke('facturas:create', input),
  sendFacturaToSunat: (id: number) => ipcRenderer.invoke('facturas:send', id),
  generateBoletaPdf: (id: number, outputDir?: string) => ipcRenderer.invoke('boletas:generate-pdf', id, outputDir),
  generateFacturaPdf: (id: number, outputDir?: string) => ipcRenderer.invoke('facturas:generate-pdf', id, outputDir),
  previewBoletaHtml: (companyId: number, venta: any) => ipcRenderer.invoke('boletas:preview-html', companyId, venta),
  previewFacturaHtml: (companyId: number, venta: any) => ipcRenderer.invoke('facturas:preview-html', companyId, venta),
  previewAcceptedBoletaHtml: (id: number) => ipcRenderer.invoke('boletas:preview-accepted-html', id),
  previewCreditNoteHtml: (id: number) => ipcRenderer.invoke('credit-notes:preview-html', id),
  createAndSendCreditNote: (boletaId: number, options?: { codMotivo?: string; desMotivo?: string; modoProduccion?: boolean }) =>
    ipcRenderer.invoke('credit-notes:create-and-send', boletaId, options),
  createAndSendCreditNotesBatch: (boletaIds: number[], options?: { codMotivo?: string; desMotivo?: string; modoProduccion?: boolean }) =>
    ipcRenderer.invoke('credit-notes:create-and-send-batch', boletaIds, options),
  listDailySummaries: (filter: any) => ipcRenderer.invoke('daily-summaries:list', filter),
  refreshDailySummaryStatus: (id: number) => ipcRenderer.invoke('daily-summaries:refresh-status', id),
  generateDailySummaryPdfs: (id: number, outputDir?: string) => ipcRenderer.invoke('daily-summaries:generate-pdfs', id, outputDir),
  openFolder: (dirPath: string) => ipcRenderer.invoke('open-output-dir', dirPath),

  // Correlatives
  getCorrelatives: (branchId: number) => ipcRenderer.invoke('correlatives:get', branchId),

  // Scraper
  scraperInit: (config: any) => ipcRenderer.invoke('scraper:init', config),
  scraperGetState: () => ipcRenderer.invoke('scraper:get-state'),
  scraperStepAbrir: () => ipcRenderer.invoke('scraper:step-abrir'),
  scraperStepLogin: () => ipcRenderer.invoke('scraper:step-login'),
  scraperStepFiltrar: () => ipcRenderer.invoke('scraper:step-filtrar'),
  scraperStepLeer: () => ipcRenderer.invoke('scraper:step-leer'),
  scraperStepExportar: () => ipcRenderer.invoke('scraper:step-exportar'),
  scraperStepConvertir: () => ipcRenderer.invoke('scraper:step-convertir'),
  scraperGetVentas: () => ipcRenderer.invoke('scraper:get-ventas'),
  scraperRunAll: () => ipcRenderer.invoke('scraper:run-all'),
  scraperCleanup: () => ipcRenderer.invoke('scraper:cleanup'),
  scraperLoadOrders: (filePath: string) => ipcRenderer.invoke('scraper:load-orders', filePath),
  scraperConvertOrders: (orders: any[]) => ipcRenderer.invoke('scraper:convert-orders', orders),
  scraperExportOrders: (filePath: string, ventas: any[]) => ipcRenderer.invoke('scraper:export-orders', { filePath, ventas }),
  onScraperProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('scraper:step-progress', (_e: any, data: any) => callback(data));
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
