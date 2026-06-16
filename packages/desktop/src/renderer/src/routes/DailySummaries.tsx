import { useEffect, useMemo, useState } from 'react';
import { Building2, FileStack, FileText, FolderOpen, Maximize2, RefreshCw, Search, Upload, X } from 'lucide-react';
import { Loading } from '../components/Loading';
import api from '../lib/api';

const OUTPUT_DIR_KEY = 'boletas.outputDir';
const BOLETAS_PAGE_SIZE = 10;

const statusClass: Record<string, string> = {
  ACEPTADO: 'bg-emerald-100 text-emerald-700',
  ANULADO: 'bg-slate-200 text-slate-700',
  CDR_RECIBIDO: 'bg-emerald-100 text-emerald-700',
  ENVIADO: 'bg-sky-100 text-sky-700',
  EN_PROCESO: 'bg-amber-100 text-amber-700',
  ENVIANDO: 'bg-sky-100 text-sky-700',
  RECHAZADO: 'bg-rose-100 text-rose-700',
  ERROR: 'bg-rose-100 text-rose-700',
};

type FalabellaBatchResult = {
  boletaId: number;
  numeroCompleto: string;
  orderNumber: string;
  ok?: boolean;
  skipped?: boolean;
  status?: number;
  orderId?: string | number;
  error?: any;
  orderItemIds?: string[];
};

type FalabellaBatchCandidate = {
  id: number;
  numeroCompleto: string;
  orderNumber: string;
  fechaEmision: string;
  estadoSunat: string;
  pdfPath: string;
  orderId?: string | number;
  reason?: string;
};

function getCompanyAccountLabel(company: any) {
  return company?.nombre || company?.razonSocial || 'Empresa sin nombre';
}

function getCompanySunatLabel(company: any) {
  const name = company?.razonSocial || company?.nombre || 'Empresa sin nombre';
  return `${name}${company?.ruc ? ` (${company.ruc})` : ''}`;
}

function getCompanyFullLabel(company: any) {
  if (!company) return '-';
  return `${getCompanyAccountLabel(company)} · SUNAT: ${getCompanySunatLabel(company)}`;
}

export default function DailySummaries() {
  const [data, setData] = useState<any>({ summaries: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | ''>('');
  const [estado, setEstado] = useState('');
  const [boletaPages, setBoletaPages] = useState<Record<number, number>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);
  const [summaryPdfLoadingId, setSummaryPdfLoadingId] = useState<number | null>(null);
  const [outputDir, setOutputDir] = useState('');
  const [sunatModal, setSunatModal] = useState<{ title: string; text: string } | null>(null);
  const [falabellaBatchPreview, setFalabellaBatchPreview] = useState<{
    summary: any;
    companyLabel: string;
    validating: boolean;
    error: string;
    eligible: FalabellaBatchCandidate[];
    skipped: FalabellaBatchCandidate[];
    debug?: any;
  } | null>(null);
  const [falabellaBatch, setFalabellaBatch] = useState<{
    summaryId: number;
    summaryNumero: string;
    companyLabel: string;
    running: boolean;
    current: number;
    total: number;
    currentLabel: string;
    results: FalabellaBatchResult[];
  } | null>(null);
  const companyMap = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  );

  const load = () => {
    setLoading(true);
    api.listDailySummaries({
      companyId: selectedCompanyId || undefined,
      estado: estado || undefined,
      limit: 100,
    })
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.listCompanies().then((list: any[]) => {
      setCompanies(Array.isArray(list) ? list : []);
    });
    const savedOutputDir = localStorage.getItem(OUTPUT_DIR_KEY);
    if (savedOutputDir) {
      setOutputDir(savedOutputDir);
    } else {
      api.getHomeDir().then((home: string) => setOutputDir(`${home}/boletas-emitidas`)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    load();
  }, [selectedCompanyId, estado]);

  const refreshStatus = async (id: number) => {
    setLoadingId(id);
    try {
      await api.refreshDailySummaryStatus(id);
      load();
    } finally {
      setLoadingId(null);
    }
  };

  const generatePdf = async (boletaId: number) => {
    setPdfLoadingId(boletaId);
    try {
      await api.generateBoletaPdf(boletaId, outputDir || undefined);
      load();
    } catch (error: any) {
      setSunatModal({
        title: 'Error al generar PDF',
        text: error?.message || 'No se pudo generar el PDF de la boleta.',
      });
    } finally {
      setPdfLoadingId(null);
    }
  };

  const generateSummaryPdfs = async (summaryId: number) => {
    setSummaryPdfLoadingId(summaryId);
    try {
      const result = await api.generateDailySummaryPdfs(summaryId, outputDir || undefined);
      load();
      if (!result?.generated?.length) {
        setSunatModal({
          title: 'PDFs no generados',
          text: 'El resumen no devolvió PDFs generados.',
        });
      }
    } catch (error: any) {
      setSunatModal({
        title: 'Error al generar PDFs',
        text: error?.message || 'No se pudieron generar los PDFs del resumen.',
      });
    } finally {
      setSummaryPdfLoadingId(null);
    }
  };

  const openFolder = async (folder: string) => {
    if (!folder) return;
    await api.openFolder(folder);
  };

  const getBoletaPage = (summaryId: number) => boletaPages[summaryId] || 1;

  const setBoletaPage = (summaryId: number, page: number) => {
    setBoletaPages((current) => ({ ...current, [summaryId]: page }));
  };

  const getSummaryBoletaCandidates = (summary: any) => {
    const eligible: FalabellaBatchCandidate[] = [];
    const skipped: FalabellaBatchCandidate[] = [];

    for (const boleta of (summary.boletas || [])) {
      const base: FalabellaBatchCandidate = {
        id: boleta.id,
        numeroCompleto: boleta.numeroCompleto,
        orderNumber: boleta.orderNumber || '',
        fechaEmision: boleta.fechaEmision,
        estadoSunat: boleta.estadoSunat,
        pdfPath: boleta.pdfPath || '',
      };

      if (boleta.estadoSunat !== 'ACEPTADO') {
        skipped.push({ ...base, reason: 'Estado SUNAT distinto de ACEPTADO' });
        continue;
      }
      if (!boleta.pdfPath) {
        skipped.push({ ...base, reason: 'Falta PDF generado' });
        continue;
      }
      if (!boleta.orderNumber) {
        skipped.push({ ...base, reason: 'Falta orderNumber' });
        continue;
      }

      eligible.push(base);
    }

    return { eligible, skipped };
  };

  const getEligibleSummaryBoletas = (summary: any) => getSummaryBoletaCandidates(summary).eligible;

  const openFalabellaBatchPreview = async (summary: any) => {
    const summaryCompany = companyMap.get(summary.companyId);
    const companyLabel = getCompanyFullLabel(summaryCompany);
    const candidates = getSummaryBoletaCandidates(summary);

    setFalabellaBatchPreview({
      summary,
      companyLabel,
      validating: true,
      error: '',
      eligible: candidates.eligible,
      skipped: candidates.skipped,
    });

    try {
      const response = await api.falabellaApiResolveOrderIds({
        companyId: summary.companyId,
        entries: candidates.eligible.map((boleta) => ({
          orderNumber: boleta.orderNumber,
          invoiceDate: boleta.fechaEmision,
        })),
      });

      if (response?.error) {
        setFalabellaBatchPreview((current) => current ? {
          ...current,
          validating: false,
          error: String(response.error),
        } : current);
        return;
      }

      const resolvedMap = new Map(
        (response?.results || []).map((row: any) => [
          `${row.orderNumber}::${row.invoiceDate}`,
          row,
        ]),
      );

      const validatedEligible: FalabellaBatchCandidate[] = [];
      const validatedSkipped: FalabellaBatchCandidate[] = [...candidates.skipped];

      for (const boleta of candidates.eligible) {
        const resolved = resolvedMap.get(`${boleta.orderNumber}::${boleta.fechaEmision}`);
        if (!resolved?.found || !resolved?.orderId) {
          validatedSkipped.push({ ...boleta, reason: 'No se encontró OrderId en Falabella para esa fecha' });
          continue;
        }
        if (resolved?.invoiceRequired) {
          validatedSkipped.push({ ...boleta, orderId: resolved.orderId, reason: 'Falabella marca la orden como FACTURA' });
          continue;
        }
        validatedEligible.push({ ...boleta, orderId: resolved.orderId });
      }

      setFalabellaBatchPreview((current) => current ? {
        ...current,
        validating: false,
        eligible: validatedEligible,
        skipped: validatedSkipped,
        debug: response?.debug || null,
      } : current);
    } catch (error: any) {
      setFalabellaBatchPreview((current) => current ? {
        ...current,
        validating: false,
        error: error?.message || 'No se pudo validar las órdenes en Falabella.',
      } : current);
    }
  };

  const uploadSummaryBoletas = async (summary: any, eligibleBoletasInput?: FalabellaBatchCandidate[]) => {
    const summaryCompany = companyMap.get(summary.companyId);
    const companyLabel = getCompanyFullLabel(summaryCompany);
    const eligibleBoletas = eligibleBoletasInput || getSummaryBoletaCandidates(summary).eligible;

    setFalabellaBatch({
      summaryId: summary.id,
      summaryNumero: summary.numeroCompleto,
      companyLabel,
      running: eligibleBoletas.length > 0,
      current: 0,
      total: eligibleBoletas.length,
      currentLabel: '',
      results: [],
    });

    if (!eligibleBoletas.length) {
      return;
    }

    for (let index = 0; index < eligibleBoletas.length; index += 1) {
      const boleta = eligibleBoletas[index];

      setFalabellaBatch((current) => current ? {
        ...current,
        current: index,
        currentLabel: `${boleta.numeroCompleto} · orden ${boleta.orderNumber}`,
      } : current);

      try {
        const response = await api.falabellaApiUploadBoletaPdf({
          companyId: summary.companyId,
          boletaId: boleta.id,
          orderNumber: boleta.orderNumber,
          orderId: boleta.orderId,
          invoiceNumber: boleta.numeroCompleto,
          invoiceDate: boleta.fechaEmision,
          pdfPath: boleta.pdfPath,
        });

        setFalabellaBatch((current) => current ? {
          ...current,
          current: index + 1,
          results: [
            ...current.results,
            {
              boletaId: boleta.id,
              numeroCompleto: boleta.numeroCompleto,
              orderNumber: boleta.orderNumber,
              ok: response?.ok,
              skipped: response?.skipped,
              status: response?.status,
              orderId: response?.orderId,
              error: response?.error,
              orderItemIds: response?.orderItemIds,
            },
          ],
        } : current);
      } catch (error: any) {
        setFalabellaBatch((current) => current ? {
          ...current,
          current: index + 1,
          results: [
            ...current.results,
            {
              boletaId: boleta.id,
              numeroCompleto: boleta.numeroCompleto,
              orderNumber: boleta.orderNumber,
              ok: false,
              error: error?.message || 'No se pudo subir la boleta a Falabella.',
            },
          ],
        } : current);
      }
    }

    setFalabellaBatch((current) => current ? {
      ...current,
      running: false,
      currentLabel: '',
    } : current);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        {companies.length > 0 ? (
          <select
            value={selectedCompanyId ? String(selectedCompanyId) : ''}
            onChange={(e) => setSelectedCompanyId(e.target.value ? Number(e.target.value) : '')}
            className="min-w-[320px] rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring"
          >
            <option value="">Todas las empresas</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.nombre || company.razonSocial} ({company.ruc})
              </option>
            ))}
          </select>
        ) : (
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            <Building2 className="mr-2 inline h-4 w-4" />
            No hay empresas registradas.
          </div>
        )}
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring"
        >
          <option value="">Todos los estados</option>
          <option value="ACEPTADO">Aceptado</option>
          <option value="ANULADO">Anulado</option>
          <option value="ENVIADO">Enviado</option>
          <option value="EN_PROCESO">En proceso</option>
          <option value="RECHAZADO">Rechazado</option>
          <option value="ERROR">Error</option>
        </select>

        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-accent"
        >
          <Search className="h-4 w-4" /> Buscar
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <Loading label="Cargando resúmenes diarios..." />
        ) : data.summaries.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No se encontraron resúmenes diarios.</div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {data.summaries.map((summary: any) => (
              <section key={summary.id} className="p-4">
                {(() => {
                  const summaryCompany = companyMap.get(summary.companyId);
                  const summaryAccountLabel = getCompanyAccountLabel(summaryCompany);
                  const summarySunatLabel = getCompanySunatLabel(summaryCompany);
                  const boletaCount = Number(summary.boletaCount ?? summary.boletas?.length ?? 0);
                  const currentBoletaPage = getBoletaPage(summary.id);
                  const totalBoletaPages = Math.max(1, Math.ceil(((summary.boletas || []).length || 0) / BOLETAS_PAGE_SIZE));
                  const paginatedBoletas = (summary.boletas || []).slice(
                    (currentBoletaPage - 1) * BOLETAS_PAGE_SIZE,
                    currentBoletaPage * BOLETAS_PAGE_SIZE,
                  );
                  const boletaStart = (summary.boletas || []).length === 0 ? 0 : (currentBoletaPage - 1) * BOLETAS_PAGE_SIZE + 1;
                  const boletaEnd = Math.min(currentBoletaPage * BOLETAS_PAGE_SIZE, (summary.boletas || []).length || 0);
                  return (
                    <>
                <div className="grid gap-3 xl:grid-cols-[minmax(220px,1.2fr)_minmax(170px,.9fr)_minmax(130px,.6fr)_minmax(190px,1fr)_minmax(190px,.9fr)]">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Cuenta</div>
                    <div className="text-sm break-words">{summaryAccountLabel}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground break-words">SUNAT: {summarySunatLabel}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Resumen</div>
                    <div className="font-mono text-sm">{summary.numeroCompleto}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Boletas</div>
                    <div className="text-sm font-semibold">{boletaCount}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Ticket</div>
                    <div className="font-mono text-xs">{summary.ticket || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Estado</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[summary.estado] || 'bg-slate-100 text-slate-700'}`}>
                        {summary.estado || 'PENDIENTE'}
                      </span>
                      <button
                        onClick={() => refreshStatus(summary.id)}
                        disabled={!summary.ticket || loadingId === summary.id}
                        aria-label="Consultar estado SUNAT"
                        title="Consultar estado SUNAT"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border transition hover:bg-accent disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${loadingId === summary.id ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-xs font-medium text-muted-foreground">Respuesta SUNAT</div>
                  <div className="mt-1 flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground">
                    <div className="min-w-0 flex-1 break-words leading-6">
                      <span className="font-mono">{summary.responseCode || '-'}</span>
                      <span className="ml-2 text-muted-foreground">
                        {summary.responseDescription
                          ? summary.responseDescription.length > 220
                            ? `${summary.responseDescription.slice(0, 220)}...`
                            : summary.responseDescription
                          : 'Sin respuesta registrada'}
                      </span>
                    </div>
                    {summary.responseDescription && summary.responseDescription.length > 220 && (
                      <button
                        onClick={() => setSunatModal({
                          title: `${summary.numeroCompleto}${summaryCompanyLabel !== '-' ? ` · ${summaryCompanyLabel}` : ''} · Respuesta SUNAT`,
                          text: `${summary.responseCode ? `${summary.responseCode} - ` : ''}${summary.responseDescription}`,
                        })}
                        aria-label="Ver respuesta completa"
                        title="Ver respuesta completa"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border transition hover:bg-accent"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => generateSummaryPdfs(summary.id)}
                    disabled={summary.estado !== 'ACEPTADO' || summaryPdfLoadingId === summary.id}
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    <FileStack className={`h-3.5 w-3.5 ${summaryPdfLoadingId === summary.id ? 'animate-pulse' : ''}`} />
                    {summaryPdfLoadingId === summary.id
                      ? 'Generando...'
                      : summary.pdfFolder
                      ? `PDFs generados (${(summary.boletas || []).filter((boleta: any) => boleta.pdfPath).length}/${summary.boletas?.length || 0})`
                      : 'Generar PDFs'}
                  </button>
                  <button
                    onClick={() => openFolder(summary.pdfFolder)}
                    disabled={!summary.pdfFolder}
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Abrir carpeta
                  </button>
                  <button
                    onClick={() => void openFalabellaBatchPreview(summary)}
                    disabled={summary.estado !== 'ACEPTADO' || getEligibleSummaryBoletas(summary).length === 0 || !!falabellaBatch?.running}
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Subir a Falabella ({getEligibleSummaryBoletas(summary).length})
                  </button>
                </div>
                <div className="mt-2 min-w-0 text-xs text-muted-foreground">
                  Carpeta: <span className="break-all font-mono">{summary.pdfFolder || '-'}</span>
                </div>

                <div className="mt-4 overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/35">
                      <tr className="text-left">
                        <th className="p-2 font-medium text-muted-foreground">Boleta</th>
                        <th className="p-2 font-medium text-muted-foreground">Orden</th>
                        <th className="p-2 font-medium text-muted-foreground">Cliente</th>
                        <th className="p-2 font-medium text-muted-foreground">Fecha</th>
                        <th className="p-2 font-medium text-muted-foreground">Total</th>
                        <th className="p-2 font-medium text-muted-foreground">Estado</th>
                        <th className="p-2 font-medium text-muted-foreground">PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(summary.boletas || []).length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-3 text-center text-xs text-muted-foreground">
                            Este resumen no tiene boletas asociadas en la base local.
                          </td>
                        </tr>
                      ) : (
                        paginatedBoletas.map((boleta: any) => (
                          <tr key={boleta.id} className="border-t border-border/70">
                            <td className="p-2 font-mono text-xs">{boleta.numeroCompleto}</td>
                            <td className="p-2 font-mono text-xs">{boleta.orderNumber || '-'}</td>
                            <td className="p-2">
                              <div>{boleta.cliente || '-'}</div>
                              <div className="text-xs text-muted-foreground">{boleta.clienteDocumento || ''}</div>
                            </td>
                            <td className="p-2">{boleta.fechaEmision}</td>
                            <td className="p-2">S/ {parseFloat(boleta.total || '0').toFixed(2)}</td>
                            <td className="p-2">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[boleta.estadoSunat] || 'bg-slate-100 text-slate-700'}`}>
                                {boleta.estadoSunat}
                              </span>
                            </td>
                            <td className="p-2">
                              {boleta.pdfPath ? (
                                <span className="text-xs text-emerald-700">Generado</span>
                              ) : (
                                <button
                                  onClick={() => generatePdf(boleta.id)}
                                  disabled={boleta.estadoSunat !== 'ACEPTADO' || pdfLoadingId === boleta.id}
                                  aria-label="Generar PDF"
                                  title="Generar PDF"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border transition hover:bg-accent disabled:opacity-50"
                                >
                                  <FileText className={`h-3.5 w-3.5 ${pdfLoadingId === boleta.id ? 'animate-pulse' : ''}`} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {(summary.boletas || []).length > BOLETAS_PAGE_SIZE && (
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Mostrando {boletaStart} a {boletaEnd} de {(summary.boletas || []).length} boletas
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setBoletaPage(summary.id, Math.max(1, currentBoletaPage - 1))}
                        disabled={currentBoletaPage === 1}
                        className="rounded-lg border border-border px-3 py-1.5 font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="min-w-[92px] text-center">
                        Page {currentBoletaPage} / {totalBoletaPages}
                      </span>
                      <button
                        onClick={() => setBoletaPage(summary.id, Math.min(totalBoletaPages, currentBoletaPage + 1))}
                        disabled={currentBoletaPage >= totalBoletaPages}
                        className="rounded-lg border border-border px-3 py-1.5 font-medium transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
                    </>
                  );
                })()}
              </section>
              ))}
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {loading ? 'Cargando...' : `${data.total} resúmenes encontrados`}
      </p>

      {sunatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">{sunatModal.title}</h3>
              <button
                onClick={() => setSunatModal(null)}
                aria-label="Cerrar"
                title="Cerrar"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[65vh] overflow-auto p-4">
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-background p-4 text-xs leading-relaxed text-foreground">
                {sunatModal.text}
              </pre>
            </div>
          </div>
        </div>
      )}

      {falabellaBatchPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Validar subida a Falabella · {falabellaBatchPreview.summary.numeroCompleto}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{falabellaBatchPreview.companyLabel}</p>
              </div>
              <button
                onClick={() => setFalabellaBatchPreview(null)}
                aria-label="Cerrar"
                title="Cerrar"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-medium text-emerald-800">
                    {falabellaBatchPreview.eligible.length} boletas listas para subir
                  </p>
                  <p className="mt-1 text-xs text-emerald-700">
                    Reglas: `ACEPTADO`, con PDF, `orderNumber` y `OrderId` resuelto en Falabella.
                  </p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-800">
                    {falabellaBatchPreview.skipped.length} boletas se omitirán
                  </p>
                  <p className="mt-1 text-xs text-amber-700">
                    Se omiten antes de llamar a Falabella.
                  </p>
                </div>
              </div>

              {falabellaBatchPreview.validating && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
                  Validando la relación entre `orderNumber` y `OrderId` en Falabella por fecha de boleta...
                </div>
              )}

              {falabellaBatchPreview.error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {falabellaBatchPreview.error}
                </div>
              )}

              {falabellaBatchPreview.debug && !falabellaBatchPreview.validating && (
                <details className="rounded-lg border border-border bg-background">
                  <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                    Diagnóstico · {falabellaBatchPreview.debug.totalOrdersFound} órdenes encontradas en API
                  </summary>
                  <div className="space-y-2 border-t border-border px-4 py-3">
                    <div className="rounded-md bg-muted/30 p-2 text-xs">
                      <span className="font-medium">Cuenta Falabella:</span>{' '}
                      {falabellaBatchPreview.debug.company?.nombre || '-'}{' '}
                      <span className="text-muted-foreground">
                        (ID {falabellaBatchPreview.debug.company?.id || '-'})
                      </span>
                      <br />
                      <span className="font-medium">Emisor SUNAT:</span>{' '}
                      {falabellaBatchPreview.debug.company?.razonSocial || '-'}{' '}
                      <span className="text-muted-foreground">
                        (RUC {falabellaBatchPreview.debug.company?.ruc || '-'})
                      </span>
                      <br />
                      <span className="font-medium">API UserID:</span>{' '}
                      <span className="font-mono">{falabellaBatchPreview.debug.company?.falabellaApiUserId || '(sin configurar)'}</span>
                      <br />
                      <span className="font-medium">Fechas buscadas:</span>{' '}
                      {(falabellaBatchPreview.debug.searchedDates || []).join(', ')}
                    </div>
                    {Object.entries(falabellaBatchPreview.debug.searchesByDate || {}).map(([date, lines]) => (
                      <div key={date} className="rounded-md bg-muted/30 p-2">
                        <div className="mb-1 text-xs font-medium">Fecha: {date}</div>
                        <div className="space-y-0.5">
                          {(lines as string[]).map((line, i) => (
                            <div key={i} className={`font-mono text-xs ${line.includes('Error') ? 'text-rose-600' : 'text-muted-foreground'}`}>
                              {line}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="border-b border-border bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground">
                    Boletas a subir
                  </div>
                  <div className="max-h-[40vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-background">
                        <tr className="text-left">
                          <th className="p-2 font-medium text-muted-foreground">Boleta</th>
                          <th className="p-2 font-medium text-muted-foreground">Orden</th>
                          <th className="p-2 font-medium text-muted-foreground">OrderId</th>
                          <th className="p-2 font-medium text-muted-foreground">Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {falabellaBatchPreview.eligible.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="p-4 text-center text-xs text-muted-foreground">
                              No hay boletas elegibles para este resumen.
                            </td>
                          </tr>
                        ) : (
                          falabellaBatchPreview.eligible.map((boleta) => (
                            <tr key={boleta.id} className="border-t border-border/70">
                              <td className="p-2 font-mono text-xs">{boleta.numeroCompleto}</td>
                              <td className="p-2 font-mono text-xs">{boleta.orderNumber}</td>
                              <td className="p-2 font-mono text-xs">{boleta.orderId || '-'}</td>
                              <td className="p-2 text-xs">{boleta.fechaEmision}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="border-b border-border bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground">
                    Boletas omitidas
                  </div>
                  <div className="max-h-[40vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-background">
                        <tr className="text-left">
                          <th className="p-2 font-medium text-muted-foreground">Boleta</th>
                          <th className="p-2 font-medium text-muted-foreground">Orden</th>
                          <th className="p-2 font-medium text-muted-foreground">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {falabellaBatchPreview.skipped.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="p-4 text-center text-xs text-muted-foreground">
                              No hay boletas omitidas.
                            </td>
                          </tr>
                        ) : (
                          falabellaBatchPreview.skipped.map((boleta) => (
                            <tr key={boleta.id} className="border-t border-border/70">
                              <td className="p-2 font-mono text-xs">{boleta.numeroCompleto}</td>
                              <td className="p-2 font-mono text-xs">{boleta.orderNumber || '-'}</td>
                              <td className="p-2 text-xs text-muted-foreground">{boleta.reason}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                <button
                  onClick={() => setFalabellaBatchPreview(null)}
                  className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const nextSummary = falabellaBatchPreview.summary;
                    const nextEligible = falabellaBatchPreview.eligible;
                    setFalabellaBatchPreview(null);
                    void uploadSummaryBoletas(nextSummary, nextEligible);
                  }}
                  disabled={falabellaBatchPreview.eligible.length === 0 || falabellaBatchPreview.validating || !!falabellaBatchPreview.error}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" />
                  Confirmar y subir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {falabellaBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Subida a Falabella · {falabellaBatch.summaryNumero}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{falabellaBatch.companyLabel}</p>
              </div>
              <button
                onClick={() => {
                  if (falabellaBatch.running) return;
                  setFalabellaBatch(null);
                }}
                aria-label="Cerrar"
                title="Cerrar"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border transition hover:bg-accent disabled:opacity-50"
                disabled={falabellaBatch.running}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {falabellaBatch.current} / {falabellaBatch.total} boletas procesadas
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {falabellaBatch.running
                        ? (falabellaBatch.currentLabel || 'Preparando siguiente boleta...')
                        : falabellaBatch.total
                          ? 'Proceso finalizado.'
                          : 'No hay boletas elegibles: deben estar ACEPTADO, con PDF y orderNumber.'}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Exitosas: {falabellaBatch.results.filter((row) => row.ok).length} ·
                    {' '}Omitidas: {falabellaBatch.results.filter((row) => row.skipped).length} ·
                    {' '}Fallidas: {falabellaBatch.results.filter((row) => !row.ok && !row.skipped).length}
                  </div>
                </div>
              </div>

              <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/35">
                    <tr className="text-left">
                      <th className="p-2 font-medium text-muted-foreground">Boleta</th>
                      <th className="p-2 font-medium text-muted-foreground">Orden</th>
                      <th className="p-2 font-medium text-muted-foreground">OrderId</th>
                      <th className="p-2 font-medium text-muted-foreground">Estado</th>
                      <th className="p-2 font-medium text-muted-foreground">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {falabellaBatch.results.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-xs text-muted-foreground">
                          {falabellaBatch.running ? 'Iniciando subida...' : 'Sin resultados todavía.'}
                        </td>
                      </tr>
                    ) : (
                      falabellaBatch.results.map((row) => (
                        <tr key={row.boletaId} className="border-t border-border/70">
                          <td className="p-2 font-mono text-xs">{row.numeroCompleto}</td>
                          <td className="p-2 font-mono text-xs">{row.orderNumber}</td>
                          <td className="p-2 font-mono text-xs">{row.orderId || '-'}</td>
                          <td className="p-2">
                            <span
                              className={
                                row.ok
                                  ? 'inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700'
                                  : row.skipped
                                    ? 'inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700'
                                    : 'inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700'
                              }
                            >
                              {row.ok ? 'Subido' : row.skipped ? 'Omitido' : 'Error'}
                            </span>
                          </td>
                          <td className="p-2 text-xs text-muted-foreground">
                            {typeof row.error === 'string'
                              ? row.error
                              : row.error?.Head?.ErrorMessage
                                ? row.error.Head.ErrorMessage
                                : row.ok
                                  ? `HTTP ${row.status || '-'} · ${row.orderItemIds?.length || 0} item(s)`
                                  : 'Sin detalle'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
