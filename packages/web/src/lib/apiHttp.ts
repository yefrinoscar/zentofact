// Cliente HTTP del frontend web; apunta al backend @zentofact/server.
// Vacío = mismo origen (el front se sirve desde el propio server). En dev se puede fijar VITE_API_URL.
const BASE = (import.meta as any).env?.VITE_API_URL || '';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let csrfToken = '';

function rememberCsrfToken(data: any) {
  if (data?.csrfToken && typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
}

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  const res = await fetch(`${BASE}/me`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.csrfToken) throw new Error((data && data.error) || 'No se pudo validar la sesión');
  rememberCsrfToken(data);
  return csrfToken;
}

async function req(path: string, init?: RequestInit) {
  const method = String(init?.method || 'GET').toUpperCase();
  const csrfHeaders = UNSAFE_METHODS.has(method)
    ? { 'x-csrf-token': await ensureCsrfToken() }
    : {};
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders, ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (parseError: any) {
    console.error('[REQ JSON PARSE ERROR]', path, res.status, 'response text:', text?.slice(0, 500));
    throw new Error(`Error al parsear respuesta de ${path}: ${parseError?.message}. Response: ${text?.slice(0, 200)}`);
  }
  rememberCsrfToken(data);
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}
const qs = (o: Record<string, any> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// Handler de progreso registrado por la UI (via onProgress). El stream de /workflow/process lo alimenta.
let progressHandler: ((data: any) => void) | null = null;

const apiHttp = {
  // Sesión y usuarios
  getMe: () => req('/me'),
  listUsers: () => req('/users'),
  createUser: (data: any) => req('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: any) => req(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id: string) => req(`/users/${id}`, { method: 'DELETE' }),
  usersCatalog: () => req('/users/meta/catalog'),

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
  refreshBoletaStatus: (id: number) => req(`/boletas/${id}/refresh-status`, { method: 'POST' }),
  refreshFacturaStatus: (id: number) => req(`/facturas/${id}/refresh-status`, { method: 'POST' }),

  // Boletas (emitir individual)
  createBoleta: (input: any) => req('/boletas', { method: 'POST', body: JSON.stringify({ input }) }),
  sendBoletaToSunat: (id: number) => req(`/boletas/${id}/send`, { method: 'POST' }),
  reEmitBoleta: (id: number) => req(`/boletas/${id}/reemit`, { method: 'POST' }),

  // Facturas (emitir individual)
  createFactura: (input: any) => req('/facturas', { method: 'POST', body: JSON.stringify({ input }) }),
  sendFacturaToSunat: (id: number) => req(`/facturas/${id}/send`, { method: 'POST' }),
  reEmitFactura: (id: number) => req(`/facturas/${id}/reemit`, { method: 'POST' }),

  // PDFs (base64) y previews (HTML)
  generateBoletaPdf: (id: number) => req(`/boletas/${id}/pdf`),
  generateFacturaPdf: (id: number) => req(`/facturas/${id}/pdf`),
  previewAcceptedBoletaHtml: (id: number) => req(`/boletas/${id}/preview`),
  previewAcceptedFacturaHtml: (id: number) => req(`/facturas/${id}/preview`),
  previewCreditNoteHtml: (id: number) => req(`/credit-notes/${id}/preview`),
  previewBoletaHtml: (companyId: number, venta: any) => req('/boletas/preview', { method: 'POST', body: JSON.stringify({ companyId, venta }) }),
  previewFacturaHtml: (companyId: number, venta: any) => req('/facturas/preview', { method: 'POST', body: JSON.stringify({ companyId, venta }) }),

  // Notas de crédito (emitir)
  createAndSendCreditNote: (boletaId: number, options?: any) => req('/credit-notes', { method: 'POST', body: JSON.stringify({ boletaId, options }) }),
  createAndSendCreditNotesBatch: (boletaIds: number[], options?: any) => req('/credit-notes/batch', { method: 'POST', body: JSON.stringify({ boletaIds, options }) }),

  // Workflow (emisión en lote)
  validateConfig: (config: any) => req('/workflow/validate-config', { method: 'POST', body: JSON.stringify(config) }),
  validateVentas: (ventas: any) => req('/workflow/validate-ventas', { method: 'POST', body: JSON.stringify(ventas) }),
  processWorkflow: async (config: any, ventas: any) => {
    const token = await ensureCsrfToken();
    const res = await fetch(`${BASE}/workflow/process`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ config, ventas }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      return data;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: any = null;
    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: any;
      try { msg = JSON.parse(trimmed); } catch { return; }
      if (msg.type === 'progress') progressHandler?.({ current: msg.current, total: msg.total, status: msg.status });
      else if (msg.type === 'result') finalResult = msg.result;
      else if (msg.type === 'error') throw new Error(msg.error || 'Error en el workflow');
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    }
    if (buffer) handleLine(buffer);
    return { success: true, result: finalResult };
  },

  // Falabella
  falabellaApiGetOrders: (companyId: number, filters: any) => req(`/falabella/${companyId}/orders${qs({ filters: JSON.stringify(filters) })}`),
  falabellaApiGetProducts: (companyId: number, filters: any) => req(`/falabella/${companyId}/products${qs({ filters: JSON.stringify(filters) })}`),
  falabellaApiCreateProduct: (companyId: number, product: any) => req(`/falabella/${companyId}/products`, { method: 'POST', body: JSON.stringify(product) }),
  falabellaApiGetFeeds: (companyId: number, filters: any) => req(`/falabella/${companyId}/feeds${qs({ filters: JSON.stringify(filters) })}`),
  falabellaApiGetFeedStatus: (companyId: number, feedId: string) => req(`/falabella/${companyId}/feeds/${encodeURIComponent(feedId)}`),
  falabellaApiMonthSummary: (companyId: number, month: string) => req(`/falabella/${companyId}/month-summary${qs({ month })}`),
  falabellaApiGetOrderItems: (companyId: number, orderId: string | number) => req(`/falabella/${companyId}/orders/${orderId}/items`),
  falabellaApiBuildBoletaVenta: (companyId: number, order: any) => req(`/falabella/${companyId}/build-boleta-venta`, { method: 'POST', body: JSON.stringify({ order }) }),
  falabellaApiBuildFacturaVenta: (companyId: number, order: any) => req(`/falabella/${companyId}/build-factura-venta`, { method: 'POST', body: JSON.stringify({ order }) }),
  falabellaApiResolveOrderIds: (payload: any) => req(`/falabella/${payload.companyId}/resolve-order-ids`, { method: 'POST', body: JSON.stringify({ entries: payload.entries }) }),
  falabellaApiResolveDocument: (companyId: number, orderNumber: string) => req(`/falabella/${companyId}/resolve-document${qs({ orderNumber })}`),
  falabellaApiUploadInvoicePdf: (payload: any) => req('/falabella/upload-invoice-pdf', { method: 'POST', body: JSON.stringify(payload) }),
  falabellaApiUploadBoletaPdf: (payload: any) => req('/falabella/upload-boleta-pdf', { method: 'POST', body: JSON.stringify(payload) }),

  // Emisión automática
  autoEmitGetConfig: () => req('/auto-emit/config'),
  autoEmitSetCompany: (companyId: number, enabled: boolean) => req(`/auto-emit/config/${companyId}`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  autoEmitJobs: (limit = 50) => req(`/auto-emit/jobs${qs({ limit })}`),
  autoEmitEvents: (limit = 50) => req(`/auto-emit/events${qs({ limit })}`),
  autoEmitRun: (limit = 5) => req(`/auto-emit/run${qs({ limit })}`, { method: 'POST' }),
  autoEmitSetPaused: (paused: boolean) => req('/auto-emit/pause', { method: 'POST', body: JSON.stringify({ paused }) }),
  autoEmitSetCron: (cfg: { enabled?: boolean; intervalMinutes?: number; windowDays?: number }) => req('/auto-emit/cron', { method: 'POST', body: JSON.stringify(cfg) }),
  autoEmitSetDryRun: (dryRun: boolean) => req('/auto-emit/dry-run', { method: 'POST', body: JSON.stringify({ dryRun }) }),
  autoEmitRetryJob: (id: number) => req(`/auto-emit/jobs/${id}/retry`, { method: 'POST' }),
  autoEmitOrderPreview: (id: number) => req(`/auto-emit/jobs/${id}/order-preview`),
  autoEmitGetWebhooks: (companyId: number, ids?: string[]) => req(`/auto-emit/webhooks/${companyId}${qs({ ids: ids?.join(',') })}`),
  autoEmitCreateWebhook: (companyId: number, events: string[], callbackUrl?: string) => req(`/auto-emit/webhooks/${companyId}`, { method: 'POST', body: JSON.stringify({ events, callbackUrl }) }),
  autoEmitDeleteWebhook: (companyId: number, webhookId: string) => req(`/auto-emit/webhooks/${companyId}/${encodeURIComponent(webhookId)}`, { method: 'DELETE' }),

  onProgress: (cb: (data: any) => void) => { progressHandler = cb; },
};

export default apiHttp;
