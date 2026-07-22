import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Loader2, FileMinus2, Eye, AlertCircle } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { useAppStore } from '../stores/app';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TablePanelFooter,
  TableRow,
} from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../components/ui/tooltip';
import { buildDocumentStatsFromRows, hasCompleteDocumentStats, type DocumentStats } from '../lib/documentStats';
import { documentDateRangeLabel, parseDocumentDateRange, type DocumentDateRange } from '../lib/documentDateRange';
import DocumentDateRangePicker from '../components/DocumentDateRangePicker';

const DocumentOverview = lazy(() => import('../components/DocumentOverview'));

type Nc = {
  id: number;
  companyId: number;
  affectedBoletaId?: number | null;
  affectedFacturaId?: number | null;
  tipoDocAfectado?: string;
  numeroCompleto?: string;
  fechaEmision?: string;
  mtoImpVenta?: string;
  estadoSunat?: string;
  respuestaSunat?: string;
  desMotivo?: string;
  codMotivo?: string;
  numDocAfectado?: string;
  affectedBoletaNumeroCompleto?: string;
  affectedDocumentNumeroCompleto?: string;
  affectedDocumentOrderNumber?: string | null;
  affectedOrderNumber?: string | null;
  clientRazonSocial?: string;
  clientNumeroDocumento?: string;
};

const money = (v: any) => `S/ ${(parseFloat(v || '0') || 0).toFixed(2)}`;

function sunatReason(d: Nc): string {
  const raw = d.respuestaSunat;
  if (!raw) return '';
  let msg = raw;
  try { const p = JSON.parse(raw); msg = p.message || p.error || raw; } catch { /* texto plano */ }
  return String(msg).replace(/&#243;/g, 'ó').replace(/&#[0-9]+;/g, '').replace(/\[Paso[^\]]*\]\s*/g, '').trim();
}

function EstadoBadge({ d }: { d: Nc }) {
  const v = String(d.estadoSunat || '').toUpperCase();
  const view = v === 'ACEPTADO'
    ? { label: 'Aceptado', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' }
    : v === 'RECHAZADO'
    ? { label: 'Rechazado', cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' }
    : { label: v || 'Pendiente', cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' };
  const reason = sunatReason(d);
  const badge = <Badge variant="outline" className={cn('rounded-md', view.cls)}>{view.label}</Badge>;
  if (!reason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild><button type="button" className="inline-flex cursor-help">{badge}</button></TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export default function CreditNotesList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const setActiveId = useAppStore((s) => s.setActiveCompanyId);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [selectedRange, setSelectedRange] = useState<DocumentDateRange>(() => parseDocumentDateRange(searchParams));
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Nc[]>([]);
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [previewError, setPreviewError] = useState('');
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
        api.listCreditNotes({ companyId: selectedCompanyId || undefined, ...range, limit: 500 }),
        api.getDocumentStats(range).catch(() => null),
      ]);
      if (requestId === loadRequestRef.current) {
        const nextRows = res?.creditNotes || [];
        setRows(nextRows);
        setStats(hasCompleteDocumentStats(nextStats, 'credit-notes') ? nextStats : buildDocumentStatsFromRows('credit-notes', nextRows));
      }
    } catch (e: any) {
      if (requestId === loadRequestRef.current) {
        setRows([]);
        setStats(null);
        setLoadError(e?.message || 'No se pudieron cargar las notas de crédito.');
      }
    }
    finally { if (requestId === loadRequestRef.current) setLoading(false); }
  }, [selectedCompanyId, selectedRange.from, selectedRange.to]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (d.fechaEmision && d.fechaEmision.slice(0, 10) < selectedRange.from) return false;
      if (!q) return true;
      return [
        d.numeroCompleto,
        d.numDocAfectado,
        d.affectedDocumentNumeroCompleto,
        d.affectedBoletaNumeroCompleto,
        d.affectedDocumentOrderNumber,
        d.affectedOrderNumber,
        d.clientRazonSocial,
        d.clientNumeroDocumento,
        d.desMotivo,
      ].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, selectedRange.from]);

  const openPreview = async (d: Nc) => {
    const requestId = ++previewRequestRef.current;
    setPreviewingId(d.id);
    setPreviewError('');
    try {
      const res = await api.previewCreditNoteHtml(d.id);
      if (requestId === previewRequestRef.current) {
        setPreviewHtml(res?.html || String(res));
        setPreviewOpen(true);
      }
    } catch (e: any) {
      if (requestId === previewRequestRef.current) setPreviewError(e?.message || 'No se pudo abrir la vista previa.');
    }
    finally { if (requestId === previewRequestRef.current) setPreviewingId(null); }
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
          </div>

        </div>

        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" />}>
          <DocumentOverview
            kind="credit-notes"
            stats={stats}
            companies={companies}
            rows={rows}
            selectedCompanyId={selectedCompanyId}
          periodLabel={documentDateRangeLabel(selectedRange)}
          loading={loading}
          />
        </Suspense>

        {(loadError || previewError) && (
          <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {previewError || loadError}</span>
            {loadError && <Button variant="outline" size="sm" onClick={load}>Reintentar</Button>}
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 sm:w-[320px] lg:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar NC, comprobante, orden o cliente" className="pl-9" />
          </div>
        </div>

        <TablePanel aria-label="Listado de notas de crédito">
          {loading && rows.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Cargando notas de crédito…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <FileMinus2 className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No hay notas de crédito para mostrar</p>
              <p className="text-sm text-muted-foreground">Se emiten al anular boletas o facturas aceptadas.</p>
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
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Número NC</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Doc. afectado</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((d) => {
                    const affected = d.affectedDocumentNumeroCompleto || d.affectedBoletaNumeroCompleto || d.numDocAfectado || '—';
                    const affectedOrder = d.affectedDocumentOrderNumber || d.affectedOrderNumber;
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono text-xs tabular-nums text-foreground">{d.numeroCompleto || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{d.fechaEmision || '—'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="rounded-md">{d.tipoDocAfectado === '01' ? 'Factura' : 'Boleta'}</Badge>
                            <span className="font-mono text-xs text-foreground">{affected}</span>
                          </div>
                          {affectedOrder && (
                            <div className="text-xs text-muted-foreground">Orden {affectedOrder}</div>
                          )}
                          {(d.desMotivo || d.codMotivo) && (
                            <div className="text-xs text-muted-foreground">{d.codMotivo ? `${d.codMotivo} · ` : ''}{d.desMotivo || ''}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-foreground">{d.clientRazonSocial || '—'}</div>
                          <div className="text-sm text-muted-foreground">{d.clientNumeroDocumento || '—'}</div>
                        </TableCell>
                        <TableCell className="text-right font-medium text-foreground">{money(d.mtoImpVenta)}</TableCell>
                        <TableCell><EstadoBadge d={d} /></TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button variant="outline" size="sm" onClick={() => openPreview(d)} disabled={previewingId !== null}>
                              {previewingId === d.id ? <Loader2 className="animate-spin" /> : <Eye />} Ver
                            </Button>
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
            <TablePanelFooter>
              <p className="text-sm text-muted-foreground">Mostrando {filtered.length} de {rows.length} notas cargadas</p>
            </TablePanelFooter>
          )}
        </TablePanel>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>Vista previa — nota de crédito</DialogTitle></DialogHeader>
            <div className="p-4">
              <iframe sandbox="" srcDoc={previewHtml} title="Vista previa" className="h-[75vh] w-full rounded-md border border-border bg-white" />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
