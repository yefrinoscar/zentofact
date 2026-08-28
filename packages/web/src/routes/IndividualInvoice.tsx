import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Send, Plus, Trash2, Loader2, AlertCircle, Eye,
  Calendar as CalendarIcon, ArrowLeft,
} from 'lucide-react';
import { es } from 'date-fns/locale';
import api from '../lib/api';
import { cn } from '../lib/cn';
import { invoicePrefillFromOrder, type OrderForDocument } from '../lib/order-document';
import { useAppStore } from '../stores/app';
import { usePermissions } from '../hooks/usePermissions';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';

type DocType = '03' | '01';

interface Item { id: string; descripcion: string; cantidad: string; precioUnitario: string }
interface Company { id: number; nombre: string; razonSocial: string; ruc: string }
interface Branch { id: number; codigo: string; nombre: string; seriesBoleta?: string[] | null; seriesFactura?: string[] | null }
interface Correlative { tipoDocumento: string; serie: string; correlativoActual: string }

const IGV_RATE = 18;
const round = (v: number) => Math.round(v * 100) / 100;
const splitTotal = (total: number) => { const base = round(total / (1 + IGV_RATE / 100)); return { base, igv: round(total - base) }; };
const money = (n: number) => `S/ ${n.toFixed(2)}`;
const pad6 = (n: number) => String(n).padStart(6, '0');
function localDate(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const emptyItem = (): Item => ({ id: crypto.randomUUID(), descripcion: '', cantidad: '1', precioUnitario: '' });

const inputCls = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-ring';

function Field({ label, children, hint, error }: { label: string; children: React.ReactNode; hint?: string; error?: string }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-[11px] font-medium text-red-600">{error}</span>
        : hint ? <span className="mt-1.5 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const errInput = 'border-red-400 focus:border-red-400';

function DatePicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(inputCls, 'flex items-center justify-between hover:bg-accent')}>
          <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>{selected ? value.split('-').reverse().join('/') : 'Seleccionar'}</span>
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-xl p-2">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => { if (date) { onChange(localDate(date)); setOpen(false); } }}
          locale={es}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

type FromOrderState = {
  fromOrderId?: number;
  fromOrder?: OrderForDocument;
};

export default function IndividualInvoice({ fixedDocType }: { fixedDocType: DocType }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromOrderState = (location.state || {}) as FromOrderState;
  const fromOrderId = Number(fromOrderState.fromOrderId) || 0;
  const appliedOrderRef = useRef<number | null>(null);
  const { role, loading: permissionsLoading } = usePermissions();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const setActiveCompanyId = useAppStore((s) => s.setActiveCompanyId);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [correlatives, setCorrelatives] = useState<Correlative[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [companyId, setCompanyId] = useState<number | ''>(activeCompanyId || '');
  const [branchId, setBranchId] = useState<number | ''>('');
  const [fechaEmision, setFechaEmision] = useState(localDate());

  // Cliente
  const [boletaConDni, setBoletaConDni] = useState(true); // boleta: DNI vs sin documento
  const [clientNumero, setClientNumero] = useState('');
  const [clientNombre, setClientNombre] = useState('');
  const [clientDireccion, setClientDireccion] = useState('');

  const [items, setItems] = useState<Item[]>([emptyItem()]);

  const [previewHtml, setPreviewHtml] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState('');

  const docType = fixedDocType;
  const isFactura = docType === '01';
  const listPath = isFactura ? '/facturas' : '/boletas';

  useEffect(() => {
    if (!fromOrderId || appliedOrderRef.current === fromOrderId) return;
    const apply = (order: OrderForDocument) => {
      const prefill = invoicePrefillFromOrder(order);
      if (prefill.companyId) setCompanyId(prefill.companyId);
      setClientNumero(prefill.clientNumero);
      setClientNombre(prefill.clientNombre);
      setClientDireccion(prefill.clientDireccion);
      setBoletaConDni(prefill.boletaConDni);
      if (prefill.items.length) {
        setItems(prefill.items.map((item) => ({
          id: crypto.randomUUID(),
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
        })));
      }
    };
    if (fromOrderState.fromOrder) apply(fromOrderState.fromOrder);
    void api.getManagedOrder(fromOrderId)
      .then((order: OrderForDocument) => {
        appliedOrderRef.current = fromOrderId;
        apply(order);
      })
      .catch(() => {
        appliedOrderRef.current = fromOrderId;
      });
  }, [fromOrderId]);

  useEffect(() => {
    if (permissionsLoading || role === 'viewer') return;
    api.listCompanies()
      .then((list: any[]) => setCompanies(Array.isArray(list) ? list : []))
      .catch((e: any) => setLoadError(e?.message || 'No se pudieron cargar las empresas.'))
      .finally(() => setLoading(false));
  }, [permissionsLoading, role]);

  useEffect(() => {
    if (!companyId) { setBranches([]); setBranchId(''); setCorrelatives([]); return; }
    api.listBranches(Number(companyId)).then((list: any[]) => {
      const active = Array.isArray(list) ? list : [];
      setBranches(active);
      // SUNAT valida el establecimiento anexo: usar el principal '0000' (siempre declarado).
      const main = active.find((b: any) => b.codigo === '0000') || active[0];
      setBranchId(main?.id ?? '');
    }).catch(() => setBranches([]));
  }, [companyId]);

  useEffect(() => {
    if (!branchId) { setCorrelatives([]); return; }
    api.getCorrelatives(Number(branchId)).then((list: any[]) => setCorrelatives(Array.isArray(list) ? list : [])).catch(() => setCorrelatives([]));
  }, [branchId]);

  const selectedBranch = useMemo(() => branches.find((b) => b.id === branchId), [branches, branchId]);
  const serie = useMemo(() => isFactura ? (selectedBranch?.seriesFactura?.[0] || 'F001') : (selectedBranch?.seriesBoleta?.[0] || 'B001'), [selectedBranch, isFactura]);
  const nextCorrelativo = useMemo(() => {
    const cor = correlatives.find((c) => c.tipoDocumento === docType && c.serie === serie);
    return pad6((cor ? Number(cor.correlativoActual) : 0) + 1);
  }, [correlatives, docType, serie]);

  const parsedItems = useMemo(() => items.map((it) => {
    const cantidadNum = Number(it.cantidad) || 0;
    const unitNum = Number(it.precioUnitario) || 0;
    return { ...it, cantidadNum, unitNum, lineTotal: round(cantidadNum * unitNum) };
  }), [items]);

  const totals = useMemo(() => {
    const total = round(parsedItems.reduce((s, it) => s + it.lineTotal, 0));
    return { total, ...splitTotal(total) };
  }, [parsedItems]);

  const updateItem = (id: string, patch: Partial<Item>) => setItems((p) => p.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const addItem = () => setItems((p) => [...p, emptyItem()]);
  const removeItem = (id: string) => setItems((p) => (p.length <= 1 ? p : p.filter((it) => it.id !== id)));

  const clientTipo = isFactura ? '6' : (boletaConDni ? '1' : '0');

  // Errores por campo (para mostrar en el input, no como banner).
  const errs = useMemo(() => {
    const e: { company?: string; numero?: string; nombre?: string; items: Record<string, { descripcion?: string; cantidad?: string; unit?: string }> } = { items: {} };
    if (!companyId) e.company = 'Selecciona una empresa.';
    else if (!branchId) e.company = 'La empresa no tiene sucursal activa.';
    if (isFactura) {
      if (!/^\d{11}$/.test(clientNumero.trim())) e.numero = 'RUC de 11 dígitos.';
      if (!clientNombre.trim()) e.nombre = 'Ingresa la razón social.';
    } else {
      if (boletaConDni && !clientNumero.trim()) e.numero = 'Ingresa el DNI.';
      if (!clientNombre.trim()) e.nombre = 'Ingresa el nombre.';
    }
    for (const it of parsedItems) {
      const ie: { descripcion?: string; cantidad?: string; unit?: string } = {};
      if (!it.descripcion.trim()) ie.descripcion = 'Descripción';
      if (it.cantidadNum <= 0) ie.cantidad = 'Cantidad';
      if (it.unitNum <= 0) ie.unit = 'Precio';
      if (ie.descripcion || ie.cantidad || ie.unit) e.items[it.id] = ie;
    }
    return e;
  }, [companyId, branchId, isFactura, boletaConDni, clientNumero, clientNombre, parsedItems]);

  const hasErrors = !!(errs.company || errs.numero || errs.nombre || Object.keys(errs.items).length);
  const fe = (v?: string) => (showErrors ? v : undefined); // muestra el error solo tras intentar

  const detalles = () => parsedItems.map((it) => {
    const { base } = splitTotal(it.lineTotal);
    return {
      codigo: '0001', descripcion: it.descripcion, unidad: 'NIU', cantidad: it.cantidadNum,
      mto_valor_unitario: round(base / it.cantidadNum), mto_bruto: it.lineTotal,
      porcentaje_igv: IGV_RATE, tip_afe_igv: '10',
    };
  });

  const buildInput = () => ({
    company_id: Number(companyId), branch_id: Number(branchId), serie,
    fecha_emision: fechaEmision, moneda: 'PEN', tipo_operacion: '0101', ubl_version: '2.1',
    metodo_envio: 'individual', persistCorrelative: false,
    client: { tipo_documento: clientTipo, numero_documento: clientNumero, razon_social: clientNombre, direccion: isFactura ? clientDireccion : undefined },
    detalles: detalles(),
  });

  const buildVenta = () => ({
    serie, fechaEmision, moneda: 'PEN', total: totals.total,
    client: { tipoDocumento: clientTipo, numeroDocumento: clientNumero, razonSocial: clientNombre, direccion: isFactura ? clientDireccion : undefined },
    detalles: detalles().map((d) => ({ codigo: d.codigo, descripcion: d.descripcion, unidad: d.unidad, cantidad: d.cantidad, mtoValorUnitario: d.mto_valor_unitario, mtoBruto: d.mto_bruto, porcentajeIgv: d.porcentaje_igv, tipAfeIgv: d.tip_afe_igv })),
  });

  async function preview() {
    setShowErrors(true);
    if (hasErrors) return;
    setServerError(''); setPreviewing(true);
    try {
      const html = isFactura ? await api.previewFacturaHtml(Number(companyId), buildVenta()) : await api.previewBoletaHtml(Number(companyId), buildVenta());
      setPreviewHtml(html?.html || String(html));
      setPreviewOpen(true);
    } catch (e: any) { setServerError(e?.message || 'No se pudo generar la vista previa.'); }
    finally { setPreviewing(false); }
  }

  async function emit() {
    setShowErrors(true);
    if (hasErrors) return;
    setServerError(''); setEmitting(true);
    try {
      const created = isFactura ? await api.createFactura(buildInput()) : await api.createBoleta(buildInput());
      const id = created?.id;
      if (!id) throw new Error(`No se creó la ${isFactura ? 'factura' : 'boleta'}.`);
      await (isFactura ? api.sendFacturaToSunat(id) : api.sendBoletaToSunat(id));
      // Emitida → volver a la lista (que se recarga sola al montar) con el nuevo documento.
      navigate(listPath);
    } catch (e: any) { setServerError(e?.message || 'Error al emitir.'); }
    finally { setEmitting(false); }
  }

  if (!permissionsLoading && role === 'viewer') return <Navigate to={listPath} replace />;
  if (loading || permissionsLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (loadError) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mr-2 inline h-4 w-4" />{loadError}</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-6">
      {/* Volver + tipo de documento fijo por ruta */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(listPath)} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {isFactura ? 'Facturas' : 'Boletas'}
        </button>
        <Badge variant="outline" className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground">
          {isFactura ? 'Factura electrónica' : 'Boleta electrónica'}
        </Badge>
      </div>

      {/* Emisor */}
      <section className="space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Emisor</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Empresa" error={fe(errs.company)}>
            <Select value={companyId ? String(companyId) : ''} onValueChange={(v) => { const id = Number(v); setCompanyId(id); setActiveCompanyId(id); api.setActiveCompanyId(id); }}>
              <SelectTrigger className={cn('h-10 w-full', fe(errs.company) && errInput)}><SelectValue placeholder="Seleccionar empresa" /></SelectTrigger>
              <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre || c.razonSocial} — {c.ruc}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Fecha de emisión"><DatePicker value={fechaEmision} onChange={setFechaEmision} /></Field>
        </div>
      </section>

      {/* Cliente */}
      <section className="space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente</p>
        {fromOrderId ? (
          <p className="text-xs text-muted-foreground">Datos del pedido. Revisa y emite cuando corresponda.</p>
        ) : null}
        {isFactura ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="RUC" hint="11 dígitos" error={fe(errs.numero)}>
              <input inputMode="numeric" maxLength={11} value={clientNumero} onChange={(e) => setClientNumero(e.target.value.replace(/\D/g, ''))} placeholder="20123456789" className={cn(inputCls, fe(errs.numero) && errInput)} />
            </Field>
            <Field label="Razón social" error={fe(errs.nombre)}>
              <input value={clientNombre} onChange={(e) => setClientNombre(e.target.value)} placeholder="EMPRESA S.A.C." className={cn(inputCls, fe(errs.nombre) && errInput)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Dirección fiscal" hint="Opcional">
                <input value={clientDireccion} onChange={(e) => setClientDireccion(e.target.value)} placeholder="Av. …" className={inputCls} />
              </Field>
            </div>
          </div>
        ) : (
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field label="Documento">
              <div className="inline-flex w-fit rounded-lg bg-muted p-1">
                <button onClick={() => setBoletaConDni(true)} className={cn('rounded-md px-4 py-2 text-sm font-medium transition', boletaConDni ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>DNI</button>
                <button onClick={() => setBoletaConDni(false)} className={cn('rounded-md px-4 py-2 text-sm font-medium transition', !boletaConDni ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Sin documento</button>
              </div>
            </Field>
            {boletaConDni && (
              <Field label="N° de DNI" hint="8 dígitos" error={fe(errs.numero)}>
                <input inputMode="numeric" maxLength={8} value={clientNumero} onChange={(e) => setClientNumero(e.target.value.replace(/\D/g, ''))} placeholder="12345678" className={cn(inputCls, fe(errs.numero) && errInput)} />
              </Field>
            )}
            <div className={boletaConDni ? 'sm:col-span-2' : ''}>
              <Field label="Nombre del cliente" error={fe(errs.nombre)}>
                <input value={clientNombre} onChange={(e) => setClientNombre(e.target.value)} placeholder="Juan Pérez" className={cn(inputCls, fe(errs.nombre) && errInput)} />
              </Field>
            </div>
          </div>
        )}
      </section>

      {/* Items */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Items</p>
          <button onClick={addItem} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-accent"><Plus className="h-4 w-4" /> Agregar item</button>
        </div>
        <div className="grid grid-cols-[1fr_5rem_7rem_7rem_2rem] items-center gap-3 px-1 text-[11px] font-medium text-muted-foreground">
          <span>Descripción</span><span className="text-center">Cantidad</span><span className="text-right">Precio unit.</span><span className="text-right">Total</span><span />
        </div>
        <div className="space-y-2">
          {parsedItems.map((it) => {
            const ie = showErrors ? errs.items[it.id] : undefined;
            return (
              <div key={it.id} className="grid grid-cols-[1fr_5rem_7rem_7rem_2rem] items-center gap-3">
                <input value={it.descripcion} onChange={(e) => updateItem(it.id, { descripcion: e.target.value })} placeholder="Producto o servicio" className={cn(inputCls, 'h-9', ie?.descripcion && errInput)} />
                <input inputMode="numeric" value={it.cantidad} onChange={(e) => updateItem(it.id, { cantidad: e.target.value.replace(/[^\d]/g, '') })} className={cn(inputCls, 'h-9 text-center', ie?.cantidad && errInput)} />
                <input inputMode="decimal" value={it.precioUnitario} onChange={(e) => updateItem(it.id, { precioUnitario: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0.00" className={cn(inputCls, 'h-9 text-right', ie?.unit && errInput)} />
                <span className="text-right text-sm font-medium text-foreground">{money(it.lineTotal)}</span>
                <button onClick={() => removeItem(it.id)} disabled={items.length <= 1} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Resumen */}
      <section className="space-y-3 border-t border-border pt-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <span className="text-muted-foreground">Serie <span className="ml-1 font-mono font-medium text-foreground">{serie}</span></span>
          <span className="text-muted-foreground">Correlativo <span className="ml-1 font-mono font-medium text-foreground">{nextCorrelativo}</span></span>
          <span className="text-muted-foreground">Base <span className="ml-1 font-medium text-foreground">{money(totals.base)}</span></span>
          <span className="text-muted-foreground">IGV (18%) <span className="ml-1 font-medium text-foreground">{money(totals.igv)}</span></span>
          <span className="ml-auto flex items-baseline gap-2">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-2xl font-bold tracking-tight text-foreground">{money(totals.total)}</span>
          </span>
        </div>

        {/* Error real del servidor (validación va por input) */}
        {serverError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="inline-flex items-center gap-1.5"><AlertCircle className="h-4 w-4" />{serverError}</span>
          </div>
        )}
      </section>

      {/* Acciones (inline, no tapa nada) */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-5">
        <button onClick={preview} disabled={previewing || emitting} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-50">
          {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Vista previa
        </button>
        <button onClick={emit} disabled={emitting || previewing} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
          {emitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Emitir {isFactura ? 'factura' : 'boleta'}
        </button>
      </div>

      {/* Vista previa en modal (se ve completa, con scroll) */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Vista previa — {isFactura ? 'Factura' : 'Boleta'}</DialogTitle></DialogHeader>
          <div className="p-4">
            <iframe srcDoc={previewHtml} title="Vista previa" className="h-[75vh] w-full rounded-lg border border-border bg-white" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
