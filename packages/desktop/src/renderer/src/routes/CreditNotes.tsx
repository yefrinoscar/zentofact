import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  AlertTriangle,
  Shuffle,
  FileMinus2,
  Loader2,
  CheckCircle2,
  XCircle,
  Wallet,
  Receipt,
  Target,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Calendar,
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import { Loading } from '../components/Loading';
import api from '../lib/api';
import SharedRucCreditNotes from './SharedRucCreditNotes';

type PickMode = 'cantidad' | 'monto';
type InfoTab = 'anuladas' | 'fuera_mes' | 'resumen';

interface SendOutcome {
  boletaId: number;
  success: boolean;
  numeroCompleto?: string;
  error?: { code: string; message: string };
}

interface CreditNoteProgressRow {
  boletaId: number;
  numeroCompleto: string;
  total: number;
  status: 'pending' | 'processing' | 'success' | 'error';
  message?: string;
  creditNoteNumero?: string;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

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

function formatMonthLabel(value: string) {
  const { year, monthIndex } = parseMonth(value);
  return `${monthNames[monthIndex]} ${year}`;
}

function formatShortMonthLabel(value: string) {
  const { year, monthIndex } = parseMonth(value);
  return `${monthNames[monthIndex]} ${year}`;
}

function monthValue(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function endOfMonth(value: string) {
  const { year, monthIndex } = parseMonth(value);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return `${value}-${String(lastDay).padStart(2, '0')}`;
}

function monthFromDate(value?: string | null) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

const money = (n: number) =>
  `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const amountOf = (b: any) => parseFloat(b?.mtoImpVenta || '0') || 0;

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

function affectedMonthOf(note: any) {
  return monthFromDate(affectedDateOf(note));
}

function fiscalMonthOfBoleta(boleta: any) {
  // El periodo tributario de una boleta es su fecha de emision (registro de ventas),
  // no la fecha del resumen diario: el resumen puede enviarse tarde en otro mes y eso
  // no cambia el mes al que pertenece la boleta. Asi, una boleta emitida en abril cuyo
  // resumen salio en mayo NO debe contarse en mayo.
  return monthFromDate(boleta?.fechaEmision) || monthFromDate(boleta?.summaryFechaResumen);
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

function shuffle<T>(arr: T[]): T[] {
  const pool = [...arr];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

const SEG_COLORS: Record<string, { bar: string; dot: string }> = {
  emerald: { bar: 'bg-emerald-500 text-white', dot: 'bg-emerald-500' },
  red: { bar: 'bg-red-400 text-white', dot: 'bg-red-400' },
  amber: { bar: 'bg-amber-400 text-amber-950', dot: 'bg-amber-400' },
  sky: { bar: 'bg-sky-400 text-white', dot: 'bg-sky-400' },
  slate: { bar: 'bg-slate-300 text-slate-700', dot: 'bg-slate-300' },
};

function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
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
        className="inline-flex h-11 min-w-[210px] items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 text-sm shadow-sm transition hover:bg-accent"
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
              aria-label="Año anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-semibold">{viewYear}</div>
            <button
              type="button"
              onClick={() => setViewYear((year) => year + 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-accent"
              aria-label="Año siguiente"
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

export default function CreditNotes() {
  const activeId = useAppStore((s) => s.activeCompanyId);
  const setActiveId = useAppStore((s) => s.setActiveCompanyId);

  const [companies, setCompanies] = useState<any[]>([]);
  const [month, setMonth] = useState<string>(currentMonth());
  const [boletas, setBoletas] = useState<any[]>([]);
  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedOrder, setSelectedOrder] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<SendOutcome[] | null>(null);
  const [modoProduccion, setModoProduccion] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressRows, setProgressRows] = useState<CreditNoteProgressRow[]>([]);
  const [progressMessage, setProgressMessage] = useState('');
  const [falabellaMonth, setFalabellaMonth] = useState<any | null>(null);
  const [falabellaLoading, setFalabellaLoading] = useState(false);
  const [falabellaError, setFalabellaError] = useState('');

  // Generador
  const [mode, setMode] = useState<PickMode>('cantidad');
  const [qty, setQty] = useState(5);
  const [maxAmount, setMaxAmount] = useState(2000);
  const [showAll, setShowAll] = useState(false);
  const [infoTab, setInfoTab] = useState<InfoTab>('anuladas');

  const acceptedBoletas = useMemo(
    () => boletas.filter((b) => b.estadoSunat === 'ACEPTADO' && !b.creditNoteId),
    [boletas],
  );
  const canceledBoletas = useMemo(
    () => boletas.filter((b) => b.estadoSunat === 'ANULADO' || b.creditNoteId),
    [boletas],
  );
  const acceptedCreditNotes = useMemo(
    () => creditNotes.filter((note) => note.estadoSunat === 'ACEPTADO'),
    [creditNotes],
  );
  const facturadasBoletas = useMemo(
    () => [...acceptedBoletas, ...canceledBoletas],
    [acceptedBoletas, canceledBoletas],
  );
  const fiscalFacturadasBoletas = useMemo(
    () => facturadasBoletas.filter((boleta) => fiscalMonthOfBoleta(boleta) === month),
    [facturadasBoletas, month],
  );
  const fiscalAcceptedBoletas = useMemo(
    () => acceptedBoletas.filter((boleta) => fiscalMonthOfBoleta(boleta) === month),
    [acceptedBoletas, month],
  );
  const fiscalBoletaIds = useMemo(
    () => new Set(fiscalFacturadasBoletas.map((boleta) => boleta.id)),
    [fiscalFacturadasBoletas],
  );
  const fiscalCreditNotes = useMemo(
    () => acceptedCreditNotes.filter((note) => {
      if (monthFromDate(note.fechaEmision) === month) return true;
      return Boolean(note.affectedBoletaId && fiscalBoletaIds.has(note.affectedBoletaId));
    }),
    [acceptedCreditNotes, fiscalBoletaIds, month],
  );

  // Solo boletas ACEPTADAS y sin nota de crédito previa pueden anularse.
  // Se omiten las boletas de S/ 0: no tiene sentido emitir una nota de crédito sobre ellas.
  const eligible = useMemo(
    () => fiscalAcceptedBoletas.filter((b) => amountOf(b) > 0),
    [fiscalAcceptedBoletas],
  );

  const montoBrutoMes = useMemo(() => fiscalFacturadasBoletas.reduce((s, b) => s + amountOf(b), 0), [fiscalFacturadasBoletas]);
  const montoAnulable = useMemo(() => eligible.reduce((s, b) => s + amountOf(b), 0), [eligible]);
  const montoAnulado = useMemo(() => fiscalCreditNotes.reduce((s, note) => s + amountOf(note), 0), [fiscalCreditNotes]);
  const montoNetoMes = montoBrutoMes - montoAnulado;
  const creditNotesAffectingOtherPeriods = useMemo(
    () => acceptedCreditNotes.filter((note) => note.affectedBoletaId && !fiscalBoletaIds.has(note.affectedBoletaId)),
    [acceptedCreditNotes, fiscalBoletaIds],
  );
  const creditNotesWithoutAffectedDate = useMemo(
    () => acceptedCreditNotes.filter((note) => !affectedMonthOf(note)),
    [acceptedCreditNotes],
  );
  const amountOfNotes = (notes: any[]) => notes.reduce((sum, note) => sum + amountOf(note), 0);
  const creditNoteAffectedMonthRows = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; count: number; total: number }>();

    for (const note of acceptedCreditNotes) {
      const affectedMonth = affectedMonthOf(note);
      const key = affectedMonth || 'sin_fecha';
      const current = groups.get(key) || {
        key,
        label: affectedMonth ? formatShortMonthLabel(affectedMonth) : 'Sin fecha de boleta',
        count: 0,
        total: 0,
      };
      current.count += 1;
      current.total += amountOf(note);
      groups.set(key, current);
    }

    return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [acceptedCreditNotes]);
  const originRows = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; count: number; total: number; kind: 'actual' | 'anterior' | 'posterior' | 'sin_fecha' }>();

    for (const boleta of fiscalFacturadasBoletas) {
      const originMonth = monthFromDate(boleta.fechaEmision);
      const key = originMonth || 'sin_fecha';
      const current = groups.get(key) || {
        key,
        label: originMonth ? formatShortMonthLabel(originMonth) : 'Sin fecha',
        count: 0,
        total: 0,
        kind: !originMonth ? 'sin_fecha' : originMonth < month ? 'anterior' : originMonth > month ? 'posterior' : 'actual',
      };
      current.count += 1;
      current.total += amountOf(boleta);
      groups.set(key, current);
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === 'sin_fecha') return 1;
      if (b.key === 'sin_fecha') return -1;
      return a.key.localeCompare(b.key);
    });
  }, [fiscalFacturadasBoletas, month]);
  const outsideMonthBoletas = useMemo(
    () => fiscalFacturadasBoletas
      .filter((boleta) => {
        const fiscalMonth = fiscalMonthOfBoleta(boleta);
        return fiscalMonth && fiscalMonth === month && monthFromDate(boleta.fechaEmision) !== month;
      })
      .sort((a, b) => {
        const dateCompare = String(a.fechaEmision || '').localeCompare(String(b.fechaEmision || ''));
        if (dateCompare !== 0) return dateCompare;
        return String(a.numeroCompleto || '').localeCompare(String(b.numeroCompleto || ''));
      }),
    [fiscalFacturadasBoletas, month],
  );
  const outsideMonthTotal = useMemo(
    () => outsideMonthBoletas.reduce((sum, boleta) => sum + amountOf(boleta), 0),
    [outsideMonthBoletas],
  );
  const taxVentas = useMemo(() => taxSummary(fiscalFacturadasBoletas), [fiscalFacturadasBoletas]);
  const taxNotas = useMemo(() => taxSummary(fiscalCreditNotes), [fiscalCreditNotes]);
  const taxNeto = useMemo(() => ({
    total: round2(taxVentas.total - taxNotas.total),
    base: round2(taxVentas.base - taxNotas.base),
    igv: round2(taxVentas.igv - taxNotas.igv),
  }), [taxVentas, taxNotas]);
  const outsideMonthRows = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; count: number; total: number }>();

    for (const boleta of outsideMonthBoletas) {
      const boletaMonth = monthFromDate(boleta.fechaEmision);
      const key = boletaMonth || 'sin_fecha';
      const current = groups.get(key) || {
        key,
        label: boletaMonth ? formatShortMonthLabel(boletaMonth) : 'Sin fecha',
        count: 0,
        total: 0,
      };
      current.count += 1;
      current.total += amountOf(boleta);
      groups.set(key, current);
    }

    return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [outsideMonthBoletas]);
  const statusTotal = fiscalFacturadasBoletas.length + fiscalCreditNotes.length;
  const acceptedPct = statusTotal ? Math.round((fiscalAcceptedBoletas.length / statusTotal) * 100) : 0;
  const canceledPct = statusTotal ? Math.round((fiscalCreditNotes.length / statusTotal) * 100) : 0;

  const selectedBoletas = useMemo(() => {
    const byId = new Map(eligible.map((b) => [b.id, b]));
    return selectedOrder
      .map((id) => byId.get(id))
      .filter(Boolean);
  }, [eligible, selectedOrder]);
  const selectedSum = useMemo(
    () => selectedBoletas.reduce((s, b) => s + amountOf(b), 0),
    [selectedBoletas],
  );

  useEffect(() => {
    api.listCompanies().then((cs: any[]) => setCompanies(Array.isArray(cs) ? cs : [])).catch(() => {});
  }, []);

  const loadBoletas = async (options: { preserveResults?: boolean } = {}) => {
    if (!activeId) return;
    try {
      setError('');
      setLoading(true);
      if (!options.preserveResults) setResults(null);
      setSelected(new Set());
      setSelectedOrder([]);
      const [boletasRes, creditNotesRes] = await Promise.all([
        api.listBoletas({
          companyId: activeId,
          fechaDesde: `${month}-01`,
          fechaHasta: endOfMonth(month),
          summaryFechaDesde: `${month}-01`,
          summaryFechaHasta: endOfMonth(month),
          matchFechaEmisionOrSummary: true,
          limit: 2000,
        }),
        api.listCreditNotes({
          companyId: activeId,
          fechaDesde: `${month}-01`,
          fechaHasta: endOfMonth(month),
          estado: 'ACEPTADO',
          limit: 2000,
        }),
      ]);
      setBoletas(boletasRes?.boletas || []);
      setCreditNotes(creditNotesRes?.creditNotes || []);
    } catch (e: any) {
      setError(e.message || 'Error al cargar boletas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeId) loadBoletas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, month]);

  const handleSelectCompany = async (id: number) => {
    setActiveId(id);
    await api.setActiveCompanyId(id);
  };

  const loadFalabellaMonth = async () => {
    if (!activeId) return;
    try {
      setFalabellaLoading(true);
      setFalabellaError('');
      setFalabellaMonth(null);
      const response = await api.falabellaApiMonthSummary(activeId, month);
      if (response?.error) {
        setFalabellaError(String(response.error));
        return;
      }
      setFalabellaMonth(response);
    } catch (e: any) {
      setFalabellaError(e?.message || 'No se pudo cargar Falabella.');
    } finally {
      setFalabellaLoading(false);
    }
  };

  useEffect(() => {
    if (activeId) loadFalabellaMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, month]);

  // Escoge N boletas al azar.
  const pickByQty = () => {
    const n = Math.max(1, Math.min(qty || 1, eligible.length));
    const ids = shuffle(eligible).slice(0, n).map((b) => b.id);
    setSelected(new Set(ids));
    setSelectedOrder(ids);
    setResults(null);
  };

  // Escoge boletas al azar acumulando hasta el monto máximo (sin pasarse).
  const pickByAmount = () => {
    const target = Math.max(0, maxAmount || 0);
    const chosen: number[] = [];
    let sum = 0;
    for (const b of shuffle(eligible)) {
      const amt = amountOf(b);
      if (sum + amt <= target) {
        chosen.push(b.id);
        sum += amt;
      }
    }
    setSelected(new Set(chosen));
    setSelectedOrder(chosen);
    setResults(null);
  };

  const removeOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedOrder((prev) => prev.filter((selectedId) => selectedId !== id));
  };

  const addOne = (id: number) => {
    setSelected((prev) => new Set(prev).add(id));
    setSelectedOrder((prev) => prev.includes(id) ? prev : [...prev, id]);
  };

  const clearSelection = () => {
    setSelected(new Set());
    setSelectedOrder([]);
  };

  const runAnular = async (ids: number[]) => {
    if (!ids.length || processing) return;
    const selectedForRun = ids
      .map((id) => eligible.find((b) => b.id === id))
      .filter(Boolean);
    const total = selectedForRun.reduce((s, b) => {
      return s + amountOf(b);
    }, 0);
    const confirmed = window.confirm(
      `Se emitirán y enviarán a SUNAT ${selectedForRun.length} nota(s) de crédito en ${modoProduccion ? 'PRODUCCIÓN' : 'BETA'} por un total de ${money(total)}, ` +
        `anulando esas boletas. Esta acción es irreversible. ¿Continuar?`,
    );
    if (!confirmed) return;

    const initialRows = selectedForRun.map((b: any) => ({
      boletaId: b.id,
      numeroCompleto: b.numeroCompleto,
      total: amountOf(b),
      status: 'pending' as const,
    }));
    const markRow = (boletaId: number, patch: Partial<CreditNoteProgressRow>) => {
      setProgressRows((prev) => prev.map((row) => (
        row.boletaId === boletaId ? { ...row, ...patch } : row
      )));
    };

    try {
      setProcessing(true);
      setError('');
      setResults(null);
      setProgressRows(initialRows);
      setProgressMessage(`Preparando ${initialRows.length} nota(s) de crédito en ${modoProduccion ? 'Producción' : 'Beta'}...`);
      setProgressOpen(true);
      const options = { modoProduccion };
      const outcomes: SendOutcome[] = [];

      for (let index = 0; index < selectedForRun.length; index++) {
        const b: any = selectedForRun[index];
        setProgressMessage(`Anulando ${b.numeroCompleto} (${index + 1}/${selectedForRun.length})...`);
        markRow(b.id, { status: 'processing', message: 'Creando y enviando nota de crédito...' });
        try {
          const outcome = await api.createAndSendCreditNote(b.id, options);
          outcomes.push(outcome);
          if (outcome?.success) {
            markRow(b.id, {
              status: 'success',
              message: 'Nota aceptada por SUNAT.',
              creditNoteNumero: outcome.numeroCompleto,
            });
          } else {
            markRow(b.id, {
              status: 'error',
              message: outcome?.error?.message || 'SUNAT rechazó la nota de crédito.',
              creditNoteNumero: outcome?.numeroCompleto,
            });
          }
        } catch (e: any) {
          const outcome = {
            boletaId: b.id,
            success: false,
            error: { code: 'CREATE_ERROR', message: e?.message || 'Error al crear nota de crédito' },
          };
          outcomes.push(outcome);
          markRow(b.id, { status: 'error', message: outcome.error.message });
        }
      }

      setResults(outcomes);
      setProgressMessage(`Proceso terminado: ${outcomes.filter((row) => row.success).length} aceptada(s), ${outcomes.filter((row) => !row.success).length} fallida(s).`);
      await loadBoletas({ preserveResults: true });
    } catch (e: any) {
      setError(e.message || 'Error al anular boletas');
      setProgressMessage(e.message || 'Error al anular boletas');
    } finally {
      setProcessing(false);
    }
  };

  const acceptedCount = results?.filter((r) => r.success).length ?? 0;
  const rejectedCount = results ? results.length - acceptedCount : 0;
  const unselected = eligible.filter((b) => !selected.has(b.id));
  const activeCompany = companies.find((company) => company.id === activeId);
  const activeCompanyText = companyText(activeCompany);
  const isSharedRucCreditNotes =
    activeCompany?.ruc === '20607809136' &&
    (activeCompanyText.includes('LIMBO') || activeCompanyText.includes('HIGHER'));
  const falabellaRows = falabellaMonth?.falabella?.rows || [];
  const falabellaMissingRows = falabellaRows.filter((row: any) => !row.hasAcceptedBoleta);
  const falabellaMustIssueRows = falabellaMissingRows.filter((row: any) => !row.hasBoleta && row.shouldHaveBoleta);
  const falabellaPendingRows = falabellaMissingRows.filter((row: any) => !row.hasBoleta && !row.shouldHaveBoleta);
  const falabellaStats = falabellaMonth?.falabella || {};
  const hasFalabellaRows = falabellaRows.length > 0;
  const falabellaAccepted = falabellaStats.emitidas ?? falabellaRows.filter((row: any) => row.hasAcceptedBoleta).length;
  const falabellaRegisteredPending = falabellaStats.registradasPendientes ?? falabellaRows.filter((row: any) => row.hasBoleta && !row.hasAcceptedBoleta).length;
  const falabellaRegisteredPendingTotal = falabellaStats.registradasPendientesTotal ?? falabellaRows
    .filter((row: any) => row.hasBoleta && !row.hasAcceptedBoleta)
    .reduce((sum: number, row: any) => sum + (Number(row.price) || 0), 0);
  const falabellaPorEmitir = falabellaStats.porEmitir ?? (hasFalabellaRows ? falabellaMustIssueRows.length : falabellaStats.pendientes) ?? 0;
  const falabellaPorEmitirTotal = falabellaStats.porEmitirTotal ?? (hasFalabellaRows
    ? falabellaMustIssueRows.reduce((sum: number, row: any) => sum + (Number(row.price) || 0), 0)
    : falabellaStats.pendientesTotal) ?? 0;
  const falabellaPendientes = falabellaStats.pendientesFalabella ?? (hasFalabellaRows ? falabellaPendingRows.length : 0);
  const falabellaPendientesTotal = falabellaStats.pendientesFalabellaTotal ?? (hasFalabellaRows
    ? falabellaPendingRows.reduce((sum: number, row: any) => sum + (Number(row.price) || 0), 0)
    : 0);
  const falabellaMissingCount = falabellaStats.pendientes ?? falabellaMissingRows.length;
  const falabellaSistema = falabellaMonth?.sistema || {};
  const sunatBoletasDelPeriodo = fiscalFacturadasBoletas.length;
  const falabellaAceptadasDelMes = Number(falabellaAccepted || 0);
  const sunatBoletasNoCruzadasFalabellaMes = Math.max(0, sunatBoletasDelPeriodo - falabellaAceptadasDelMes);
  const sunatBoletasOtroPeriodo = Number(falabellaSistema.boletasMesAnterior ?? 0);
  const sunatBoletasOtroPeriodoTotal = Number(falabellaSistema.boletasMesAnteriorTotal ?? 0);
  const sunatBoletasSinOrdenFalabella = Number(falabellaSistema.boletasSinOrden ?? 0);
  const sunatBoletasSinOrdenFalabellaTotal = Number(falabellaSistema.boletasSinOrdenTotal ?? 0);
  const sunatBoletasDelMesFal = Number(falabellaSistema.boletasDelMes ?? 0);
  const sunatBoletasDelMesFalTotal = Number(falabellaSistema.boletasDelMesTotal ?? 0);
  // Boletas que realmente se emitieron y reportaron a SUNAT este mes (incluye las de otro mes).
  const sunatBoletasReportadasMes = sunatBoletasDelMesFal + sunatBoletasOtroPeriodo + sunatBoletasSinOrdenFalabella;
  const sunatBoletasReportadasMesTotal = round2(sunatBoletasDelMesFalTotal + sunatBoletasOtroPeriodoTotal + sunatBoletasSinOrdenFalabellaTotal);
  // Total emitido = boletas de este mes + boletas de otro mes (orden Falabella anterior, boleta emitida este mes).
  const boletasEsteMesCount = Math.max(0, fiscalFacturadasBoletas.length - sunatBoletasOtroPeriodo);
  const boletasEsteMesTotal = Math.max(0, round2(montoBrutoMes - sunatBoletasOtroPeriodoTotal));
  const sunatBoletasConContextoFalabella = sunatBoletasOtroPeriodo + sunatBoletasSinOrdenFalabella;
  const sunatBoletasContextoPendiente = Math.max(
    0,
    sunatBoletasNoCruzadasFalabellaMes - sunatBoletasConContextoFalabella,
  );

  if (isSharedRucCreditNotes) {
    return (
      <SharedRucCreditNotes
        companies={companies}
        activeCompanyId={activeId}
        month={month}
        onMonthChange={setMonth}
        onSelectCompany={handleSelectCompany}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Empresa + mes */}
      <div className="flex flex-wrap items-center gap-3">
        {companies.length > 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <select
              value={activeId ? String(activeId) : ''}
              onChange={(e) => e.target.value && handleSelectCompany(Number(e.target.value))}
              className="min-w-[300px] bg-transparent outline-none"
            >
              <option value="">Selecciona una empresa</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre || c.razonSocial} ({c.ruc})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
            No hay empresas registradas
          </div>
        )}

        <MonthPicker value={month} onChange={setMonth} />

        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm">
          <span className="text-xs font-medium text-muted-foreground">SUNAT:</span>
          <button
            type="button"
            role="switch"
            aria-checked={modoProduccion}
            onClick={() => setModoProduccion((value) => !value)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
              modoProduccion ? 'bg-emerald-600' : 'bg-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
                modoProduccion ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          {modoProduccion ? (
            <span className="text-sm font-medium text-emerald-600">Producción</span>
          ) : (
            <span className="text-sm font-medium text-amber-600">Beta</span>
          )}
        </div>
      </div>

      {!activeId ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          Selecciona una empresa para empezar.
        </div>
      ) : loading ? (
        <Loading label="Cargando boletas del mes..." />
      ) : (
        <>
          {/* Resumen */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Wallet, label: 'Total emitido', value: money(montoBrutoMes), hint: `${fiscalFacturadasBoletas.length} boletas`, chip: 'bg-emerald-100 text-emerald-600' },
              { icon: Receipt, label: 'De este mes', value: money(boletasEsteMesTotal), hint: `${boletasEsteMesCount} boletas`, chip: 'bg-sky-100 text-sky-600' },
              { icon: Calendar, label: 'De otro mes', value: money(sunatBoletasOtroPeriodoTotal), hint: `${sunatBoletasOtroPeriodo} boletas`, chip: 'bg-amber-100 text-amber-600' },
              { icon: FileMinus2, label: 'Anulado con nota', value: money(montoAnulado), hint: `${fiscalCreditNotes.length} notas de crédito`, chip: 'bg-rose-100 text-rose-600' },
            ].map(({ icon: Icon, label, value, hint, chip }) => (
              <div key={label} className="rounded-xl bg-muted/50 p-5">
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${chip}`}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                </div>
                <p className="mt-3.5 break-words text-[26px] font-bold leading-none tracking-tight text-foreground">{value}</p>
                <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Falabella del mes</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Órdenes creadas en {formatMonthLabel(month)} cruzadas contra boletas por número de orden.
                </p>
              </div>
              <button
                type="button"
                onClick={loadFalabellaMonth}
                disabled={falabellaLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-60"
              >
                {falabellaLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Actualizar
              </button>
            </div>

            {falabellaLoading ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
                Consultando Falabella API...
              </div>
            ) : falabellaError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {falabellaError}
              </div>
            ) : falabellaMonth ? (
              <>
                {(() => {
                  const totalOrdenes = Number(falabellaMonth.falabella.ventasBoletaMes) || 0;
                  const totalMonto = Number(falabellaMonth.falabella.ventasBoletaTotal) || 0;
                  // "Con boleta" usa el mismo monto que el card "De este mes" (boletas reales del sistema),
                  // para que ambos cuadren exacto y no haya diferencia de centavos.
                  const conBoletaCount = boletasEsteMesCount;
                  const conBoletaTotal = boletasEsteMesTotal;
                  const faltaCount = Math.max(0, totalOrdenes - conBoletaCount);
                  const faltaTotal = Math.max(0, round2(totalMonto - conBoletaTotal));
                  const pendCount = falabellaPendientes + falabellaRegisteredPending;
                  const pendTotal = round2(falabellaPendientesTotal + falabellaRegisteredPendingTotal);
                  const mes = formatMonthLabel(month);
                  const totalSunat = conBoletaCount + sunatBoletasOtroPeriodo;
                  const totalSunatMonto = round2(conBoletaTotal + sunatBoletasOtroPeriodoTotal);
                  const barras = [
                    { v: conBoletaCount, c: 'emerald' as const },
                    { v: falabellaPorEmitir, c: 'red' as const },
                    { v: pendCount, c: 'amber' as const },
                  ].filter((s) => s.v > 0);
                  return (
                    <div>
                      {/* Header */}
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Órdenes tipo boleta</p>
                        <p className="text-sm text-muted-foreground">
                          <span className="text-base font-semibold text-foreground">{totalOrdenes}</span> órdenes · {money(totalMonto)}
                        </p>
                      </div>

                      {/* Barra: con boleta vs falta emitir */}
                      <div className="flex h-2.5 w-full gap-1">
                        {barras.length === 0 ? (
                          <div className="h-full w-full rounded-full bg-muted" />
                        ) : barras.map((s, i) => (
                          <div key={i} className={`h-full rounded-full ${SEG_COLORS[s.c].dot}`} style={{ width: `${(s.v / Math.max(1, totalOrdenes)) * 100}%` }} />
                        ))}
                      </div>

                      {/* Dos grupos */}
                      <div className="mt-4 space-y-2">
                        <div className="flex items-center gap-3 rounded-lg bg-emerald-50/70 px-3 py-3 ring-1 ring-emerald-100">
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-emerald-900">Con boleta emitida</p>
                            <p className="text-xs text-emerald-700">aceptada por SUNAT</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold tabular-nums text-emerald-900">{conBoletaCount} <span className="font-normal text-emerald-700">de {totalOrdenes}</span></p>
                            <p className="text-xs tabular-nums text-emerald-700">{money(conBoletaTotal)}</p>
                          </div>
                        </div>

                        <div className="rounded-lg bg-muted/40 px-3 py-3">
                          <div className="flex items-center gap-3">
                            <AlertTriangle className="h-5 w-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold">Falta emitir</p>
                              <p className="text-xs text-muted-foreground">órdenes sin boleta todavía</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-semibold tabular-nums">{faltaCount} <span className="font-normal text-muted-foreground">de {totalOrdenes}</span></p>
                              <p className="text-xs tabular-nums text-muted-foreground">{money(faltaTotal)}</p>
                            </div>
                          </div>
                          {faltaCount > 0 && (
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-8 text-xs text-muted-foreground">
                              {falabellaPorEmitir > 0 && (
                                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red-400" />{falabellaPorEmitir} listas para emitir · {money(falabellaPorEmitirTotal)}</span>
                              )}
                              {pendCount > 0 && (
                                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-400" />{pendCount} pendientes en Falabella · {money(pendTotal)}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                No se cargó información de Falabella para este mes.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">Impuesto SUNAT estimado</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ventas del periodo fiscal menos notas que afectan este mismo periodo.
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-right">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">IGV por pagar</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-900">{money(taxNeto.igv)}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-muted-foreground">
                    <th className="p-3 font-medium">Concepto</th>
                    <th className="p-3 text-right font-medium">Cantidad</th>
                    <th className="p-3 text-right font-medium">Total con IGV</th>
                    <th className="p-3 text-right font-medium">Base imponible</th>
                    <th className="p-3 text-right font-medium">IGV</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border/70">
                    <td className="p-3">
                      <p className="font-medium">Ventas del mes</p>
                      <p className="text-xs text-muted-foreground">Boletas incluidas por fecha de emisión o resumen del mes.</p>
                    </td>
                    <td className="p-3 text-right">{fiscalFacturadasBoletas.length}</td>
                    <td className="p-3 text-right">{money(taxVentas.total)}</td>
                    <td className="p-3 text-right">{money(taxVentas.base)}</td>
                    <td className="p-3 text-right">{money(taxVentas.igv)}</td>
                  </tr>
                  <tr className="border-t border-border/70 bg-red-50/60 text-red-900">
                    <td className="p-3">
                      <p className="font-medium">Menos notas de crédito</p>
                      <p className="text-xs text-red-800/80">Descuentan si fueron emitidas en este periodo o afectan boletas del periodo.</p>
                    </td>
                    <td className="p-3 text-right">{fiscalCreditNotes.length}</td>
                    <td className="p-3 text-right">-{money(taxNotas.total)}</td>
                    <td className="p-3 text-right">-{money(taxNotas.base)}</td>
                    <td className="p-3 text-right">-{money(taxNotas.igv)}</td>
                  </tr>
                  <tr className="border-t border-border bg-emerald-50 font-semibold text-emerald-900">
                    <td className="p-3">Neto a declarar</td>
                    <td className="p-3 text-right">{fiscalFacturadasBoletas.length - fiscalCreditNotes.length}</td>
                    <td className="p-3 text-right">{money(taxNeto.total)}</td>
                    <td className="p-3 text-right">{money(taxNeto.base)}</td>
                    <td className="p-3 text-right">{money(taxNeto.igv)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Si el comprobante trae IGV declarado se usa ese valor; si falta, se estima con total * 18 / 118.
            </p>
          </div>

          <div className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
            {[
              { id: 'anuladas' as const, label: 'Anuladas', badge: acceptedCreditNotes.length },
              { id: 'fuera_mes' as const, label: 'Fuera del mes', badge: outsideMonthBoletas.length },
              { id: 'resumen' as const, label: 'Resumen', badge: statusTotal },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInfoTab(tab.id)}
                className={`inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition ${
                  infoTab === tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'hover:bg-background/50 hover:text-foreground'
                }`}
              >
                {tab.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  infoTab === tab.id ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'
                }`}
                >
                  {tab.badge}
                </span>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            {infoTab === 'resumen' && (
              <>
            <div className="mb-4 grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded-lg border border-border bg-muted/25 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bruto emitido</p>
                <p className="mt-1 font-semibold">{fiscalFacturadasBoletas.length} boleta(s) · {money(montoBrutoMes)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Incluye boletas que luego tuvieron nota de crédito.</p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-red-700">Menos notas</p>
                <p className="mt-1 font-semibold text-red-700">{fiscalCreditNotes.length} nota(s) · {money(montoAnulado)}</p>
                <p className="mt-1 text-xs text-red-700/80">Descuentan este periodo fiscal.</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Neto vigente</p>
                <p className="mt-1 font-semibold text-emerald-700">{fiscalAcceptedBoletas.length} boleta(s) · {money(montoNetoMes)}</p>
                <p className="mt-1 text-xs text-emerald-700/80">Esto coincide con lo disponible para anular.</p>
              </div>
            </div>
            {originRows.length > 0 && (
              <div className="mb-4 overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border bg-muted/30 px-3 py-2">
                  <p className="text-sm font-medium">Fecha de boleta vs. mes consultado ({formatMonthLabel(month)})</p>
                  <p className="text-xs text-muted-foreground">
                    Se toma de los registros internos: fecha de emisión de la boleta y fecha del resumen SUNAT asociado.
                  </p>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-background">
                    <tr className="text-left text-muted-foreground">
                      <th className="p-2 font-medium">Fecha de boleta</th>
                      <th className="p-2 font-medium">Estado</th>
                      <th className="p-2 text-right font-medium">Boletas</th>
                      <th className="p-2 text-right font-medium">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {originRows.map((row) => (
                      <tr key={row.key} className="border-t border-border/70">
                        <td className="p-2 font-medium">{row.label}</td>
                        <td className="p-2">
                          <span
                            className={`rounded-full px-2 py-1 ${
                              row.kind === 'anterior'
                                ? 'bg-amber-100 text-amber-700'
                                : row.kind === 'actual'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : row.kind === 'posterior'
                                    ? 'bg-sky-100 text-sky-700'
                                    : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {row.kind === 'anterior'
                              ? 'Boleta anterior'
                              : row.kind === 'actual'
                                ? 'Boleta del mes'
                                : row.kind === 'posterior'
                                  ? 'Boleta posterior'
                                  : 'Sin fecha'}
                          </span>
                        </td>
                        <td className="p-2 text-right">{row.count}</td>
                        <td className="p-2 text-right">{money(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="h-4 overflow-hidden rounded-full bg-muted">
              <div className="flex h-full">
                <div
                  className="bg-emerald-500"
                  style={{ width: `${acceptedPct}%` }}
                  title={`${fiscalAcceptedBoletas.length} aceptada(s)`}
                />
                <div
                  className="bg-red-500"
                  style={{ width: `${canceledPct}%` }}
                  title={`${fiscalCreditNotes.length} nota(s) de crédito`}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Vigentes: {fiscalAcceptedBoletas.length} · {money(montoNetoMes)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Con nota: {fiscalCreditNotes.length} · {money(montoAnulado)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                Bruto: {fiscalFacturadasBoletas.length} · {money(montoBrutoMes)}
              </span>
            </div>
              </>
            )}
            {infoTab === 'fuera_mes' && (
              outsideMonthBoletas.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50/70">
                  <div className="border-b border-amber-200 px-3 py-2">
                    <p className="text-sm font-semibold text-amber-800">
                      {outsideMonthBoletas.length} boleta(s) de más en {formatMonthLabel(month)}
                    </p>
                    <p className="text-xs text-amber-800/80">
                      Fueron enviadas en resumen de {formatMonthLabel(month)}, pero la fecha real de la boleta pertenece a otro mes.
                    </p>
                  </div>
                  <div className="border-b border-amber-200 bg-amber-50 px-3 py-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
                      Mes al que pertenecen
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {outsideMonthRows.map((row) => (
                        <div key={row.key} className="rounded-lg border border-amber-200 bg-card px-3 py-2">
                          <p className="text-sm font-semibold text-foreground">{row.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.count} boleta(s) · {money(row.total)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-72 overflow-auto bg-card">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-amber-50">
                        <tr className="text-left text-amber-900">
                          <th className="p-2 font-medium">Boleta</th>
                          <th className="p-2 font-medium">Fecha boleta</th>
                          <th className="p-2 font-medium">Resumen SUNAT</th>
                          <th className="p-2 font-medium">Fecha resumen</th>
                          <th className="p-2 font-medium">Cliente</th>
                          <th className="p-2 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outsideMonthBoletas.map((b: any) => (
                          <tr key={b.id} className="border-t border-border/70">
                            <td className="p-2 font-mono">{b.numeroCompleto}</td>
                            <td className="p-2">{b.fechaEmision || '-'}</td>
                            <td className="p-2 font-mono">{b.summaryNumeroCompleto || '-'}</td>
                            <td className="p-2">{b.summaryFechaResumen || '-'}</td>
                            <td className="p-2">
                              <div className="max-w-[220px] truncate">{b.clientRazonSocial || '-'}</div>
                              <div className="text-muted-foreground">{b.clientNumeroDocumento || '-'}</div>
                            </td>
                            <td className="p-2 text-right">{money(amountOf(b))}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-amber-200 bg-amber-50 font-semibold text-amber-900">
                        <tr>
                          <td className="p-2" colSpan={5}>Total fuera del mes</td>
                          <td className="p-2 text-right">{money(outsideMonthTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                  No hay boletas fuera del mes en {formatMonthLabel(month)}.
                </div>
              )
            )}
            {infoTab === 'anuladas' && (
              acceptedCreditNotes.length > 0 ? (
              <div className="space-y-4">
                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-red-700">Emitidas este mes</p>
                    <p className="mt-1 text-lg font-semibold text-red-700">{acceptedCreditNotes.length} nota(s)</p>
                    <p className="mt-1 text-xs text-red-700/80">{money(amountOfNotes(acceptedCreditNotes))} emitidas en {formatMonthLabel(month)}</p>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-red-700">Descuentan este periodo</p>
                    <p className="mt-1 text-lg font-semibold text-red-700">{fiscalCreditNotes.length} nota(s)</p>
                    <p className="mt-1 text-xs text-red-700/80">{money(amountOfNotes(fiscalCreditNotes))}</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Afectan otros periodos</p>
                    <p className="mt-1 text-lg font-semibold text-amber-700">{creditNotesAffectingOtherPeriods.length} nota(s)</p>
                    <p className="mt-1 text-xs text-amber-700/80">
                      {money(amountOfNotes(creditNotesAffectingOtherPeriods))}
                      {creditNotesWithoutAffectedDate.length > 0 ? ` · ${creditNotesWithoutAffectedDate.length} sin fecha` : ''}
                    </p>
                  </div>
                </div>
                {creditNoteAffectedMonthRows.length > 0 && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Mes real de las boletas afectadas
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {creditNoteAffectedMonthRows.map((row) => (
                        <div key={row.key} className="rounded-lg border border-border bg-card px-3 py-2">
                          <p className="text-sm font-semibold text-foreground">{row.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.count} nota(s) · {money(row.total)}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      La nota descuenta {formatMonthLabel(month)} solo si la boleta afectada pertenece a este periodo fiscal.
                    </p>
                  </div>
                )}
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="border-b border-border bg-muted/30 px-3 py-2 text-sm font-medium">
                    Notas de crédito aceptadas en {formatMonthLabel(month)}
                  </div>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background">
                        <tr className="text-left text-muted-foreground">
                          <th className="p-2 font-medium">Nota</th>
                          <th className="p-2 font-medium">Fecha nota</th>
                          <th className="p-2 font-medium">Boleta afectada</th>
                          <th className="p-2 font-medium">Fecha boleta</th>
                          <th className="p-2 font-medium">Cliente</th>
                          <th className="p-2 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acceptedCreditNotes.map((note: any) => (
                          <tr key={note.id} className="border-t border-border/70">
                            <td className="p-2 font-mono">{note.numeroCompleto}</td>
                            <td className="p-2">{note.fechaEmision}</td>
                            <td className="p-2 font-mono">
                              {note.numDocAfectado || note.affectedBoletaNumeroCompleto || '-'}
                              {note.tipoDocAfectado === '01' && (
                                <span className="ml-1.5 rounded bg-muted px-1 py-0.5 align-middle font-sans text-[10px] font-medium text-muted-foreground">
                                  Factura
                                </span>
                              )}
                            </td>
                            <td className="p-2">{affectedDateOf(note) || '-'}</td>
                            <td className="p-2">
                              <div className="max-w-[220px] truncate">{note.clientRazonSocial || '-'}</div>
                              <div className="text-muted-foreground">{note.clientNumeroDocumento || '-'}</div>
                            </td>
                            <td className="p-2 text-right">{money(amountOf(note))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              ) : (
                <div className="rounded-lg border border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                  No hay boletas anuladas en {formatMonthLabel(month)}.
                </div>
              )
            )}
          </div>

          {/* Generador */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Shuffle className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Generar selección al azar</h3>
            </div>

            <div className="mb-4 inline-flex rounded-lg border border-border bg-background p-1">
              <button
                type="button"
                onClick={() => setMode('cantidad')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  mode === 'cantidad' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                Por cantidad
              </button>
              <button
                type="button"
                onClick={() => setMode('monto')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  mode === 'monto' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                }`}
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
                    onChange={(e) => setQty(Number(e.target.value))}
                    className="h-10 w-32 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                </div>
                <button
                  type="button"
                  onClick={pickByQty}
                  disabled={eligible.length === 0}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                >
                  <Shuffle className="h-4 w-4" /> Escoger {Math.max(1, Math.min(qty || 1, eligible.length || 1))} al azar
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
                    onChange={(e) => setMaxAmount(Number(e.target.value))}
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
                <p className="text-xs text-muted-foreground">
                  Elige boletas al azar sumando lo más cerca posible del tope, sin pasarse.
                </p>
              </div>
            )}
          </div>

          {/* Resultado del envío */}
          {results && (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> {acceptedCount} aceptada(s)
                </span>
                {rejectedCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
                    <XCircle className="h-4 w-4" /> {rejectedCount} rechazada(s)
                  </span>
                )}
              </div>
              {rejectedCount > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {results
                    .filter((r) => !r.success)
                    .map((r) => (
                      <li key={r.boletaId}>
                        <span className="font-mono">Boleta #{r.boletaId}</span>: {r.error?.message || 'Error desconocido'}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}

          {/* Selección actual */}
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div>
                <h3 className="text-sm font-semibold">Boletas seleccionadas</h3>
                <p className="text-xs text-muted-foreground">
                  {selectedBoletas.length} boleta(s) · {money(selectedSum)}
                </p>
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
                  onClick={() => runAnular(selectedOrder)}
                  disabled={selectedBoletas.length === 0 || processing}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileMinus2 className="h-4 w-4" />}
                  Anular ({selectedBoletas.length}) · {money(selectedSum)}
                </button>
              </div>
            </div>

            {selectedBoletas.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Usa el generador de arriba para escoger boletas al azar, o agrégalas manualmente desde la lista.
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {selectedBoletas.map((b: any) => (
                  <li key={b.id} className="flex items-center gap-3 p-3 text-sm hover:bg-accent/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{b.numeroCompleto}</span>
                        <span className="text-xs text-muted-foreground">· {b.fechaEmision}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {b.clientRazonSocial || '-'} · {b.clientNumeroDocumento || '-'}
                      </div>
                    </div>
                    <span className="font-medium">{money(amountOf(b))}</span>
                    <button
                      type="button"
                      onClick={() => removeOne(b.id)}
                      disabled={processing}
                      className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                      aria-label="Quitar de la selección"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Lista completa colapsable (para agregar manualmente) */}
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="flex w-full items-center gap-2 p-4 text-left text-sm font-medium"
            >
              {showAll ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Ver todas las boletas anulables ({eligible.length})
            </button>

            {showAll && (
              eligible.length === 0 ? (
                <div className="border-t border-border p-8 text-center text-sm text-muted-foreground">
                  No hay boletas aceptadas sin nota de crédito en {month}.
                </div>
              ) : (
                <div className="max-h-[420px] overflow-auto border-t border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                      <tr className="text-left">
                        <th className="p-3 font-medium text-muted-foreground">Boleta</th>
                        <th className="p-3 font-medium text-muted-foreground">Fecha</th>
                        <th className="p-3 font-medium text-muted-foreground">Cliente</th>
                        <th className="p-3 font-medium text-muted-foreground">Total</th>
                        <th className="p-3 font-medium text-muted-foreground">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unselected.map((b: any) => (
                        <tr key={b.id} className="border-t border-border/70 hover:bg-accent/30">
                          <td className="p-3 font-mono text-xs">{b.numeroCompleto}</td>
                          <td className="p-3">{b.fechaEmision}</td>
                          <td className="p-3">
                            <div className="truncate">{b.clientRazonSocial || '-'}</div>
                            <div className="text-xs text-muted-foreground">{b.clientNumeroDocumento || '-'}</div>
                          </td>
                          <td className="p-3">{money(amountOf(b))}</td>
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => addOne(b.id)}
                              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-accent"
                            >
                              Agregar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {unselected.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                            Todas las boletas anulables ya están en tu selección.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </>
      )}

      {progressOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <h3 className="text-base font-semibold">Anulación de boletas</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {progressMessage || 'Preparando notas de crédito...'}
                </p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  Ambiente SUNAT: {modoProduccion ? 'Producción' : 'Beta'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProgressOpen(false)}
                disabled={processing}
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Cerrar progreso"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                  <tr className="text-left">
                    <th className="p-3 font-medium text-muted-foreground">Estado</th>
                    <th className="p-3 font-medium text-muted-foreground">Boleta</th>
                    <th className="p-3 font-medium text-muted-foreground">Nota</th>
                    <th className="p-3 font-medium text-muted-foreground">Total</th>
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
                      <td className="p-3 font-mono text-xs">{row.numeroCompleto}</td>
                      <td className="p-3 font-mono text-xs">{row.creditNoteNumero || '-'}</td>
                      <td className="p-3">{money(row.total)}</td>
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
