import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileMinus2,
  Loader2,
  Receipt,
  Shuffle,
  Target,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { Loading } from '../components/Loading';
import api from '../lib/api';

type PickMode = 'cantidad' | 'monto';
type GroupFilter = 'todos' | 'limbo' | 'higher';
type InfoTab = 'anular' | 'anuladas' | 'fuera_mes' | 'resumen';

interface Props {
  companies: any[];
  activeCompanyId: number | null;
  month: string;
  onMonthChange: (value: string) => void;
  onSelectCompany: (id: number) => Promise<void>;
}

interface ProgressRow {
  boletaId: number;
  numeroCompleto: string;
  empresa: string;
  total: number;
  status: 'pending' | 'processing' | 'success' | 'error';
  message?: string;
  creditNoteNumero?: string;
}

const SHARED_RUC = '20607809136';

const monthNames = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function parseMonth(value: string) {
  const [yearRaw, monthRaw] = value.split('-');
  const year = Number(yearRaw) || new Date().getFullYear();
  const monthIndex = Math.max(0, Math.min(11, (Number(monthRaw) || 1) - 1));
  return { year, monthIndex };
}

function monthValue(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function endOfMonth(value: string) {
  const { year, monthIndex } = parseMonth(value);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return `${value}-${String(lastDay).padStart(2, '0')}`;
}

function formatMonthLabel(value: string) {
  const { year, monthIndex } = parseMonth(value);
  return `${monthNames[monthIndex]} ${year}`;
}

function monthFromDate(value?: string | null) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

const money = (n: number) =>
  `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const amountOf = (row: any) => parseFloat(row?.mtoImpVenta || '0') || 0;

const round2 = (n: number) => Math.round(n * 100) / 100;

function igvOf(row: any) {
  const raw = row?.totalImpuestos;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const parsed = Math.abs(parseFloat(String(raw)));
    if (Number.isFinite(parsed)) return parsed;
  }
  return round2(amountOf(row) * 18 / 118);
}

function taxSummary(rows: any[]) {
  const total = round2(rows.reduce((sum, row) => sum + amountOf(row), 0));
  const igv = round2(rows.reduce((sum, row) => sum + igvOf(row), 0));
  const base = round2(total - igv);
  return { total, base, igv };
}

function affectedDateOf(note: any) {
  return note?.affectedBoletaFechaEmision || note?.datosAdicionales?.affectedDate || null;
}

function fiscalMonthOfBoleta(boleta: any) {
  // El periodo tributario de una boleta es su fecha de emision (registro de ventas),
  // no la fecha del resumen diario: el resumen puede enviarse tarde en otro mes y eso
  // no cambia el mes al que pertenece la boleta. Asi, una boleta emitida en abril cuyo
  // resumen salio en mayo NO debe contarse en mayo.
  return monthFromDate(boleta?.fechaEmision) || monthFromDate(boleta?.summaryFechaResumen);
}

// Mes de origen real de la boleta. Si su fecha de emision fue reasignada a otro periodo
// (porque SUNAT la declaro en otro mes via resumen tardio), se guarda la fecha original en
// datos_adicionales.fecha_emision_original. Ese es el mes al que "pertenece" la venta.
function originMonthOf(boleta: any) {
  return monthFromDate(boleta?.datosAdicionales?.fecha_emision_original)
    || monthFromDate(boleta?.fechaEmision)
    || monthFromDate(boleta?.summaryFechaResumen);
}

function companyText(company: any) {
  return [
    company?.nombre,
    company?.nombreComercial,
    company?.nombre_comercial,
    company?.razonSocial,
    company?.razon_social,
  ].filter(Boolean).join(' ').toUpperCase();
}

function companyLabel(company: any) {
  return company?.nombreComercial || company?.nombre_comercial || company?.nombre || company?.razonSocial || company?.razon_social || 'Empresa';
}

function companyKind(company: any): 'limbo' | 'higher' {
  const text = companyText(company);
  return text.includes('HIGHER') ? 'higher' : 'limbo';
}

function kindLabel(kind: 'limbo' | 'higher') {
  return kind === 'higher' ? 'Higher' : 'Limbo';
}

function shuffle<T>(arr: T[]): T[] {
  const pool = [...arr];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <div className="flex min-h-[130px] items-start gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className={`shrink-0 rounded-xl p-3 ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold leading-none text-foreground">{value}</p>
        <p className="mt-3 text-sm leading-snug text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function CompanySummaryCard({
  name,
  total,
  count,
  availableCount,
  availableTotal,
  notesCount,
  notesTotal,
  outsideCount,
  outsideTotal,
  accent,
}: {
  name: string;
  total: number;
  count: number;
  availableCount: number;
  availableTotal: number;
  notesCount: number;
  notesTotal: number;
  outsideCount: number;
  outsideTotal: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empresa interna</p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">{name}</h3>
        </div>
        <div className={`rounded-xl p-3 ${accent}`}>
          <Receipt className="h-5 w-5" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total considerado</p>
          <p className="mt-1 text-3xl font-semibold leading-none text-foreground">{money(total)}</p>
          <p className="mt-2 text-sm text-muted-foreground">{count} boleta(s)</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sin nota</p>
          <p className="mt-1 text-base font-semibold">{availableCount} boleta(s)</p>
          <p className="mt-1 text-xs text-muted-foreground">{money(availableTotal)}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fuera del mes</p>
          <p className="mt-1 text-base font-semibold">{outsideCount} boleta(s)</p>
          <p className="mt-1 text-xs text-muted-foreground">{money(outsideTotal)}</p>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
        {notesCount} nota(s) de crédito emitida(s) · {money(notesTotal)}
      </div>
    </div>
  );
}

function MonthPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = parseMonth(value);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selected.year);

  useEffect(() => {
    setViewYear(parseMonth(value).year);
  }, [value]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="inline-flex h-11 min-w-[220px] items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 text-sm shadow-sm transition hover:bg-accent"
      >
        <span className="inline-flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mes</span>
          <span className="font-medium">{formatMonthLabel(value)}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[320px] rounded-xl border border-border bg-popover p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewYear((year) => year - 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-semibold">{viewYear}</div>
            <button
              type="button"
              onClick={() => setViewYear((year) => year + 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-accent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {monthNames.map((name, index) => {
              const month = monthValue(viewYear, index);
              const active = month === value;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onChange(month);
                    setOpen(false);
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-background text-foreground hover:bg-accent'
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SharedRucCreditNotes({
  companies,
  activeCompanyId,
  month,
  onMonthChange,
  onSelectCompany,
}: Props) {
  const sharedCompanies = useMemo(() => {
    const rows = companies
      .filter((company) => company?.ruc === SHARED_RUC)
      .filter((company) => {
        const text = `${company?.nombre || ''} ${company?.nombreComercial || ''} ${company?.razonSocial || ''}`.toUpperCase();
        return text.includes('LIMBO') || text.includes('HIGHER');
      })
      .sort((a, b) => companyKind(a).localeCompare(companyKind(b)));
    return rows.length ? rows : companies.filter((company) => company?.id === activeCompanyId);
  }, [companies, activeCompanyId]);

  const [boletas, setBoletas] = useState<any[]>([]);
  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [modoProduccion, setModoProduccion] = useState(false);
  const [infoTab, setInfoTab] = useState<InfoTab>('anuladas');
  const [filter, setFilter] = useState<GroupFilter>('todos');
  const [mode, setMode] = useState<PickMode>('cantidad');
  const [qty, setQty] = useState(5);
  const [maxAmount, setMaxAmount] = useState(2000);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedOrder, setSelectedOrder] = useState<number[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressRows, setProgressRows] = useState<ProgressRow[]>([]);
  const [progressMessage, setProgressMessage] = useState('');

  const load = async (options: { preserveResults?: boolean } = {}) => {
    if (!sharedCompanies.length) return;
    try {
      setLoading(true);
      setError('');
      if (!options.preserveResults) setResults(null);
      setSelected(new Set());
      setSelectedOrder([]);

      const responses = await Promise.all(sharedCompanies.flatMap((company) => [
        api.listBoletas({
          companyId: company.id,
          fechaDesde: `${month}-01`,
          fechaHasta: endOfMonth(month),
          summaryFechaDesde: `${month}-01`,
          summaryFechaHasta: endOfMonth(month),
          matchFechaEmisionOrSummary: true,
          limit: 3000,
        }).then((res: any) => ({
          kind: 'boletas',
          company,
          rows: (res?.boletas || []).map((row: any) => ({
            ...row,
            _companyName: companyLabel(company),
            _companyKind: companyKind(company),
          })),
        })),
        api.listCreditNotes({
          companyId: company.id,
          fechaDesde: `${month}-01`,
          fechaHasta: endOfMonth(month),
          estado: 'ACEPTADO',
          limit: 3000,
        }).then((res: any) => ({
          kind: 'notes',
          company,
          rows: (res?.creditNotes || []).map((row: any) => ({
            ...row,
            _companyName: companyLabel(company),
            _companyKind: companyKind(company),
          })),
        })),
      ]));

      setBoletas(responses.filter((res) => res.kind === 'boletas').flatMap((res) => res.rows));
      setCreditNotes(responses.filter((res) => res.kind === 'notes').flatMap((res) => res.rows));
    } catch (e: any) {
      setError(e?.message || 'Error al cargar Limbo y Higher');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, sharedCompanies.map((company) => company.id).join('|')]);

  const acceptedCreditNotes = useMemo(
    () => creditNotes.filter((note) => note.estadoSunat === 'ACEPTADO'),
    [creditNotes],
  );
  const acceptedBoletas = useMemo(
    () => boletas.filter((boleta) => boleta.estadoSunat === 'ACEPTADO' && !boleta.creditNoteId),
    [boletas],
  );
  const canceledBoletas = useMemo(
    () => boletas.filter((boleta) => boleta.estadoSunat === 'ANULADO' || boleta.creditNoteId),
    [boletas],
  );
  const allIssuedBoletas = useMemo(
    () => [...acceptedBoletas, ...canceledBoletas],
    [acceptedBoletas, canceledBoletas],
  );
  const fiscalIssuedBoletas = useMemo(
    () => allIssuedBoletas.filter((boleta) => fiscalMonthOfBoleta(boleta) === month),
    [allIssuedBoletas, month],
  );
  const fiscalAcceptedBoletas = useMemo(
    () => acceptedBoletas.filter((boleta) => fiscalMonthOfBoleta(boleta) === month),
    [acceptedBoletas, month],
  );
  const eligible = useMemo(
    // Se omiten las boletas de S/ 0: no tiene sentido emitir una nota de crédito sobre ellas.
    () => fiscalAcceptedBoletas.filter((boleta) => (filter === 'todos' || boleta._companyKind === filter) && amountOf(boleta) > 0),
    [fiscalAcceptedBoletas, filter],
  );
  const eligibleSummary = useMemo(() => {
    const rows = {
      todos: { count: 0, total: 0 },
      limbo: { count: 0, total: 0 },
      higher: { count: 0, total: 0 },
    };
    for (const row of fiscalAcceptedBoletas) {
      const key = row._companyKind === 'higher' ? 'higher' : 'limbo';
      rows.todos.count += 1;
      rows.todos.total += amountOf(row);
      rows[key].count += 1;
      rows[key].total += amountOf(row);
    }
    return rows;
  }, [fiscalAcceptedBoletas]);

  const totalIssued = useMemo(() => fiscalIssuedBoletas.reduce((sum, row) => sum + amountOf(row), 0), [fiscalIssuedBoletas]);
  const totalEligible = useMemo(() => fiscalAcceptedBoletas.reduce((sum, row) => sum + amountOf(row), 0), [fiscalAcceptedBoletas]);
  const currentSetBoletaIds = useMemo(() => new Set(fiscalIssuedBoletas.map((row) => row.id)), [fiscalIssuedBoletas]);
  const fiscalCreditNotes = useMemo(
    () => acceptedCreditNotes.filter((note) => {
      if (monthFromDate(note.fechaEmision) === month) return true;
      return Boolean(note.affectedBoletaId && currentSetBoletaIds.has(note.affectedBoletaId));
    }),
    [acceptedCreditNotes, currentSetBoletaIds, month],
  );
  const emittedNotesTotal = useMemo(
    () => acceptedCreditNotes.reduce((sum, row) => sum + amountOf(row), 0),
    [acceptedCreditNotes],
  );
  const totalNotes = useMemo(() => fiscalCreditNotes.reduce((sum, row) => sum + amountOf(row), 0), [fiscalCreditNotes]);
  const noteScopeSummary = useMemo(() => {
    const rows = {
      currentSet: { count: 0, total: 0 },
      otherBoletas: { count: 0, total: 0 },
      facturas: { count: 0, total: 0 },
    };
    for (const note of acceptedCreditNotes) {
      const amount = amountOf(note);
      if (!note.affectedBoletaId || note.tipoDocAfectado === '01') {
        rows.facturas.count += 1;
        rows.facturas.total += amount;
      } else if (currentSetBoletaIds.has(note.affectedBoletaId)) {
        rows.currentSet.count += 1;
        rows.currentSet.total += amount;
      } else {
        rows.otherBoletas.count += 1;
        rows.otherBoletas.total += amount;
      }
    }
    return rows;
  }, [acceptedCreditNotes, currentSetBoletaIds]);

  const outsideMonthBoletas = useMemo(
    () => allIssuedBoletas
      .filter((boleta) => {
        // Se declara/factura en este mes (fiscalMonth === month) pero su venta es de otro mes
        // de origen (fecha de emision original distinta). Solo aplica a esta pantalla LIMBO+HIGHER.
        const fiscalMonth = fiscalMonthOfBoleta(boleta);
        return fiscalMonth && fiscalMonth === month && originMonthOf(boleta) !== month;
      })
      .sort((a, b) => {
        const companyCompare = String(a._companyName).localeCompare(String(b._companyName));
        if (companyCompare !== 0) return companyCompare;
        const dateCompare = String(a.fechaEmision || '').localeCompare(String(b.fechaEmision || ''));
        if (dateCompare !== 0) return dateCompare;
        return String(a.numeroCompleto || '').localeCompare(String(b.numeroCompleto || ''));
      }),
    [allIssuedBoletas, month],
  );
  const outsideMonthTotal = useMemo(
    () => outsideMonthBoletas.reduce((sum, row) => sum + amountOf(row), 0),
    [outsideMonthBoletas],
  );

  const companySummary = useMemo(() => {
    const init = {
      limbo: { count: 0, total: 0, availableCount: 0, availableTotal: 0, notesCount: 0, notesTotal: 0, outsideCount: 0, outsideTotal: 0 },
      higher: { count: 0, total: 0, availableCount: 0, availableTotal: 0, notesCount: 0, notesTotal: 0, outsideCount: 0, outsideTotal: 0 },
    };
    for (const row of fiscalIssuedBoletas) {
      const key = row._companyKind === 'higher' ? 'higher' : 'limbo';
      init[key].count += 1;
      init[key].total += amountOf(row);
    }
    for (const row of fiscalAcceptedBoletas) {
      const key = row._companyKind === 'higher' ? 'higher' : 'limbo';
      init[key].availableCount += 1;
      init[key].availableTotal += amountOf(row);
    }
    for (const row of fiscalCreditNotes) {
      const key = row._companyKind === 'higher' ? 'higher' : 'limbo';
      init[key].notesCount += 1;
      init[key].notesTotal += amountOf(row);
    }
    for (const row of outsideMonthBoletas) {
      const key = row._companyKind === 'higher' ? 'higher' : 'limbo';
      init[key].outsideCount += 1;
      init[key].outsideTotal += amountOf(row);
    }
    return init;
  }, [fiscalAcceptedBoletas, fiscalCreditNotes, fiscalIssuedBoletas, outsideMonthBoletas]);

  const outsideMonthGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; company: string; count: number; total: number }>();
    for (const row of outsideMonthBoletas) {
      const rowMonth = originMonthOf(row) || 'sin_fecha';
      const key = `${row._companyKind}-${rowMonth}`;
      const current = groups.get(key) || {
        key,
        label: rowMonth === 'sin_fecha' ? 'Sin fecha' : formatMonthLabel(rowMonth),
        company: row._companyName,
        count: 0,
        total: 0,
      };
      current.count += 1;
      current.total += amountOf(row);
      groups.set(key, current);
    }
    return Array.from(groups.values());
  }, [outsideMonthBoletas]);

  const noteGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; count: number; total: number }>();
    for (const note of acceptedCreditNotes) {
      const affectedMonth = monthFromDate(affectedDateOf(note)) || 'sin_fecha';
      const key = `${note._companyKind}-${affectedMonth}`;
      const current = groups.get(key) || {
        key,
        label: `${note._companyName} · ${affectedMonth === 'sin_fecha' ? 'Sin fecha de boleta' : formatMonthLabel(affectedMonth)}`,
        count: 0,
        total: 0,
      };
      current.count += 1;
      current.total += amountOf(note);
      groups.set(key, current);
    }
    return Array.from(groups.values());
  }, [acceptedCreditNotes]);

  const taxVentas = useMemo(() => taxSummary(fiscalIssuedBoletas), [fiscalIssuedBoletas]);
  const taxNotas = useMemo(() => taxSummary(fiscalCreditNotes), [fiscalCreditNotes]);
  const taxNeto = useMemo(() => ({
    total: round2(taxVentas.total - taxNotas.total),
    base: round2(taxVentas.base - taxNotas.base),
    igv: round2(taxVentas.igv - taxNotas.igv),
  }), [taxVentas, taxNotas]);

  const selectedBoletas = useMemo(() => {
    const byId = new Map(eligible.map((row) => [row.id, row]));
    return selectedOrder.map((id) => byId.get(id)).filter(Boolean);
  }, [eligible, selectedOrder]);
  const selectedTotal = useMemo(() => selectedBoletas.reduce((sum, row) => sum + amountOf(row), 0), [selectedBoletas]);
  const unselected = useMemo(() => eligible.filter((row) => !selected.has(row.id)), [eligible, selected]);

  const clearSelection = () => {
    setSelected(new Set());
    setSelectedOrder([]);
  };

  const addOne = (id: number) => {
    setSelected((prev) => new Set(prev).add(id));
    setSelectedOrder((prev) => prev.includes(id) ? prev : [...prev, id]);
  };

  const removeOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedOrder((prev) => prev.filter((selectedId) => selectedId !== id));
  };

  const pickByQty = () => {
    const n = Math.max(1, Math.min(qty || 1, eligible.length));
    const ids = shuffle(eligible).slice(0, n).map((row) => row.id);
    setSelected(new Set(ids));
    setSelectedOrder(ids);
    setResults(null);
  };

  const pickByAmount = () => {
    const target = Math.max(0, maxAmount || 0);
    const chosen: number[] = [];
    let sum = 0;
    for (const row of shuffle(eligible)) {
      const amount = amountOf(row);
      if (sum + amount <= target) {
        chosen.push(row.id);
        sum += amount;
      }
    }
    setSelected(new Set(chosen));
    setSelectedOrder(chosen);
    setResults(null);
  };

  const runAnular = async () => {
    if (!selectedBoletas.length || processing) return;
    const confirmed = window.confirm(
      `Se emitirán ${selectedBoletas.length} nota(s) de crédito para Limbo/Higher en ${modoProduccion ? 'PRODUCCIÓN' : 'BETA'} por ${money(selectedTotal)}. ¿Continuar?`,
    );
    if (!confirmed) return;

    const initialRows = selectedBoletas.map((row: any) => ({
      boletaId: row.id,
      numeroCompleto: row.numeroCompleto,
      empresa: row._companyName,
      total: amountOf(row),
      status: 'pending' as const,
    }));
    const markRow = (boletaId: number, patch: Partial<ProgressRow>) => {
      setProgressRows((prev) => prev.map((row) => row.boletaId === boletaId ? { ...row, ...patch } : row));
    };

    try {
      setProcessing(true);
      setError('');
      setResults(null);
      setProgressRows(initialRows);
      setProgressOpen(true);
      setProgressMessage(`Preparando ${initialRows.length} nota(s) en ${modoProduccion ? 'Producción' : 'Beta'}...`);

      const outcomes: any[] = [];
      for (let index = 0; index < selectedBoletas.length; index++) {
        const row: any = selectedBoletas[index];
        setProgressMessage(`Anulando ${row._companyName} · ${row.numeroCompleto} (${index + 1}/${selectedBoletas.length})...`);
        markRow(row.id, { status: 'processing', message: 'Creando y enviando nota de crédito...' });
        try {
          const outcome = await api.createAndSendCreditNote(row.id, { modoProduccion });
          outcomes.push(outcome);
          if (outcome?.success) {
            markRow(row.id, {
              status: 'success',
              message: 'Nota aceptada por SUNAT.',
              creditNoteNumero: outcome.numeroCompleto,
            });
          } else {
            markRow(row.id, {
              status: 'error',
              message: outcome?.error?.message || 'SUNAT rechazó la nota de crédito.',
              creditNoteNumero: outcome?.numeroCompleto,
            });
          }
        } catch (e: any) {
          const outcome = {
            boletaId: row.id,
            success: false,
            error: { code: 'CREATE_ERROR', message: e?.message || 'Error al crear nota de crédito' },
          };
          outcomes.push(outcome);
          markRow(row.id, { status: 'error', message: outcome.error.message });
        }
      }

      setResults(outcomes);
      setProgressMessage(`Proceso terminado: ${outcomes.filter((row) => row.success).length} aceptada(s), ${outcomes.filter((row) => !row.success).length} fallida(s).`);
      await load({ preserveResults: true });
    } catch (e: any) {
      setError(e?.message || 'Error al anular boletas');
      setProgressMessage(e?.message || 'Error al anular boletas');
    } finally {
      setProcessing(false);
    }
  };

  const acceptedCount = results?.filter((row) => row.success).length ?? 0;
  const rejectedCount = results ? results.length - acceptedCount : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <select
            value={activeCompanyId ? String(activeCompanyId) : ''}
            onChange={(event) => event.target.value && onSelectCompany(Number(event.target.value))}
            className="min-w-[330px] bg-transparent outline-none"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.nombre || company.razonSocial} ({company.ruc})
              </option>
            ))}
          </select>
        </div>
        <MonthPicker value={month} onChange={onMonthChange} />
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm">
          <span className="text-xs font-medium text-muted-foreground">SUNAT:</span>
          <button
            type="button"
            role="switch"
            aria-checked={modoProduccion}
            onClick={() => setModoProduccion((value) => !value)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${modoProduccion ? 'bg-emerald-600' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${modoProduccion ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className={`text-sm font-medium ${modoProduccion ? 'text-emerald-600' : 'text-amber-600'}`}>
            {modoProduccion ? 'Producción' : 'Beta'}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Pantalla especial Limbo/Higher</p>
            <p className="mt-0.5">
              RUC compartido {SHARED_RUC}: SUNAT se lee junto, pero acá se separa por empresa interna.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <Loading label="Cargando Limbo y Higher..." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <CompanySummaryCard
              name="Limbo"
              total={companySummary.limbo.total}
              count={companySummary.limbo.count}
              availableCount={companySummary.limbo.availableCount}
              availableTotal={companySummary.limbo.availableTotal}
              notesCount={companySummary.limbo.notesCount}
              notesTotal={companySummary.limbo.notesTotal}
              outsideCount={companySummary.limbo.outsideCount}
              outsideTotal={companySummary.limbo.outsideTotal}
              accent="bg-sky-100 text-sky-700"
            />
            <CompanySummaryCard
              name="Higher"
              total={companySummary.higher.total}
              count={companySummary.higher.count}
              availableCount={companySummary.higher.availableCount}
              availableTotal={companySummary.higher.availableTotal}
              notesCount={companySummary.higher.notesCount}
              notesTotal={companySummary.higher.notesTotal}
              outsideCount={companySummary.higher.outsideCount}
              outsideTotal={companySummary.higher.outsideTotal}
              accent="bg-indigo-100 text-indigo-700"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
            <StatCard
              icon={Wallet}
              label="Total RUC"
              value={money(totalIssued)}
              hint={`${fiscalIssuedBoletas.length} boleta(s): ${companySummary.limbo.count} Limbo + ${companySummary.higher.count} Higher`}
              accent="bg-emerald-100 text-emerald-700"
            />
            <StatCard
              icon={Receipt}
              label="Vigente sin nota"
              value={money(totalEligible)}
              hint={`${fiscalAcceptedBoletas.length} boleta(s) disponibles para anular`}
              accent="bg-blue-100 text-blue-700"
            />
            <StatCard
              icon={Wallet}
              label="Fuera del mes"
              value={money(outsideMonthTotal)}
              hint={`${outsideMonthBoletas.length} boleta(s) pertenecen a otro mes`}
              accent="bg-amber-100 text-amber-700"
            />
            <StatCard
              icon={FileMinus2}
              label="Notas del periodo"
              value={money(totalNotes)}
              hint={`${acceptedCreditNotes.length} emitidas: ${fiscalCreditNotes.length} descuentan este periodo`}
              accent="bg-red-100 text-red-700"
            />
          </div>

          <div className="w-fit max-w-full rounded-xl bg-muted p-1">
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'anuladas' as const, label: 'Notas emitidas', badge: acceptedCreditNotes.length },
                { id: 'anular' as const, label: 'Anular boletas', badge: fiscalAcceptedBoletas.length },
                { id: 'fuera_mes' as const, label: 'Fuera del mes', badge: outsideMonthBoletas.length },
                { id: 'resumen' as const, label: 'Resumen fiscal', badge: fiscalIssuedBoletas.length },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInfoTab(tab.id)}
                  className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition ${
                    infoTab === tab.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${infoTab === tab.id ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}`}>
                    {tab.badge}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {infoTab === 'anuladas' && (
            <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Notas emitidas en {formatMonthLabel(month)}</p>
                  <p className="mt-2 text-2xl font-semibold text-red-800">{acceptedCreditNotes.length} nota(s)</p>
                  <p className="mt-1 text-sm text-red-700/80">{money(emittedNotesTotal)} en {formatMonthLabel(month)}</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Afectan otras boletas</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-900">{noteScopeSummary.otherBoletas.count} nota(s)</p>
                  <p className="mt-1 text-sm text-amber-800">{money(noteScopeSummary.otherBoletas.total)} no descuenta las boletas anulables de este bloque.</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Afectan este bloque</p>
                  <p className="mt-2 text-2xl font-semibold">{noteScopeSummary.currentSet.count} nota(s)</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {noteScopeSummary.facturas.count} nota(s) afectan factura/sin boleta: {money(noteScopeSummary.facturas.total)}
                  </p>
                </div>
              </div>
              {noteGroups.length > 0 && (
                <div className="grid gap-2 md:grid-cols-3">
                  {noteGroups.map((group) => (
                    <div key={group.key} className="rounded-lg border border-border bg-background p-3">
                      <p className="text-sm font-semibold">{group.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{group.count} nota(s) · {money(group.total)}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="p-3 font-medium">Empresa</th>
                      <th className="p-3 font-medium">Nota</th>
                      <th className="p-3 font-medium">Fecha nota</th>
                      <th className="p-3 font-medium">Boleta afectada</th>
                      <th className="p-3 font-medium">Fecha boleta</th>
                      <th className="p-3 font-medium">Cliente</th>
                      <th className="p-3 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acceptedCreditNotes.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-muted-foreground">
                          No hay notas de crédito aceptadas en {formatMonthLabel(month)}.
                        </td>
                      </tr>
                    ) : acceptedCreditNotes.map((note) => (
                      <tr key={note.id} className="border-t border-border/70">
                        <td className="p-3">{note._companyName}</td>
                        <td className="p-3 font-mono text-xs">{note.numeroCompleto}</td>
                        <td className="p-3">{note.fechaEmision}</td>
                        <td className="p-3 font-mono text-xs">{note.numDocAfectado || note.affectedBoletaNumeroCompleto || '-'}</td>
                        <td className="p-3">{affectedDateOf(note) || '-'}</td>
                        <td className="p-3">
                          <div className="max-w-[260px] truncate">{note.clientRazonSocial || '-'}</div>
                          <div className="text-xs text-muted-foreground">{note.clientNumeroDocumento || '-'}</div>
                        </td>
                        <td className="p-3 text-right">{money(amountOf(note))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {infoTab === 'fuera_mes' && (
            <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
              <div>
                <h3 className="text-base font-semibold">Boletas de otro mes dentro del resumen de {formatMonthLabel(month)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Esto explica por qué SUNAT puede mostrar más boletas en el resumen del mes que las ventas internas del mismo mes.
                </p>
              </div>
              {outsideMonthGroups.length > 0 && (
                <div className="grid gap-2 md:grid-cols-3">
                  {outsideMonthGroups.map((group) => (
                    <div key={group.key} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-semibold text-amber-900">{group.company}</p>
                      <p className="mt-1 text-xs text-amber-800">{group.label} · {group.count} boleta(s) · {money(group.total)}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="p-3 font-medium">Empresa</th>
                      <th className="p-3 font-medium">Boleta</th>
                      <th className="p-3 font-medium">Fecha boleta</th>
                      <th className="p-3 font-medium">Resumen</th>
                      <th className="p-3 font-medium">Cliente</th>
                      <th className="p-3 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outsideMonthBoletas.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-muted-foreground">
                          No hay boletas fuera del mes.
                        </td>
                      </tr>
                    ) : outsideMonthBoletas.map((row) => (
                      <tr key={row.id} className="border-t border-border/70">
                        <td className="p-3">{row._companyName}</td>
                        <td className="p-3 font-mono text-xs">{row.numeroCompleto}</td>
                        <td className="p-3">
                          {row.datosAdicionales?.fecha_emision_original || row.fechaEmision || '-'}
                          {row.datosAdicionales?.fecha_emision_original && (
                            <div className="text-xs text-muted-foreground">declarada {row.fechaEmision}</div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="font-mono text-xs">{row.summaryNumeroCompleto || '-'}</div>
                          <div className="text-xs text-muted-foreground">{row.summaryFechaResumen || '-'}</div>
                        </td>
                        <td className="p-3">
                          <div className="max-w-[260px] truncate">{row.clientRazonSocial || '-'}</div>
                          <div className="text-xs text-muted-foreground">{row.clientNumeroDocumento || '-'}</div>
                        </td>
                        <td className="p-3 text-right">{money(amountOf(row))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {infoTab === 'resumen' && (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold">Resumen fiscal del RUC {SHARED_RUC}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ventas del periodo fiscal menos notas que afectan este mismo periodo.
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">IGV estimado</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-900">{money(taxNeto.igv)}</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="p-3 font-medium">Concepto</th>
                      <th className="p-3 text-right font-medium">Cantidad</th>
                      <th className="p-3 text-right font-medium">Total</th>
                      <th className="p-3 text-right font-medium">Base</th>
                      <th className="p-3 text-right font-medium">IGV</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border/70">
                      <td className="p-3">Boletas Limbo + Higher</td>
                      <td className="p-3 text-right">{fiscalIssuedBoletas.length}</td>
                      <td className="p-3 text-right">{money(taxVentas.total)}</td>
                      <td className="p-3 text-right">{money(taxVentas.base)}</td>
                      <td className="p-3 text-right">{money(taxVentas.igv)}</td>
                    </tr>
                    <tr className="border-t border-border/70 bg-red-50 text-red-900">
                      <td className="p-3">Menos notas de crédito del periodo</td>
                      <td className="p-3 text-right">{fiscalCreditNotes.length}</td>
                      <td className="p-3 text-right">-{money(taxNotas.total)}</td>
                      <td className="p-3 text-right">-{money(taxNotas.base)}</td>
                      <td className="p-3 text-right">-{money(taxNotas.igv)}</td>
                    </tr>
                    <tr className="border-t border-border bg-emerald-50 font-semibold text-emerald-900">
                      <td className="p-3">Neto</td>
                      <td className="p-3 text-right">{fiscalIssuedBoletas.length - fiscalCreditNotes.length}</td>
                      <td className="p-3 text-right">{money(taxNeto.total)}</td>
                      <td className="p-3 text-right">{money(taxNeto.base)}</td>
                      <td className="p-3 text-right">{money(taxNeto.igv)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {infoTab === 'anular' && (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { id: 'todos' as const, label: 'Limbo + Higher', value: eligibleSummary.todos, accent: 'border-slate-200 bg-slate-50' },
                  { id: 'limbo' as const, label: 'Limbo', value: eligibleSummary.limbo, accent: 'border-sky-200 bg-sky-50' },
                  { id: 'higher' as const, label: 'Higher', value: eligibleSummary.higher, accent: 'border-indigo-200 bg-indigo-50' },
                ].map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      setFilter(row.id);
                      clearSelection();
                    }}
                    className={`rounded-xl border p-4 text-left transition hover:shadow-sm ${row.accent} ${filter === row.id ? 'ring-2 ring-primary/30' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</p>
                      {filter === row.id && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">Activo</span>
                      )}
                    </div>
                    <p className="mt-2 text-2xl font-semibold">{row.value.count} boleta(s)</p>
                    <p className="mt-1 text-sm text-muted-foreground">{money(row.value.total)} disponible para anular</p>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold">Boletas disponibles para anular</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {eligible.length} boleta(s) en {filter === 'todos' ? 'Limbo + Higher' : kindLabel(filter)} · {money(eligible.reduce((sum, row) => sum + amountOf(row), 0))}
                    </p>
                  </div>
                  <div className="flex w-fit rounded-lg bg-muted p-1">
                    {[
                      { id: 'todos' as const, label: 'Todas' },
                      { id: 'limbo' as const, label: 'Limbo' },
                      { id: 'higher' as const, label: 'Higher' },
                    ].map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setFilter(option.id);
                          clearSelection();
                        }}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                          filter === option.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/50'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-4 inline-flex rounded-lg border border-border bg-background p-1">
                  <button
                    type="button"
                    onClick={() => setMode('cantidad')}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${mode === 'cantidad' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                  >
                    Por cantidad
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('monto')}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${mode === 'monto' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                  >
                    Por monto máximo
                  </button>
                </div>

                {mode === 'cantidad' ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">¿Cuántas boletas?</label>
                      <input
                        type="number"
                        min={1}
                        max={eligible.length || 1}
                        value={qty}
                        onChange={(event) => setQty(Number(event.target.value))}
                        className="h-10 w-32 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={pickByQty}
                      disabled={eligible.length === 0}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                    >
                      <Shuffle className="h-4 w-4" /> Escoger al azar
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Monto máximo (S/)</label>
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={maxAmount}
                        onChange={(event) => setMaxAmount(Number(event.target.value))}
                        className="h-10 w-40 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={pickByAmount}
                      disabled={eligible.length === 0}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                    >
                      <Target className="h-4 w-4" /> Armar hasta {money(maxAmount || 0)}
                    </button>
                  </div>
                )}
              </div>

              {results && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" /> {acceptedCount} aceptada(s)
                    </span>
                    {rejectedCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
                        <XCircle className="h-4 w-4" /> {rejectedCount} rechazada(s)
                      </span>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertTriangle className="h-4 w-4" /> {error}
                </div>
              )}

              <div className="rounded-xl border border-border bg-card shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Selección actual</h3>
                    <p className="text-xs text-muted-foreground">{selectedBoletas.length} boleta(s) · {money(selectedTotal)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedBoletas.length > 0 && (
                      <button
                        type="button"
                        onClick={clearSelection}
                        disabled={processing}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                      >
                        <X className="h-4 w-4" /> Limpiar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={runAnular}
                      disabled={selectedBoletas.length === 0 || processing}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                    >
                      {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileMinus2 className="h-4 w-4" />}
                      Anular ({selectedBoletas.length}) · {money(selectedTotal)}
                    </button>
                  </div>
                </div>
                {selectedBoletas.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Escoge boletas con el generador o agrégalas manualmente desde la lista.
                  </div>
                ) : (
                  <ul className="divide-y divide-border/70">
                    {selectedBoletas.map((row: any) => (
                      <li key={row.id} className="flex items-center gap-3 p-3 text-sm hover:bg-accent/30">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{kindLabel(row._companyKind)}</span>
                            <span className="font-mono text-xs">{row.numeroCompleto}</span>
                            <span className="text-xs text-muted-foreground">· {row.fechaEmision}</span>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {row.clientRazonSocial || '-'} · {row.clientNumeroDocumento || '-'}
                          </div>
                        </div>
                        <span className="font-medium">{money(amountOf(row))}</span>
                        <button
                          type="button"
                          onClick={() => removeOne(row.id)}
                          disabled={processing}
                          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowAll((value) => !value)}
                  className="flex w-full items-center justify-between gap-2 p-4 text-left text-sm font-medium"
                >
                  <span>Ver boletas anulables ({eligible.length})</span>
                  <ChevronDown className={`h-4 w-4 transition ${showAll ? 'rotate-180' : ''}`} />
                </button>
                {showAll && (
                  <div className="max-h-[420px] overflow-auto border-t border-border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                        <tr className="text-left">
                          <th className="p-3 font-medium text-muted-foreground">Empresa</th>
                          <th className="p-3 font-medium text-muted-foreground">Boleta</th>
                          <th className="p-3 font-medium text-muted-foreground">Fecha</th>
                          <th className="p-3 font-medium text-muted-foreground">Cliente</th>
                          <th className="p-3 text-right font-medium text-muted-foreground">Total</th>
                          <th className="p-3 font-medium text-muted-foreground">Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unselected.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-muted-foreground">
                              No quedan boletas para agregar con este filtro.
                            </td>
                          </tr>
                        ) : unselected.map((row) => (
                          <tr key={row.id} className="border-t border-border/70 hover:bg-accent/30">
                            <td className="p-3">{row._companyName}</td>
                            <td className="p-3 font-mono text-xs">{row.numeroCompleto}</td>
                            <td className="p-3">{row.fechaEmision}</td>
                            <td className="p-3">
                              <div className="max-w-[260px] truncate">{row.clientRazonSocial || '-'}</div>
                              <div className="text-xs text-muted-foreground">{row.clientNumeroDocumento || '-'}</div>
                            </td>
                            <td className="p-3 text-right">{money(amountOf(row))}</td>
                            <td className="p-3">
                              <button
                                type="button"
                                onClick={() => addOne(row.id)}
                                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-accent"
                              >
                                Agregar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {progressOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h3 className="text-base font-semibold">Anulación Limbo/Higher</h3>
                <p className="mt-1 text-sm text-muted-foreground">{progressMessage || 'Procesando notas de crédito...'}</p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">Ambiente SUNAT: {modoProduccion ? 'Producción' : 'Beta'}</p>
              </div>
              <button
                type="button"
                onClick={() => setProgressOpen(false)}
                disabled={processing}
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                  <tr className="text-left">
                    <th className="p-3 font-medium text-muted-foreground">Estado</th>
                    <th className="p-3 font-medium text-muted-foreground">Empresa</th>
                    <th className="p-3 font-medium text-muted-foreground">Boleta</th>
                    <th className="p-3 font-medium text-muted-foreground">Nota</th>
                    <th className="p-3 text-right font-medium text-muted-foreground">Total</th>
                    <th className="p-3 font-medium text-muted-foreground">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {progressRows.map((row) => (
                    <tr key={row.boletaId} className="border-t border-border/70">
                      <td className="p-3">
                        {row.status === 'processing' ? (
                          <span className="inline-flex items-center gap-1.5 text-amber-700">
                            <Loader2 className="h-4 w-4 animate-spin" /> Procesando
                          </span>
                        ) : row.status === 'success' ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" /> Aceptada
                          </span>
                        ) : row.status === 'error' ? (
                          <span className="inline-flex items-center gap-1.5 text-red-700">
                            <XCircle className="h-4 w-4" /> Error
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Pendiente</span>
                        )}
                      </td>
                      <td className="p-3">{row.empresa}</td>
                      <td className="p-3 font-mono text-xs">{row.numeroCompleto}</td>
                      <td className="p-3 font-mono text-xs">{row.creditNoteNumero || '-'}</td>
                      <td className="p-3 text-right">{money(row.total)}</td>
                      <td className="p-3 text-xs text-muted-foreground">{row.message || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
              <div className="text-sm text-muted-foreground">
                {progressRows.filter((row) => row.status === 'success').length} aceptada(s) ·{' '}
                {progressRows.filter((row) => row.status === 'error').length} fallida(s) ·{' '}
                {progressRows.filter((row) => row.status === 'pending' || row.status === 'processing').length} pendiente(s)
              </div>
              <button
                type="button"
                onClick={() => setProgressOpen(false)}
                disabled={processing}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processing ? 'Procesando...' : 'Cerrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
