import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  User,
  ShoppingBag,
  Send,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Download,
  Eye,
  FileText,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Check,
  Receipt,
} from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { es } from 'date-fns/locale';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import { useAppStore } from '../stores/app';

type DocType = '03' | '01';
type ClientDocType = '0' | '1' | '6';

interface Item {
  id: string;
  descripcion: string;
  cantidad: string;
  precioTotal: string;
}

interface Company {
  id: number;
  nombre: string;
  razonSocial: string;
  ruc: string;
  modoProduccion?: boolean;
}

interface Branch {
  id: number;
  codigo: string;
  nombre: string;
  seriesBoleta?: string[] | null;
  seriesFactura?: string[] | null;
}

interface Correlative {
  id: number;
  branchId: number;
  tipoDocumento: string;
  serie: string;
  correlativoActual: string;
  activo: boolean;
}

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: '03', label: 'Boleta' },
  { value: '01', label: 'Factura' },
];

const CLIENT_DOC_TYPES: { value: ClientDocType; label: string }[] = [
  { value: '0', label: 'Sin documento' },
  { value: '1', label: 'DNI' },
  { value: '6', label: 'RUC' },
];

const IGV_RATE = 18;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function splitTotal(total: number) {
  const base = round(total / (1 + IGV_RATE / 100));
  const igv = round(total - base);
  return { base, igv };
}

function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyItem(): Item {
  return { id: crypto.randomUUID(), descripcion: '', cantidad: '', precioTotal: '' };
}

function padCorrelative(value: number): string {
  return String(value).padStart(6, '0');
}

function DatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = value ? parseISO(value) : undefined;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {selected ? format(selected, 'dd/MM/yyyy') : 'Seleccionar fecha'}
        </span>
        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(date) => {
              if (date) {
                onChange(formatLocalDate(date));
                setOpen(false);
              }
            }}
            locale={es}
            showOutsideDays
            className="text-sm"
          />
        </div>
      )}
    </div>
  );
}

export default function IndividualInvoice() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const setActiveCompanyId = useAppStore((s) => s.setActiveCompanyId);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [correlatives, setCorrelatives] = useState<Correlative[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [docType, setDocType] = useState<DocType>('03');
  const [companyId, setCompanyId] = useState<number | ''>(activeCompanyId || '');
  const [branchId, setBranchId] = useState<number | ''>('');
  const [fechaEmision, setFechaEmision] = useState(formatLocalDate());

  const [clientTipo, setClientTipo] = useState<ClientDocType>(docType === '03' ? '1' : '6');
  const [clientNumero, setClientNumero] = useState('');
  const [clientNombre, setClientNombre] = useState('');

  const [items, setItems] = useState<Item[]>([emptyItem()]);

  const [previewHtml, setPreviewHtml] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ success?: boolean; message?: string; numero?: string; documentId?: number; tipo?: DocType } | null>(null);

  useEffect(() => {
    api
      .listCompanies()
      .then((list: any[]) => setCompanies(Array.isArray(list) ? list : []))
      .catch((e: any) => setLoadError(e?.message || 'No se pudieron cargar las empresas.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setClientTipo(docType === '03' ? '1' : '6');
  }, [docType]);

  useEffect(() => {
    if (!companyId) {
      setBranches([]);
      setBranchId('');
      setCorrelatives([]);
      return;
    }
    api
      .listBranches(Number(companyId))
      .then((list: any[]) => {
        const active = Array.isArray(list) ? list : [];
        setBranches(active);
        setBranchId(active.length > 0 ? active[0].id : '');
      })
      .catch(() => setBranches([]));
  }, [companyId]);

  useEffect(() => {
    if (!branchId) {
      setCorrelatives([]);
      return;
    }
    api
      .getCorrelatives(Number(branchId))
      .then((list: any[]) => setCorrelatives(Array.isArray(list) ? list : []))
      .catch(() => setCorrelatives([]));
  }, [branchId, docType]);

  const selectedBranch = useMemo(() => branches.find((b) => b.id === branchId), [branches, branchId]);
  const selectedCompany = useMemo(() => companies.find((c) => c.id === companyId), [companies, companyId]);
  const serie = useMemo(() => {
    if (docType === '03') return selectedBranch?.seriesBoleta?.[0] || 'B001';
    return selectedBranch?.seriesFactura?.[0] || 'F001';
  }, [selectedBranch, docType]);

  const docLabel = docType === '03' ? 'Boleta' : 'Factura';
  const docLabelLower = docType === '03' ? 'boleta' : 'factura';

  const nextCorrelativo = useMemo(() => {
    const cor = correlatives.find((c) => c.tipoDocumento === docType && c.serie === serie);
    return padCorrelative((cor ? Number(cor.correlativoActual) : 0) + 1);
  }, [correlatives, docType, serie]);

  const parsedItems = useMemo(
    () => items.map((item) => ({ ...item, precioNum: Number(item.precioTotal) || 0, cantidadNum: Number(item.cantidad) || 0 })),
    [items]
  );

  const totals = useMemo(() => {
    const total = round(parsedItems.reduce((sum, item) => sum + item.precioNum, 0));
    const { base, igv } = splitTotal(total);
    return { total, base, igv };
  }, [parsedItems]);

  function updateItem(id: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(id: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((item) => item.id !== id)));
  }

  function validate(): string {
    if (!companyId) return 'Selecciona una empresa.';
    if (!branchId) return 'La empresa no tiene sucursal activa.';
    if (!fechaEmision) return 'Selecciona la fecha de emisión.';
    if (!clientNombre.trim()) return 'Ingresa el nombre o razón social del cliente.';
    if (clientTipo !== '0' && !clientNumero.trim()) return 'Ingresa el número de documento.';
    if (items.length === 0) return 'Agrega al menos un item.';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.descripcion.trim()) return `Item ${i + 1}: ingresa una descripción.`;
      const cantidad = Number(item.cantidad);
      if (Number.isNaN(cantidad) || cantidad <= 0) return `Item ${i + 1}: la cantidad debe ser mayor a 0.`;
      const precio = Number(item.precioTotal);
      if (Number.isNaN(precio) || precio <= 0) return `Item ${i + 1}: el monto debe ser mayor a 0.`;
    }
    return '';
  }

  function buildInput() {
    return {
      company_id: Number(companyId),
      branch_id: Number(branchId),
      serie,
      fecha_emision: fechaEmision,
      moneda: 'PEN',
      tipo_operacion: '0101',
      ubl_version: '2.1',
      metodo_envio: 'individual',
      persistCorrelative: false,
      client: {
        tipo_documento: clientTipo,
        numero_documento: clientNumero,
        razon_social: clientNombre,
      },
      detalles: parsedItems.map((item) => {
        const { base } = splitTotal(item.precioNum);
        return {
          codigo: '0001',
          descripcion: item.descripcion,
          unidad: 'NIU',
          cantidad: item.cantidadNum,
          mto_valor_unitario: round(base / item.cantidadNum),
          mto_bruto: item.precioNum,
          porcentaje_igv: IGV_RATE,
          tip_afe_igv: '10',
        };
      }),
    };
  }

  function buildVenta() {
    return {
      serie,
      fechaEmision,
      moneda: 'PEN',
      total: totals.total,
      client: {
        tipoDocumento: clientTipo,
        numeroDocumento: clientNumero,
        razonSocial: clientNombre,
      },
      detalles: parsedItems.map((item) => {
        const { base } = splitTotal(item.precioNum);
        return {
          codigo: '0001',
          descripcion: item.descripcion,
          unidad: 'NIU',
          cantidad: item.cantidadNum,
          mtoValorUnitario: round(base / item.cantidadNum),
          mtoBruto: item.precioNum,
          porcentajeIgv: IGV_RATE,
          tipAfeIgv: '10',
        };
      }),
    };
  }

  async function preview() {
    const err = validate();
    if (err) return setError(err);
    setError('');
    setPreviewing(true);
    setShowPreview(true);
    try {
      const html = docType === '03'
        ? await api.previewBoletaHtml(Number(companyId), buildVenta())
        : await api.previewFacturaHtml(Number(companyId), buildVenta());
      setPreviewHtml(html?.html || String(html));
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar la vista previa.');
    } finally {
      setPreviewing(false);
    }
  }

  async function emit() {
    const err = validate();
    if (err) return setError(err);
    setError('');
    setResult(null);
    setEmitting(true);
    try {
      if (docType === '03') {
        const created = await api.createBoleta(buildInput());
        const boletaId = created?.id;
        if (!boletaId) throw new Error('No se creó la boleta.');
        const sent = await api.sendBoletaToSunat(boletaId);
        setResult({ success: sent?.success, message: sent?.message || 'Boleta enviada a SUNAT (beta).', numero: created?.numeroCompleto, documentId: boletaId, tipo: docType });
      } else {
        const created = await api.createFactura(buildInput());
        const facturaId = created?.id;
        if (!facturaId) throw new Error('No se creó la factura.');
        const sent = await api.sendFacturaToSunat(facturaId);
        setResult({ success: sent?.success, message: sent?.message || 'Factura enviada a SUNAT (beta).', numero: created?.numeroCompleto, documentId: facturaId, tipo: docType });
      }
    } catch (e: any) {
      setError(e?.message || `Error al emitir la ${docLabelLower}.`);
    } finally {
      setEmitting(false);
    }
  }

  async function downloadPdf() {
    if (!result?.documentId) return;
    try {
      const res = result.tipo === '03'
        ? await api.generateBoletaPdf(result.documentId)
        : await api.generateFacturaPdf(result.documentId);
      const base64 = res?.base64;
      if (!base64) return;
      const link = document.createElement('a');
      link.href = `data:application/pdf;base64,${base64}`;
      link.download = `${result.numero}.pdf`;
      link.click();
    } catch (e: any) {
      setError(e?.message || 'No se pudo descargar el PDF.');
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          <span className="font-medium">{loadError}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Emisión individual</h1>
        <p className="text-sm text-muted-foreground">Completa los datos y emite una boleta o factura.</p>
      </div>

      {/* Selector de tipo de documento */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-lg border bg-card p-1 shadow-sm">
          {DOC_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setDocType(t.value)}
              className={`rounded-md px-6 py-2.5 text-sm font-medium transition-colors ${
                docType === t.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Formulario principal */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        {/* Sección: Emisor y cliente */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 border-b pb-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Emisor y cliente</h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Empresa</label>
                <select
                  value={companyId}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : '';
                    setCompanyId(id);
                    setActiveCompanyId(id || null);
                    api.setActiveCompanyId(id || null);
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Seleccionar empresa</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre || c.razonSocial} — {c.ruc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Fecha</label>
                <DatePicker value={fechaEmision} onChange={setFechaEmision} />
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1 space-y-2">
                  <label className="text-sm font-medium leading-none">Tipo doc.</label>
                  <select
                    value={clientTipo}
                    onChange={(e) => setClientTipo(e.target.value as ClientDocType)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {CLIENT_DOC_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 space-y-2">
                  <label className="text-sm font-medium leading-none">Número</label>
                  <input
                    type="text"
                    value={clientNumero}
                    onChange={(e) => setClientNumero(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="—"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Nombre o razón social</label>
                <input
                  type="text"
                  value={clientNombre}
                  onChange={(e) => setClientNombre(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Ej: Juan Pérez"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="my-8 h-px bg-border" />

        {/* Sección: Items */}
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Items</h2>
            </div>
            <button
              onClick={addItem}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar item
            </button>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-3 px-2 text-xs font-medium text-muted-foreground">
              <div className="col-span-6">Descripción</div>
              <div className="col-span-2">Cantidad</div>
              <div className="col-span-3">Monto total</div>
              <div className="col-span-1"></div>
            </div>
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-12 gap-3 rounded-md border bg-background p-2">
                <div className="col-span-6">
                  <input
                    type="text"
                    value={item.descripcion}
                    onChange={(e) => updateItem(item.id, { descripcion: e.target.value })}
                    placeholder="Producto o servicio"
                    className="h-9 w-full rounded-md border-0 bg-transparent px-2 text-sm focus:bg-accent/30 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={item.cantidad}
                    onChange={(e) => updateItem(item.id, { cantidad: Number(e.target.value) })}
                    className="h-9 w-full rounded-md border-0 bg-transparent px-2 text-sm text-center focus:bg-accent/30 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.precioTotal}
                    placeholder="0.00"
                    onChange={(e) => updateItem(item.id, { precioTotal: e.target.value })}
                    className="h-9 w-full rounded-md border-0 bg-transparent px-2 text-sm text-right focus:bg-accent/30 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="col-span-1 flex items-center justify-center">
                  {items.length > 1 && (
                    <button
                      onClick={() => removeItem(item.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="my-8 h-px bg-border" />

        {/* Resumen y acciones */}
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Resumen</h2>
            </div>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">Beta</span>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Serie</p>
              <p className="text-lg font-semibold">{serie}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Correlativo</p>
              <p className="text-lg font-semibold">{nextCorrelativo}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Base</p>
              <p className="text-lg font-semibold">S/ {totals.base.toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">IGV</p>
              <p className="text-lg font-semibold">S/ {totals.igv.toFixed(2)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total a pagar</p>
              <p className="text-sm text-muted-foreground">Incluye IGV ({IGV_RATE}%)</p>
            </div>
            <p className="text-3xl font-bold tracking-tight text-primary">S/ {totals.total.toFixed(2)}</p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              {error ? (
                <span className="inline-flex items-center gap-1.5 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </span>
              ) : result ? (
                <span className="inline-flex items-center gap-1.5 text-green-700">
                  <Check className="h-4 w-4" />
                  {result.numero} — {result.message}
                </span>
              ) : (
                <span className="text-muted-foreground">Listo para emitir.</span>
              )}
            </div>
            <div className="flex gap-3">
              {result?.success && result.documentId && (
                <button
                  onClick={downloadPdf}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Download className="h-4 w-4" />
                  PDF
                </button>
              )}
              <button
                onClick={preview}
                disabled={previewing || emitting}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              >
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Vista previa
              </button>
              <button
                onClick={emit}
                disabled={emitting || previewing}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {emitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Emitir {docLabelLower}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Vista previa */}
      {showPreview && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Vista previa</h3>
            <button
              onClick={() => setShowPreview(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
          {previewHtml ? (
            <div
              className="max-h-96 overflow-auto rounded-lg border bg-white p-4 text-sm"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
              {previewing ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Generando vista previa...'}
            </div>
          )}
        </div>
      )}

      {!showPreview && (
        <button
          onClick={() => setShowPreview(true)}
          className="mx-auto flex items-center gap-2 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className="h-4 w-4" />
          Mostrar vista previa
        </button>
      )}
    </div>
  );
}
