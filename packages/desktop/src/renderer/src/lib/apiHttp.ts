// Implementación HTTP de la misma superficie `api` que usa el renderer.
// Se usa cuando la UI corre en web (no hay window.electronAPI); apunta al backend @boletas/server.
const BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}
const qs = (o: Record<string, any> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const nope = (name: string) => () => { throw new Error(`"${name}" no está disponible en la versión web (solo desktop).`); };

const apiHttp = {
  // Empresas
  listCompanies: () => req('/companies'),
  getCompany: (id: number) => req(`/companies/${id}`),
  createCompany: (data: any) => req('/companies', { method: 'POST', body: JSON.stringify(data) }),
  updateCompany: (id: number, data: any) => req(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCompany: (id: number) => req(`/companies/${id}`, { method: 'DELETE' }),
  testSunatConnection: (id: number, environment: 'beta' | 'produccion') => req(`/companies/${id}/test-sunat`, { method: 'POST', body: JSON.stringify({ environment }) }),
  // Empresa activa: estado del cliente (localStorage en web)
  getActiveCompanyId: async () => { const v = localStorage.getItem('activeCompanyId'); return v ? Number(v) : null; },
  setActiveCompanyId: async (id: number | null) => { if (id == null) localStorage.removeItem('activeCompanyId'); else localStorage.setItem('activeCompanyId', String(id)); return id; },

  // Sucursales / correlativos
  listBranches: (companyId: number) => req(`/companies/${companyId}/branches`),
  createBranch: (data: any) => req('/branches', { method: 'POST', body: JSON.stringify(data) }),
  updateBranch: (id: number, data: any) => req(`/branches/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getCorrelatives: (branchId: number) => req(`/branches/${branchId}/correlatives`),

  // Listados
  listBoletas: (filter: any) => req(`/boletas${qs(filter)}`),
  listFacturas: (filter: any) => req(`/facturas${qs(filter)}`),
  listCreditNotes: (filter: any) => req(`/credit-notes${qs(filter)}`),
  listDailySummaries: (filter: any) => req(`/daily-summaries${qs(filter)}`),
  refreshDailySummaryStatus: (id: number) => req(`/daily-summaries/${id}/refresh`, { method: 'POST' }),

  // PDFs (base64) y previews (HTML)
  generateBoletaPdf: (id: number) => req(`/boletas/${id}/pdf`),
  previewAcceptedBoletaHtml: (id: number) => req(`/boletas/${id}/preview`),
  previewCreditNoteHtml: (id: number) => req(`/credit-notes/${id}/preview`),
  previewBoletaHtml: (companyId: number, venta: any) => req('/boletas/preview', { method: 'POST', body: JSON.stringify({ companyId, venta }) }),

  // Notas de crédito (emitir)
  createAndSendCreditNote: (boletaId: number, options?: any) => req('/credit-notes', { method: 'POST', body: JSON.stringify({ boletaId, options }) }),
  createAndSendCreditNotesBatch: (boletaIds: number[], options?: any) => req('/credit-notes/batch', { method: 'POST', body: JSON.stringify({ boletaIds, options }) }),

  // Workflow
  validateConfig: (config: any) => req('/workflow/validate-config', { method: 'POST', body: JSON.stringify(config) }),
  validateVentas: (ventas: any) => req('/workflow/validate-ventas', { method: 'POST', body: JSON.stringify(ventas) }),
  processWorkflow: (config: any, ventas: any) => req('/workflow/process', { method: 'POST', body: JSON.stringify({ config, ventas }) }),

  // Falabella — PENDIENTE: la lógica vive en desktop/main; hay que moverla a @boletas/core y exponerla.
  falabellaApiGetOrders: nope('falabellaApiGetOrders'),
  falabellaApiMonthSummary: nope('falabellaApiMonthSummary'),
  falabellaApiGetOrderItems: nope('falabellaApiGetOrderItems'),
  falabellaApiBuildBoletaVenta: nope('falabellaApiBuildBoletaVenta'),
  falabellaApiResolveOrderIds: nope('falabellaApiResolveOrderIds'),
  falabellaApiResolveDocument: nope('falabellaApiResolveDocument'),
  falabellaApiUploadInvoicePdf: nope('falabellaApiUploadInvoicePdf'),
  falabellaApiUploadBoletaPdf: nope('falabellaApiUploadBoletaPdf'),

  // Solo desktop (FS / diálogos / scraper): no aplican en web.
  onProgress: () => {},
  onScraperProgress: () => {},
};

export default apiHttp;
