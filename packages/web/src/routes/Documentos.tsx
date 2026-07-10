import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Download, Loader2, FileText, CheckCircle2, AlertCircle, Eye, RotateCcw } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { useAppStore } from '../stores/app';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TablePanelFooter,
  TablePanelHeader, TableRow,
} from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../components/ui/tooltip';

type Kind = 'boletas' | 'facturas';
type DayWindow = 7 | 15 | 30;
type Doc = {
  id: number; numeroCompleto: string; fechaEmision: string; orderNumber?: string | null;
  clientRazonSocial?: string; clientNumeroDocumento?: string; mtoImpVenta?: string;
  estadoSunat?: string; estado?: string; respuestaSunat?: string;
};

// Extrae el motivo legible del rechazo de SUNAT (respuestaSunat guardado como JSON).
function sunatReason(d: Doc): string {
  const raw = d.respuestaSunat;
  if (!raw) return '';
  let msg = raw;
  try { const p = JSON.parse(raw); msg = p.message || p.error || raw; } catch { /* texto plano */ }
  return String(msg).replace(/&#243;/g, 'ó').replace(/&#[0-9]+;/g, '').replace(/\[Paso[^\]]*\]\s*/g, '').trim();
}

function EstadoBadge({ d }: { d: Doc }) {
  const v = String(d.estadoSunat || d.estado || '').toUpperCase();
  const view = v === 'ACEPTADO'
    ? { label: 'Aceptado', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' }
    : v === 'RECHAZADO'
    ? { label: 'Rechazado', cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' }
    : v === 'REEMPLAZADO'
    ? { label: 'Reemplazado', cls: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300' }
    : { label: v || 'Pendiente', cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' };
  const reason = sunatReason(d);
  const badge = <Badge variant="outline" className={cn('rounded-md', view.cls)}>{view.label}</Badge>;
  if (!reason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild><button type="button" className="inline-flex cursor-help">{badge}</button></TooltipTrigger>
      <TooltipContent>{v === 'REEMPLAZADO' && <span className="font-medium">Reemplazada. </span>}{reason}</TooltipContent>
    </Tooltip>
  );
}
const money = (v: any) => `S/ ${(parseFloat(v || '0') || 0).toFixed(2)}`;
const DAY_WINDOWS: DayWindow[] = [7, 15, 30];

function parseKind(value: string | null): Kind {
  return value === 'facturas' ? 'facturas' : 'boletas';
}

function parseDays(value: string | null): DayWindow {
  const parsed = Number(value);
  return DAY_WINDOWS.includes(parsed as DayWindow) ? parsed as DayWindow : 7;
}

function dateValue(value?: string) {
  const time = new Date(String(value || '')).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export default function Documentos() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = useAppStore((s) => s.activeCompanyId);
  const setActiveId = useAppStore((s) => s.setActiveCompanyId);

  const [companies, setCompanies] = useState<any[]>([]);
  const [kind, setKind] = useState<Kind>(() => parseKind(searchParams.get('tab')));
  const [dayWindow, setDayWindow] = useState<DayWindow>(() => parseDays(searchParams.get('days')));
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [retryMsg, setRetryMsg] = useState('');

  useEffect(() => { api.listCompanies().then((c: any[]) => setCompanies(Array.isArray(c) ? c : [])).catch(() => {}); }, []);

  useEffect(() => {
    const nextKind = parseKind(searchParams.get('tab'));
    const nextDays = parseDays(searchParams.get('days'));
    setKind(nextKind);
    setDayWindow(nextDays);
  }, [searchParams]);

  const updateKind = (nextKind: Kind) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', nextKind);
      next.set('days', String(dayWindow));
      return next;
    });
  };

  const updateDays = (nextDays: DayWindow) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', kind);
      next.set('days', String(nextDays));
      return next;
    });
  };

  const load = useCallback(async () => {
    if (!activeId) { setRows([]); return; }
    setLoading(true);
    try {
      const res = kind === 'boletas'
        ? await api.listBoletas({ companyId: activeId, limit: 500 })
        : await api.listFacturas({ companyId: activeId, limit: 500 });
      setRows((kind === 'boletas' ? res?.boletas : res?.facturas) || []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [activeId, kind]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = Date.now() - dayWindow * 24 * 60 * 60 * 1000;
    return rows.filter((d) => {
      const emittedAt = dateValue(d.fechaEmision);
      if (emittedAt && emittedAt < from) return false;
      if (!q) return true;
      return [d.numeroCompleto, d.orderNumber, d.clientRazonSocial, d.clientNumeroDocumento].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, dayWindow]);

  const downloadPdf = async (d: Doc) => {
    setDownloadingId(d.id);
    try {
      const res = kind === 'boletas' ? await api.generateBoletaPdf(d.id) : await api.generateFacturaPdf(d.id);
      if (!res?.base64) return;
      const link = document.createElement('a');
      link.href = `data:application/pdf;base64,${res.base64}`; link.download = `${d.numeroCompleto}.pdf`; link.click();
    } catch { /* noop */ }
    finally { setDownloadingId(null); }
  };

  // Reintenta la emisión a SUNAT de una RECHAZADA (mismo registro/número; el backend reconstruye el XML).
  const retry = async (d: Doc) => {
    setRetryingId(d.id); setRetryMsg('');
    try {
      // reEmit: si el número quedó quemado (rechazo definitivo), toma el siguiente disponible.
      const res: any = await (kind === 'facturas' ? api.reEmitFactura(d.id) : api.reEmitBoleta(d.id));
      // El backend devuelve { success:false, message } cuando SUNAT rechaza (sin lanzar). Mostrarlo.
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

  const openPreview = async (d: Doc) => {
    setPreviewingId(d.id);
    try {
      const res = kind === 'boletas' ? await api.previewAcceptedBoletaHtml(d.id) : await api.previewAcceptedFacturaHtml(d.id);
      setPreviewHtml(res?.html || String(res));
      setPreviewOpen(true);
    } catch { /* noop */ }
    finally { setPreviewingId(null); }
  };

  return (
   <TooltipProvider delayDuration={150}>
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Select value={activeId ? String(activeId) : ''} onValueChange={(v) => { const id = Number(v); setActiveId(id); api.setActiveCompanyId(id); }}>
            <SelectTrigger className="w-full sm:w-[360px]"><SelectValue placeholder="Selecciona una empresa" /></SelectTrigger>
            <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre || c.razonSocial} — {c.ruc}</SelectItem>)}</SelectContent>
          </Select>

          <Button onClick={() => navigate('/documentos/nuevo')}>
            <Plus data-icon="inline-start" /> Nuevo documento
          </Button>
        </div>

        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 sm:w-[320px] lg:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar número, orden o cliente" className="pl-9" />
          </div>

        <div className="relative grid h-9 w-full grid-cols-2 rounded-xl bg-muted p-1 text-xs font-medium text-muted-foreground sm:w-[190px]">
          <span
            className={cn(
              'absolute bottom-1 left-1 top-1 w-[calc(50%_-_4px)] rounded-lg bg-card shadow-sm transition-transform duration-200 ease-out',
              kind === 'facturas' ? 'translate-x-full' : 'translate-x-0',
            )}
          />
          <button
            type="button"
            onClick={() => updateKind('boletas')}
            className={cn('relative z-10 rounded-lg transition-colors', kind === 'boletas' ? 'text-foreground' : 'hover:text-foreground')}
          >
            Boletas
          </button>
          <button
            type="button"
            onClick={() => updateKind('facturas')}
            className={cn('relative z-10 rounded-lg transition-colors', kind === 'facturas' ? 'text-foreground' : 'hover:text-foreground')}
          >
            Facturas
          </button>
        </div>
        <div className="relative grid h-9 w-full grid-cols-3 rounded-xl bg-muted p-1 text-xs font-medium text-muted-foreground sm:w-[210px]">
          <span
            className="absolute bottom-1 left-1 top-1 w-[calc(33.333333%_-_2.666667px)] rounded-lg bg-card shadow-sm transition-transform duration-200 ease-out"
            style={{ transform: `translateX(${DAY_WINDOWS.indexOf(dayWindow) * 100}%)` }}
          />
          {DAY_WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => updateDays(days)}
              className={cn('relative z-10 rounded-lg transition-colors', dayWindow === days ? 'text-foreground' : 'hover:text-foreground')}
            >
              {days} días
            </button>
          ))}
        </div>
        </div>
      </div>

      {retryMsg && (
        <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', retryMsg.includes('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
          {retryMsg.includes('✓') ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />} {retryMsg}
        </div>
      )}

      <TablePanel aria-label={`Listado de ${kind}`}>
        <TablePanelHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{filtered.length} {kind === 'boletas' ? 'boleta(s)' : 'factura(s)'}</p>
            <p className="text-xs text-muted-foreground">
              Últimos {dayWindow} días{search.trim() ? ` · Búsqueda: “${search.trim()}”` : ''}
            </p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">Máximo 500 registros</span>
        </TablePanelHeader>
        {!activeId ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <FileText className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">Selecciona una empresa</p>
            <p className="text-sm text-muted-foreground">Elige una empresa para consultar sus documentos.</p>
          </div>
        ) : loading && rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Cargando {kind === 'boletas' ? 'boletas' : 'facturas'}…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <FileText className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No hay {kind === 'boletas' ? 'boletas' : 'facturas'} para mostrar</p>
            <p className="text-sm text-muted-foreground">Cambia los filtros o crea un nuevo documento.</p>
            <Button variant="ghost" size="sm" onClick={() => navigate('/documentos/nuevo')} className="mt-1 text-primary hover:text-primary">
              <Plus /> Emitir una
            </Button>
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
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Número</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const est = String(d.estadoSunat || d.estado || '').toUpperCase();
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs tabular-nums text-foreground">{d.numeroCompleto || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{d.fechaEmision || '—'}</TableCell>
                      <TableCell>
                        <div className="text-foreground">{d.clientRazonSocial || '—'}</div>
                        <div className="text-sm text-muted-foreground">{d.clientNumeroDocumento || '—'}</div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">{money(d.mtoImpVenta)}</TableCell>
                      <TableCell>
                        {retryingId === d.id
                          ? <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 text-amber-700"><Loader2 className="animate-spin" /> Procesando</Badge>
                          : <EstadoBadge d={d} />}
                      </TableCell>
                      <TableCell>
                        {est === 'ACEPTADO' ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => openPreview(d)} disabled={previewingId === d.id}>
                              {previewingId === d.id ? <Loader2 className="animate-spin" /> : <Eye />} Ver
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => downloadPdf(d)} disabled={downloadingId === d.id}>
                              {downloadingId === d.id ? <Loader2 className="animate-spin" /> : <Download />} PDF
                            </Button>
                          </div>
                        ) : est === 'RECHAZADO' ? (
                          <div className="flex justify-end">
                            <Button variant="outline" size="sm" onClick={() => retry(d)} disabled={retryingId === d.id} className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900">
                              {retryingId === d.id ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reintentar
                            </Button>
                          </div>
                        ) : <span className="block text-right text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {activeId && !loading && rows.length > 0 && (
          <TablePanelFooter>
            <p className="text-sm text-muted-foreground">Mostrando {filtered.length} de {rows.length} documentos cargados</p>
          </TablePanelFooter>
        )}
      </TablePanel>

      {/* Vista previa en modal (iframe: aísla el CSS del documento y hace scroll interno) */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Vista previa</DialogTitle></DialogHeader>
          <div className="p-4">
            <iframe sandbox="" srcDoc={previewHtml} title="Vista previa" className="h-[75vh] w-full rounded-md border border-border bg-white" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
   </TooltipProvider>
  );
}
