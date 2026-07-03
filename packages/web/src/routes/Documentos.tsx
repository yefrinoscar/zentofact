import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Download, Loader2, RefreshCw, FileText, CheckCircle2, XCircle, AlertCircle, Eye } from 'lucide-react';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { useAppStore } from '../stores/app';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';

type Kind = 'boletas' | 'facturas';
type Doc = {
  id: number; numeroCompleto: string; fechaEmision: string; orderNumber?: string | null;
  clientRazonSocial?: string; clientNumeroDocumento?: string; mtoImpVenta?: string;
  estadoSunat?: string; estado?: string;
};

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

export default function Documentos() {
  const navigate = useNavigate();
  const activeId = useAppStore((s) => s.activeCompanyId);
  const setActiveId = useAppStore((s) => s.setActiveCompanyId);

  const [companies, setCompanies] = useState<any[]>([]);
  const [kind, setKind] = useState<Kind>('boletas');
  const [estado, setEstado] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => { api.listCompanies().then((c: any[]) => setCompanies(Array.isArray(c) ? c : [])).catch(() => {}); }, []);

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
    return rows.filter((d) => {
      // Esta lista es solo de documentos SIN orden de Falabella (los emitidos manualmente).
      if (d.orderNumber && String(d.orderNumber).trim()) return false;
      const est = String(d.estadoSunat || d.estado || '').toUpperCase();
      if (estado !== 'all' && est !== estado) return false;
      if (!q) return true;
      return [d.numeroCompleto, d.clientRazonSocial, d.clientNumeroDocumento].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, estado]);

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
      {/* Barra: empresa + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={activeId ? String(activeId) : ''} onValueChange={(v) => { const id = Number(v); setActiveId(id); api.setActiveCompanyId(id); }}>
          <SelectTrigger className="h-10 w-[min(360px,60vw)]"><SelectValue placeholder="Selecciona una empresa" /></SelectTrigger>
          <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre || c.razonSocial} — {c.ruc}</SelectItem>)}</SelectContent>
        </Select>
        <button onClick={() => navigate('/documentos/nuevo')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">
          <Plus className="h-4 w-4" /> Nuevo documento
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <TabsList>
            <TabsTrigger value="boletas">Boletas</TabsTrigger>
            <TabsTrigger value="facturas">Facturas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número, cliente…" className="h-9 w-64 rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:border-ring" />
        </div>
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="h-9 w-[180px] whitespace-nowrap"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="ACEPTADO">Aceptado</SelectItem>
            <SelectItem value="RECHAZADO">Rechazado</SelectItem>
            <SelectItem value="ANULADO">Anulado</SelectItem>
            <SelectItem value="PENDIENTE">Pendiente</SelectItem>
            <SelectItem value="REGISTRADO">Registrado</SelectItem>
          </SelectContent>
        </Select>
        <button onClick={load} disabled={loading} className="ml-auto rounded-md p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50" title="Refrescar">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Lista */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {!activeId ? (
          <p className="p-12 text-center text-sm text-muted-foreground">Selecciona una empresa para ver sus documentos.</p>
        ) : loading && rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No hay {kind === 'boletas' ? 'boletas' : 'facturas'} para mostrar.</p>
            <button onClick={() => navigate('/documentos/nuevo')} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:opacity-80"><Plus className="h-4 w-4" /> Emitir una</button>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-16rem)] overflow-auto">
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
                    <tr key={d.id} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                      <td className="px-5 py-2.5 font-mono text-xs text-foreground">{d.numeroCompleto || '—'}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">{d.fechaEmision || '—'}</td>
                      <td className="px-5 py-2.5">
                        <div className="text-foreground">{d.clientRazonSocial || '—'}</div>
                        <div className="text-xs text-muted-foreground">{d.clientNumeroDocumento || '—'}</div>
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium text-foreground">{money(d.mtoImpVenta)}</td>
                      <td className="px-5 py-2.5 text-center"><span className="inline-flex justify-center"><EstadoIcon value={est} /></span></td>
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
