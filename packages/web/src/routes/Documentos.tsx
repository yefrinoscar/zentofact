import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Download, Loader2, RefreshCw, FileText, CheckCircle2, XCircle, AlertCircle, Eye, RotateCcw } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { useAppStore } from '../stores/app';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';

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

function EstadoIcon({ value }: { value?: string }) {
  const v = String(value || '').toUpperCase();
  const { Icon, color } = v === 'ACEPTADO'
    ? { Icon: CheckCircle2, color: 'text-emerald-600' }
    : v === 'RECHAZADO'
    ? { Icon: XCircle, color: 'text-red-600' }
    : { Icon: AlertCircle, color: 'text-amber-500' };
  return <span title={v || '—'} className={cn('inline-flex', color)}><Icon className="h-[18px] w-[18px]" /></span>;
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
      const res: any = await (kind === 'facturas' ? api.sendFacturaToSunat(d.id) : api.sendBoletaToSunat(d.id));
      // El backend devuelve { success:false, message } cuando SUNAT rechaza (sin lanzar). Mostrarlo.
      if (res && res.success === false) {
        setRetryMsg(`${d.numeroCompleto}: ${res.message || res.error || 'SUNAT rechazó el comprobante.'}`);
      } else {
        setRetryMsg(`${d.numeroCompleto}: aceptada por SUNAT ✓`);
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
    <div className="space-y-5">
      {/* Barra: empresa + tipo de documento */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Select value={activeId ? String(activeId) : ''} onValueChange={(v) => { const id = Number(v); setActiveId(id); api.setActiveCompanyId(id); }}>
            <SelectTrigger className="h-11 w-[min(390px,72vw)]"><SelectValue placeholder="Selecciona una empresa" /></SelectTrigger>
            <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre || c.razonSocial} — {c.ruc}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <button onClick={() => navigate('/documentos/nuevo')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">
          <Plus className="h-4 w-4" /> Nuevo documento
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-[300px] max-w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número, orden, cliente…" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:border-ring" />
        </div>
        <div className="relative grid h-10 w-[222px] grid-cols-2 rounded-xl bg-muted p-1 text-xs font-medium text-muted-foreground">
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
        <div className="relative grid h-10 w-[222px] grid-cols-3 rounded-xl bg-muted p-1 text-xs font-medium text-muted-foreground">
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
        <button onClick={load} disabled={loading} className="ml-auto rounded-md p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50" title="Refrescar">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {retryMsg && (
        <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', retryMsg.includes('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
          {retryMsg.includes('✓') ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />} {retryMsg}
        </div>
      )}

      {/* Lista */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {!activeId ? (
          <p className="p-12 text-center text-sm text-muted-foreground">Selecciona una empresa para ver sus documentos.</p>
        ) : loading && rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando {kind === 'boletas' ? 'boletas' : 'facturas'}…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No hay {kind === 'boletas' ? 'boletas' : 'facturas'} para mostrar.</p>
            <button onClick={() => navigate('/documentos/nuevo')} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:opacity-80"><Plus className="h-4 w-4" /> Emitir una</button>
          </div>
        ) : (
          <div className="relative max-h-[calc(100vh-16rem)] overflow-auto">
            {loading && (
              <div className="absolute inset-0 z-20 grid place-items-center bg-card/70 backdrop-blur-[1px]">
                <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Actualizando…
                </div>
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Número</th>
                  <th className="px-5 py-2.5 font-medium">Fecha</th>
                  <th className="px-5 py-2.5 font-medium">Cliente</th>
                  <th className="px-5 py-2.5 font-medium text-right">Total</th>
                  <th className="px-5 py-2.5 font-medium text-center">Estado</th>
                  <th className="px-5 py-2.5 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const est = String(d.estadoSunat || d.estado || '').toUpperCase();
                  return (
                    <tr key={d.id} className="border-b border-border/50 last:border-0 align-top hover:bg-accent/30">
                      <td className="px-5 py-2.5 text-xs text-foreground">
                        <div className="font-mono">{d.numeroCompleto || '—'}</div>
                        {est === 'RECHAZADO' && sunatReason(d) && (
                          <div className="mt-1 max-w-[320px] whitespace-normal leading-tight text-[11px] text-red-600">{sunatReason(d)}</div>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{d.fechaEmision || '—'}</td>
                      <td className="px-5 py-2.5">
                        <div className="text-foreground">{d.clientRazonSocial || '—'}</div>
                        <div className="text-xs text-muted-foreground">{d.clientNumeroDocumento || '—'}</div>
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium text-foreground">{money(d.mtoImpVenta)}</td>
                      <td className="px-5 py-2.5 text-center">
                        {retryingId === d.id
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Procesando</span>
                          : <span className="inline-flex justify-center"><EstadoIcon value={est} /></span>}
                      </td>
                      <td className="px-5 py-2.5">
                        {est === 'ACEPTADO' ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => openPreview(d)} disabled={previewingId === d.id} title="Vista previa" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-40">
                              {previewingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Ver
                            </button>
                            <button onClick={() => downloadPdf(d)} disabled={downloadingId === d.id} title="Descargar PDF" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-40">
                              {downloadingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF
                            </button>
                          </div>
                        ) : est === 'RECHAZADO' ? (
                          <div className="flex justify-end">
                            <button onClick={() => retry(d)} disabled={retryingId === d.id} title="Reintentar emisión a SUNAT (mismo número)" className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-40">
                              {retryingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reintentar
                            </button>
                          </div>
                        ) : <span className="block text-right text-xs text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Vista previa en modal (iframe: aísla el CSS del documento y hace scroll interno) */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Vista previa</DialogTitle></DialogHeader>
          <div className="p-4">
            <iframe srcDoc={previewHtml} title="Vista previa" className="h-[75vh] w-full rounded-lg border border-border bg-white" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
