import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Download, FileCode2, Loader2, FileText, CheckCircle2, AlertCircle, Eye, RotateCcw, FileMinus2, RefreshCw, MoreHorizontal } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { useAppStore } from '../stores/app';
import { usePermissions } from '../hooks/usePermissions';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TablePanelFooter,
  TableRow,
} from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from '../components/ui/pagination';
import { buildDocumentStatsFromRows, hasCompleteDocumentStats, type DocumentStats } from '../lib/documentStats';
import { documentDateRangeLabel, parseDocumentDateRange, type DocumentDateRange } from '../lib/documentDateRange';
import DocumentDateRangePicker from '../components/DocumentDateRangePicker';

const DocumentOverview = lazy(() => import('../components/DocumentOverview'));

export type DocumentKind = 'boletas' | 'facturas';
type Doc = {
  id: number; companyId: number; numeroCompleto: string; fechaEmision: string; orderNumber?: string | null;
  clientRazonSocial?: string; clientNumeroDocumento?: string; mtoImpVenta?: string;
  estadoSunat?: string; estado?: string; respuestaSunat?: string;
  xmlPath?: string | null; cdrPath?: string | null;
  creditNoteId?: number | null; creditNoteNumeroCompleto?: string | null;
  creditNoteEstadoSunat?: string | null;
};

function sunatReason(d: Doc): string {
  const raw = d.respuestaSunat;
  if (!raw) return '';
  let msg = raw;
  try {
    const p = JSON.parse(raw);
    msg = p.message || p.description || p.statusMessage || p.error?.message || p.error || raw;
  } catch { /* texto plano */ }
  return String(msg).replace(/&#243;/g, 'ó').replace(/&#[0-9]+;/g, '').replace(/\[Paso[^\]]*\]\s*/g, '').trim();
}

function effectiveDocumentStatus(d: Doc, kind: DocumentKind) {
  if (d.creditNoteId) return 'ACEPTADO';
  return String(d.estadoSunat || d.estado || '').toUpperCase();
}

function EstadoBadge({ d, kind }: { d: Doc; kind: DocumentKind }) {
  const v = effectiveDocumentStatus(d, kind);
  const view = v === 'ACEPTADO'
    ? { label: 'Aceptado', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' }
    : v === 'RECHAZADO'
    ? { label: 'Rechazado', cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' }
    : v === 'REEMPLAZADO'
    ? { label: 'Rechazado', cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' }
    : v === 'SIN_CDR'
    ? { label: 'Sin CDR', cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' }
    : v === 'NO_ENVIADA'
    ? { label: 'No enviada', cls: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300' }
    : { label: v || 'Pendiente', cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' };
  const reason = sunatReason(d);
  const badge = <Badge variant="outline" className={cn('rounded-md', view.cls)}>{view.label}</Badge>;
  if (v === 'ACEPTADO' || !reason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild><button type="button" className="inline-flex cursor-help">{badge}</button></TooltipTrigger>
      <TooltipContent>{v === 'REEMPLAZADO' && <span className="font-medium">Reemplazada. </span>}{reason}</TooltipContent>
    </Tooltip>
  );
}

const money = (v: any) => `S/ ${(parseFloat(v || '0') || 0).toFixed(2)}`;
const DOCUMENT_PAGE_SIZE = 10;
const ACCEPTED_OR_CANCELLED_STATUSES = ['ACEPTADO', 'ANULADO', 'REEMPLAZADO'];

type PaginationEntry = number | 'start-ellipsis' | 'end-ellipsis';

function paginationEntries(currentPage: number, totalPages: number): PaginationEntry[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, 'end-ellipsis', totalPages];
  if (currentPage >= totalPages - 3) return [1, 'start-ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, 'start-ellipsis', currentPage - 1, currentPage, currentPage + 1, 'end-ellipsis', totalPages];
}

const META: Record<DocumentKind, { singular: string; plural: string; createPath: string; label: string }> = {
  boletas: { singular: 'boleta', plural: 'boletas', createPath: '/boletas/new', label: 'Boletas' },
  facturas: { singular: 'factura', plural: 'facturas', createPath: '/facturas/new', label: 'Facturas' },
};

export default function Documentos({ kind }: { kind: DocumentKind }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setActiveId = useAppStore((s) => s.setActiveCompanyId);
  const { can, role, loading: permissionsLoading } = usePermissions();
  const meta = META[kind];
  const canMutate = !permissionsLoading && role !== 'viewer';
  const canIssueCreditNote = canMutate && can('credit_notes_manage');

  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [selectedRange, setSelectedRange] = useState<DocumentDateRange>(() => parseDocumentDateRange(searchParams));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Doc[]>([]);
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [retryMsg, setRetryMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const [creditNoteTarget, setCreditNoteTarget] = useState<Doc | null>(null);
  const [issuingCreditNoteId, setIssuingCreditNoteId] = useState<number | null>(null);
  const [creditNoteError, setCreditNoteError] = useState('');
  const loadRequestRef = useRef(0);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    api.listCompanies()
      .then((c: any[]) => setCompanies(Array.isArray(c) ? c : []))
      .catch((e: any) => setLoadError(e?.message || 'No se pudieron cargar las empresas.'));
  }, []);

  useEffect(() => {
    setSelectedRange(parseDocumentDateRange(searchParams));
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [kind, selectedCompanyId, selectedRange.from, selectedRange.to]);

  useEffect(() => {
    setStatusFilter('all');
  }, [kind]);

  const updateRange = (range: DocumentDateRange) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('days');
      next.set('from', range.from);
      next.set('to', range.to);
      return next;
    });
  };

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const range = { fechaDesde: selectedRange.from, fechaHasta: selectedRange.to };
      const [res, nextStats] = await Promise.all([
        kind === 'boletas'
          ? api.listBoletas({ companyId: selectedCompanyId || undefined, ...range, limit: 500 })
          : api.listFacturas({ companyId: selectedCompanyId || undefined, ...range, limit: 500 }),
        api.getDocumentStats(range).catch(() => null),
      ]);
      if (requestId === loadRequestRef.current) {
        const nextRows = (kind === 'boletas' ? res?.boletas : res?.facturas) || [];
        setRows(nextRows);
        setStats(hasCompleteDocumentStats(nextStats, kind) ? nextStats : buildDocumentStatsFromRows(kind, nextRows));
      }
    } catch (e: any) {
      if (requestId === loadRequestRef.current) {
        setRows([]);
        setStats(null);
        setLoadError(e?.message || `No se pudieron cargar las ${meta.plural}.`);
      }
    }
    finally { if (requestId === loadRequestRef.current) setLoading(false); }
  }, [kind, meta.plural, selectedCompanyId, selectedRange.from, selectedRange.to]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (d.fechaEmision && d.fechaEmision.slice(0, 10) < selectedRange.from) return false;
      const status = effectiveDocumentStatus(d, kind) || 'PENDIENTE';
      if (statusFilter === 'CREDIT_NOTE' && !d.creditNoteId) return false;
      if (statusFilter === 'RECHAZADO' && !['RECHAZADO', 'REEMPLAZADO'].includes(status)) return false;
      if (statusFilter === 'PENDIENTE' && ['ACEPTADO', 'RECHAZADO', 'REEMPLAZADO', 'ANULADO', 'NO_ENVIADA'].includes(status)) return false;
      if (!['all', 'CREDIT_NOTE', 'RECHAZADO', 'PENDIENTE'].includes(statusFilter) && status !== statusFilter) return false;
      if (!q) return true;
      return [d.numeroCompleto, d.orderNumber, d.clientRazonSocial, d.clientNumeroDocumento].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [kind, rows, search, selectedRange.from, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / DOCUMENT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * DOCUMENT_PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + DOCUMENT_PAGE_SIZE);
  const visiblePages = paginationEntries(currentPage, totalPages);

  const downloadPdf = async (d: Doc) => {
    setDownloadingId(d.id);
    try {
      const res = kind === 'boletas' ? await api.generateBoletaPdf(d.id) : await api.generateFacturaPdf(d.id);
      if (!res?.base64) return;
      const link = document.createElement('a');
      link.href = `data:application/pdf;base64,${res.base64}`; link.download = `${d.numeroCompleto}.pdf`; link.click();
    } catch (e: any) { setRetryMsg(e?.message || 'No se pudo descargar el PDF.'); }
    finally { setDownloadingId(null); }
  };

  const downloadXml = async (d: Doc) => {
    setDownloadingId(d.id);
    try {
      const res = kind === 'boletas' ? await api.downloadBoletaXml(d.id) : await api.downloadFacturaXml(d.id);
      if (!res?.base64) throw new Error('El servidor respondió sin el archivo XML.');
      const link = document.createElement('a');
      link.href = `data:application/xml;base64,${res.base64}`;
      link.download = `${d.numeroCompleto}.xml`;
      link.click();
    } catch (e: any) {
      setRetryMsg(e?.message || 'No se pudo descargar el XML.');
    } finally {
      setDownloadingId(null);
    }
  };

  const retry = async (d: Doc) => {
    setRetryingId(d.id); setRetryMsg('');
    try {
      const res: any = await (kind === 'facturas' ? api.reEmitFactura(d.id) : api.reEmitBoleta(d.id));
      if (res && res.success === false) {
        setRetryMsg(`${d.numeroCompleto}: ${res.message || res.error || 'SUNAT rechazó el comprobante.'}`);
      } else {
        setRetryMsg(`${d.numeroCompleto}: reemitida y aceptada por SUNAT ✓ (puede haber tomado un nuevo número)`);
      }
      await load();
    } catch (e: any) {
      setRetryMsg(`${d.numeroCompleto}: ${e?.message || 'No se pudo reintentar.'}`);
    } finally { setRetryingId(null); }
  };

  const verifySunatStatus = async (d: Doc, reload = true) => {
    setVerifyingId(d.id);
    setRetryMsg('');
    try {
      const res: any = kind === 'boletas' ? await api.refreshBoletaStatus(d.id) : await api.refreshFacturaStatus(d.id);
      if (res?.success === false) throw new Error(res.message || 'SUNAT no respondió la consulta.');
      setRetryMsg(`${d.numeroCompleto}: SUNAT confirmó estado ${res?.estadoSunat || 'sin determinar'}${res?.message ? ` — ${res.message}` : ''}`);
      if (reload) await load();
      return res;
    } catch (e: any) {
      setRetryMsg(`${d.numeroCompleto}: ${e?.message || 'No se pudo consultar el estado en SUNAT.'}`);
      return null;
    } finally {
      setVerifyingId(null);
    }
  };

  const verifyAllSunatStatuses = async () => {
    const pending = filtered.filter((d) => !ACCEPTED_OR_CANCELLED_STATUSES.includes(String(d.estadoSunat || d.estado || '').toUpperCase()));
    if (pending.length === 0) return;
    setVerifyingAll(true);
    setRetryMsg(`Consultando 0 de ${pending.length} facturas en SUNAT…`);
    let verified = 0;
    let failed = 0;
    for (const document of pending) {
      const result = await verifySunatStatus(document, false);
      if (result) verified += 1;
      else failed += 1;
      setRetryMsg(`Consultando ${verified + failed} de ${pending.length} facturas en SUNAT…`);
    }
    await load();
    setRetryMsg(`Consulta SUNAT terminada: ${verified} verificadas${failed ? `, ${failed} con error` : ''}.`);
    setVerifyingAll(false);
  };

  const openPreview = async (d: Doc) => {
    const requestId = ++previewRequestRef.current;
    setPreviewingId(d.id);
    try {
      const res = kind === 'boletas' ? await api.previewAcceptedBoletaHtml(d.id) : await api.previewAcceptedFacturaHtml(d.id);
      if (requestId === previewRequestRef.current) {
        setPreviewHtml(res?.html || String(res));
        setPreviewOpen(true);
      }
    } catch (e: any) {
      if (requestId === previewRequestRef.current) setRetryMsg(e?.message || 'No se pudo abrir la vista previa.');
    }
    finally { if (requestId === previewRequestRef.current) setPreviewingId(null); }
  };

  const issueCreditNote = async () => {
    if (!creditNoteTarget) return;
    const target = creditNoteTarget;
    setIssuingCreditNoteId(target.id);
    setRetryMsg('');
    setCreditNoteError('');
    try {
      const result = kind === 'facturas'
        ? await api.createAndSendCreditNoteFromFactura(target.id)
        : await api.createAndSendCreditNote(target.id);
      if (result?.success === false) {
        throw new Error(result?.error?.message || result?.error || 'SUNAT rechazó la nota de crédito.');
      }
      setRetryMsg(`${target.numeroCompleto}: nota de crédito emitida correctamente ✓`);
      setCreditNoteTarget(null);
      await load();
    } catch (e: any) {
      const message = e?.message || 'No se pudo emitir la nota de crédito.';
      setCreditNoteError(message);
      setRetryMsg(`${target.numeroCompleto}: ${message}`);
      await load();
    } finally {
      setIssuingCreditNoteId(null);
    }
  };

  return (
   <TooltipProvider delayDuration={150}>
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Select value={selectedCompanyId ? String(selectedCompanyId) : 'all'} onValueChange={(v) => {
            const id = v === 'all' ? null : Number(v);
            setSelectedCompanyId(id);
            setActiveId(id);
            api.setActiveCompanyId(id);
          }}>
            <SelectTrigger className="w-full sm:w-[360px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las empresas</SelectItem>
              {companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre || c.razonSocial} — {c.ruc}</SelectItem>)}
            </SelectContent>
          </Select>

          <DocumentDateRangePicker value={selectedRange} onChange={updateRange} />

          {canMutate && (
            <Button onClick={() => navigate(meta.createPath)} className="sm:ml-auto">
              <Plus data-icon="inline-start" /> Nueva {meta.singular}
            </Button>
          )}
        </div>

      </div>

      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" />}>
        <DocumentOverview
          kind={kind}
          stats={stats}
          companies={companies}
          rows={rows}
          selectedCompanyId={selectedCompanyId}
          periodLabel={documentDateRangeLabel(selectedRange)}
          loading={loading}
        />
      </Suspense>

      {retryMsg && (
        <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', retryMsg.includes('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
          {retryMsg.includes('✓') ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />} {retryMsg}
        </div>
      )}

      {loadError && (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {loadError}</span>
          <Button variant="outline" size="sm" onClick={load}>Reintentar</Button>
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 sm:w-[320px] lg:w-[360px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Buscar número, orden o cliente" className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[220px]" aria-label={`Filtrar ${meta.plural} por estado`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="ACEPTADO">Aceptado</SelectItem>
            <SelectItem value="RECHAZADO">Rechazado</SelectItem>
            <SelectItem value="PENDIENTE">Pendiente</SelectItem>
            <SelectItem value="NO_ENVIADA">No enviada</SelectItem>
            <SelectItem value="ANULADO">Anulado</SelectItem>
            <SelectItem value="CREDIT_NOTE">Con nota de crédito</SelectItem>
          </SelectContent>
        </Select>
        {kind === 'facturas' && canMutate && (
          <Button variant="outline" onClick={verifyAllSunatStatuses} disabled={verifyingAll || filtered.every((d) => ACCEPTED_OR_CANCELLED_STATUSES.includes(String(d.estadoSunat || d.estado || '').toUpperCase()))}>
            {verifyingAll ? <Loader2 className="animate-spin" /> : <RefreshCw />} {verifyingAll ? 'Consultando SUNAT…' : 'Verificar en SUNAT'}
          </Button>
        )}
      </div>

      <TablePanel aria-label={`Listado de ${meta.plural}`}>
        {loading && rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Cargando {meta.plural}…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <FileText className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No hay {meta.plural} para mostrar</p>
            <p className="text-sm text-muted-foreground">{canMutate ? `Cambia los filtros o emite una nueva ${meta.singular}.` : 'Cambia los filtros para ampliar la consulta.'}</p>
            {canMutate && (
              <Button variant="ghost" size="sm" onClick={() => navigate(meta.createPath)} className="mt-1 text-primary hover:text-primary">
                <Plus /> Emitir {meta.singular}
              </Button>
            )}
          </div>
        ) : (
          <div className="relative max-h-[calc(100vh-16rem)] overflow-auto">
            {loading && (
              <div className="absolute inset-0 z-20 grid place-items-center bg-card/70 backdrop-blur-[1px]">
                <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Actualizando…
                </div>
              </div>
            )}
            <Table className="min-w-[820px] table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[150px]">Número</TableHead>
                  <TableHead className="w-[130px]">Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="w-[130px] text-right">Total</TableHead>
                  <TableHead className="w-[230px]">Estado</TableHead>
                  <TableHead className="w-[80px] text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((d) => {
                  const est = effectiveDocumentStatus(d, kind);
                  const canRetryDocument = canMutate && (
                    est === 'RECHAZADO'
                    || (kind === 'facturas' && (est === 'NO_ENCONTRADO' || est === 'SIN_CDR'))
                  );
                  const canVerifyDocument = canMutate && est !== 'ACEPTADO';
                  const hasAcceptedActions = est === 'ACEPTADO';
                  const canDownloadPdf = hasAcceptedActions || (kind === 'boletas' && est === 'ANULADO' && Boolean(d.xmlPath || d.cdrPath));
                  const canDownloadXml = Boolean(d.xmlPath);
                  const hasRowActions = hasAcceptedActions || canDownloadPdf || canDownloadXml || canVerifyDocument || canRetryDocument;
                  const rowBusy = previewingId === d.id || downloadingId === d.id || retryingId === d.id || verifyingId === d.id || issuingCreditNoteId === d.id;
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs tabular-nums text-foreground">{d.numeroCompleto || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{d.fechaEmision || '—'}</TableCell>
                      <TableCell className="min-w-0">
                        <div className="truncate text-foreground" title={d.clientRazonSocial || undefined}>{d.clientRazonSocial || '—'}</div>
                        <div className="text-sm text-muted-foreground">{d.clientNumeroDocumento || '—'}</div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">{money(d.mtoImpVenta)}</TableCell>
                      <TableCell>
                        {retryingId === d.id || verifyingId === d.id
                          ? <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 text-amber-700"><Loader2 className="animate-spin" /> Procesando</Badge>
                          : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <EstadoBadge d={d} kind={kind} />
                              {d.creditNoteId && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className="cursor-help rounded-md border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
                                    >
                                      <FileMinus2 /> NC
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>Nota de crédito {d.creditNoteNumeroCompleto || 'emitida'}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${d.numeroCompleto}`}>
                                {rowBusy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-48">
                              {hasAcceptedActions && (
                                <DropdownMenuItem onClick={() => openPreview(d)} disabled={previewingId !== null}>
                                  <Eye /> Ver comprobante
                                </DropdownMenuItem>
                              )}
                              {canDownloadPdf && (
                                <DropdownMenuItem onClick={() => downloadPdf(d)} disabled={downloadingId === d.id}>
                                  <Download /> Descargar PDF
                                </DropdownMenuItem>
                              )}
                              {canDownloadXml && (
                                <DropdownMenuItem onClick={() => downloadXml(d)} disabled={downloadingId === d.id}>
                                  <FileCode2 /> Descargar XML
                                </DropdownMenuItem>
                              )}
                              {hasAcceptedActions && canIssueCreditNote && <DropdownMenuSeparator />}
                              {hasAcceptedActions && canIssueCreditNote && !d.creditNoteId && (
                                <DropdownMenuItem onClick={() => { setCreditNoteError(''); setCreditNoteTarget(d); }}>
                                  <FileMinus2 /> Emitir nota de crédito
                                </DropdownMenuItem>
                              )}
                              {hasAcceptedActions && canIssueCreditNote && d.creditNoteId && (
                                <DropdownMenuItem disabled>
                                  <FileMinus2 /> NC {d.creditNoteNumeroCompleto || 'emitida'}
                                </DropdownMenuItem>
                              )}
                              {canVerifyDocument && (
                                <DropdownMenuItem onClick={() => verifySunatStatus(d)} disabled={verifyingId !== null || verifyingAll}>
                                  <RefreshCw /> Verificar en SUNAT
                                </DropdownMenuItem>
                              )}
                              {canVerifyDocument && canRetryDocument && <DropdownMenuSeparator />}
                              {canRetryDocument && (
                                <DropdownMenuItem onClick={() => retry(d)} disabled={retryingId === d.id}>
                                  <RotateCcw /> Reintentar emisión
                                </DropdownMenuItem>
                              )}
                              {!hasRowActions && <DropdownMenuItem disabled>Sin acciones disponibles</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {!loading && rows.length > 0 && (
          <TablePanelFooter className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              Mostrando {filtered.length === 0 ? 0 : pageStart + 1} a {Math.min(pageStart + pageRows.length, filtered.length)} de {filtered.length} {meta.plural}
            </p>
            {totalPages > 1 && (
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      aria-disabled={currentPage === 1}
                      tabIndex={currentPage === 1 ? -1 : undefined}
                      className={cn(currentPage === 1 && 'pointer-events-none opacity-50')}
                      onClick={(event) => { event.preventDefault(); setPage(Math.max(1, currentPage - 1)); }}
                    />
                  </PaginationItem>
                  {visiblePages.map((entry) => (
                    <PaginationItem key={entry}>
                      {typeof entry === 'number' ? (
                        <PaginationLink
                          href="#"
                          isActive={entry === currentPage}
                          aria-label={`Ir a la página ${entry}`}
                          onClick={(event) => { event.preventDefault(); setPage(entry); }}
                        >
                          {entry}
                        </PaginationLink>
                      ) : <PaginationEllipsis />}
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      aria-disabled={currentPage === totalPages}
                      tabIndex={currentPage === totalPages ? -1 : undefined}
                      className={cn(currentPage === totalPages && 'pointer-events-none opacity-50')}
                      onClick={(event) => { event.preventDefault(); setPage(Math.min(totalPages, currentPage + 1)); }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </TablePanelFooter>
        )}
      </TablePanel>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Vista previa — {meta.singular}</DialogTitle></DialogHeader>
          <div className="p-4">
            <iframe sandbox="" srcDoc={previewHtml} title="Vista previa" className="h-[75vh] w-full rounded-md border border-border bg-white" />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(creditNoteTarget)} onOpenChange={(open) => { if (!open && !issuingCreditNoteId) { setCreditNoteTarget(null); setCreditNoteError(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Emitir nota de crédito</DialogTitle>
            <DialogDescription>
              Se emitirá una nota de crédito que anula la {meta.singular} {creditNoteTarget?.numeroCompleto}. ¿Continuar?
            </DialogDescription>
          </DialogHeader>
          {creditNoteError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> {creditNoteError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditNoteTarget(null)} disabled={Boolean(issuingCreditNoteId)}>Cancelar</Button>
            <Button onClick={issueCreditNote} disabled={Boolean(issuingCreditNoteId)}>
              {issuingCreditNoteId ? <Loader2 className="animate-spin" /> : <FileMinus2 />} Emitir NC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
   </TooltipProvider>
  );
}
