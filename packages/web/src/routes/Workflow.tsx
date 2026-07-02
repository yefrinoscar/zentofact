import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  Play,
  CheckCircle,
  XCircle,
  FileText,
  Send,
  FileDown,
  FileUp,
  Building2,
  ArrowRight,
  Globe,
  LogIn,
  Search,
  Eye,
  Download,
  AlertTriangle,
  Loader2,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Package,
} from 'lucide-react';
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useAppStore } from '../stores/app';
import api from '../lib/api';
import '@xyflow/react/dist/style.css';

type Phase = 'preflight' | 'scraping' | 'convertir' | 'emitir' | 'resultados';
type ScraperSubStep = 'abrir' | 'login' | 'filtrar' | 'leer' | 'exportar';
type EmitStepKey = 'create' | 'build' | 'send' | 'ticket';
type EmitStep = { key: EmitStepKey; label: string; status: PhaseStatus; elapsedMs?: number };
type BoletaResult = {
  numeroCompleto: string;
  estadoSunat: string;
  error?: string;
  orderNumber?: string;
  summaryId?: number;
  summaryNumero?: string;
  summaryTicket?: string;
  summaryEstado?: string;
  summaryResponseCode?: string;
  summaryResponse?: string;
};

interface ScraperState {
  step: string;
  failedStep?: string;
  failedStepLabel?: string;
  browserReady: boolean;
  authenticated: boolean;
  pendingOrderCount: number;
  totalReviewed: number;
  extractedCount: number;
  exportedCount: number;
  convertedCount: number;
  errors: Array<{ reason: string; step?: string; stepLabel?: string; screenshotPath?: string; htmlPath?: string }>;
}

interface StepPreview {
  step: string;
  label: string;
  description: string;
  canRun: boolean;
}

const SCRAPER_SUBSTEPS: { key: ScraperSubStep; label: string; icon: typeof Globe }[] = [
  { key: 'abrir', label: 'Abrir navegador', icon: Globe },
  { key: 'login', label: 'Iniciar sesión', icon: LogIn },
  { key: 'filtrar', label: 'Buscar órdenes sin documento', icon: Search },
  { key: 'leer', label: 'Leer detalle', icon: Eye },
  { key: 'exportar', label: 'Exportar JSON', icon: Download },
];

const SCRAPER_STEP_TO_UI: Record<string, ScraperSubStep> = {
  abrir_navegador: 'abrir',
  login_falabella: 'login',
  filtrar_ventas: 'filtrar',
  leer_detalle: 'leer',
  exportar_json: 'exportar',
};

const SCRAPER_UI_LABELS: Record<ScraperSubStep, string> = {
  abrir: 'Abrir navegador',
  login: 'Iniciar sesión',
  filtrar: 'Buscar órdenes sin documento',
  leer: 'Leer detalle',
  exportar: 'Exportar JSON',
};

const EMIT_STEPS: Array<{ key: EmitStepKey; label: string }> = [
  { key: 'create', label: 'Crear boletas' },
  { key: 'build', label: 'Armar resumen' },
  { key: 'send', label: 'Firmar y enviar' },
  { key: 'ticket', label: 'Consultar ticket' },
];

const PHASES: { key: Phase; label: string }[] = [
  { key: 'scraping', label: 'Paso 1: Extraer de Falabella' },
  { key: 'convertir', label: 'Paso 2: Convertir a SUNAT' },
  { key: 'emitir', label: 'Paso 3: Emitir Boletas' },
];

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function splitGrossIgv(total: number, porcentajeIgv: number) {
  const factor = 1 + porcentajeIgv / 100;
  const base = roundMoney(total / factor);
  const igv = roundMoney(total - base);
  return { base, igv };
}

function distributeGrossTotalsByQuantity(total: number, quantities: number[]) {
  const safeQuantities = quantities.map(quantity => Math.max(1, Math.round(quantity || 1)));
  const totalUnits = safeQuantities.reduce((sum, quantity) => sum + quantity, 0);
  if (totalUnits <= 0) return safeQuantities.map(() => 0);

  const totalCents = Math.round(total * 100);
  const baseUnitCents = Math.floor(totalCents / totalUnits);
  let remainder = totalCents - baseUnitCents * totalUnits;

  return safeQuantities.map((quantity) => {
    const extra = Math.min(remainder, quantity);
    remainder -= extra;
    return (quantity * baseUnitCents + extra) / 100;
  });
}

function normalizeVentaForSunat(venta: any) {
  const detalles = Array.isArray(venta?.detalles) ? venta.detalles : [];
  const expectedTotal = Number(venta?.total || 0);

  if (!detalles.length || expectedTotal <= 0) {
    return venta;
  }

  const quantities = detalles.map((detalle: any) => Math.max(1, Number(detalle?.cantidad) || 1));
  const currentGrossTotal = roundMoney(detalles.reduce((sum: number, detalle: any) => {
    const quantity = Math.max(1, Number(detalle?.cantidad) || 1);
    const baseUnit = Number(detalle?.mtoValorUnitario || 0);
    const porcentajeIgv = Number(detalle?.porcentajeIgv || 0);
    const taxable = String(detalle?.tipAfeIgv || '10') === '10';
    const grossUnit = taxable ? baseUnit * (1 + porcentajeIgv / 100) : baseUnit;
    return sum + grossUnit * quantity;
  }, 0));

  if (Math.abs(currentGrossTotal - expectedTotal) < 0.01) {
    return { ...venta, total: expectedTotal };
  }

  const redistributedLineTotals = distributeGrossTotalsByQuantity(expectedTotal, quantities);
  const normalizedDetalles = detalles.map((detalle: any, index: number) => {
    const quantity = quantities[index];
    const porcentajeIgv = Number(detalle?.porcentajeIgv || 0);
    const taxable = String(detalle?.tipAfeIgv || '10') === '10';
    const grossLineTotal = redistributedLineTotals[index];
    const baseLineTotal = taxable ? splitGrossIgv(grossLineTotal, porcentajeIgv).base : grossLineTotal;
    return {
      ...detalle,
      cantidad: quantity,
      mtoValorUnitario: Math.round((baseLineTotal / quantity) * 100000000) / 100000000,
    };
  });

  return {
    ...venta,
    total: expectedTotal,
    detalles: normalizedDetalles,
  };
}

function normalizeVentasForSunat(ventas: any[]) {
  return ventas.map(normalizeVentaForSunat);
}

function splitRawOrdersByInvoiceType(rawOrders: any[]) {
  const facturaOrders = rawOrders.filter(
    (order) => String(order?.invoiceType || '').toUpperCase() === 'FACTURA',
  );
  const boletaOrders = rawOrders.filter(
    (order) => String(order?.invoiceType || '').toUpperCase() !== 'FACTURA',
  );
  return { facturaOrders, boletaOrders };
}

function getFalabellaInvoiceTypeLabel(order: any) {
  const type = String(order?.invoiceType || '').toUpperCase();
  if (type === 'FACTURA') return 'FACTURA';
  if (type === 'BOLETA') return 'BOLETA';
  return 'SIN_TIPO';
}

function getFalabellaInvoiceTypeBadge(order: any) {
  const invoiceType = getFalabellaInvoiceTypeLabel(order);
  const invoiceTag = invoiceType === 'FACTURA' ? 'F' : invoiceType === 'BOLETA' ? 'B' : '?';
  const badgeClass = invoiceType === 'FACTURA'
    ? 'bg-amber-100 text-amber-800 border-amber-200'
    : invoiceType === 'BOLETA'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : 'bg-slate-100 text-slate-700 border-slate-200';

  return { invoiceType, invoiceTag, badgeClass };
}

type PhaseStatus = 'pending' | 'current' | 'done' | 'error';
type FlowNodeData = {
  label: string;
  index: number;
  status: PhaseStatus;
  clickable: boolean;
  warning?: string;
  onSelect: () => void;
};

function FlowStepNode({ data }: NodeProps<Node<FlowNodeData, 'flowStep'>>) {
  const stepClass: Record<PhaseStatus, string> = {
    pending: 'border-border bg-card text-muted-foreground',
    current: 'border-primary bg-primary text-primary-foreground',
    done: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    error: 'border-red-300 bg-red-50 text-red-700',
  };

  return (
    <div className="relative nopan">
      <Handle type="target" position={Position.Left} className="!h-3.5 !w-3.5 !border-2 !border-card !bg-slate-400" />
      <button
        onClick={data.onSelect}
        onMouseDown={(event) => event.stopPropagation()}
        disabled={!data.clickable}
        className={`nodrag rounded-full border px-4 py-2 text-sm font-medium transition ${stepClass[data.status]} ${
          data.clickable ? 'hover:opacity-90' : 'cursor-not-allowed opacity-75'
        }`}
      >
        {data.index}. {data.label}
      </button>
      <Handle type="source" position={Position.Right} className="!h-3.5 !w-3.5 !border-2 !border-card !bg-slate-400" />
      {data.warning && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {data.warning}
        </div>
      )}
    </div>
  );
}

function SubStepNode({ data }: NodeProps<Node<FlowNodeData, 'subStep'>>) {
  const colors: Record<PhaseStatus, string> = {
    pending: 'bg-muted/30 border-border text-muted-foreground',
    current: 'bg-primary border-primary-foreground/20 text-primary-foreground',
    done: 'bg-emerald-50 border-emerald-300 text-emerald-800',
    error: 'bg-red-50 border-red-300 text-red-700',
  };
  const lines = data.label.split('\n');
  return (
    <div className={`nodrag relative rounded-xl border-2 px-4 py-2.5 text-center min-w-[130px] shadow-md ${colors[data.status]}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !bg-slate-400" />
      <div className="text-xs font-bold tracking-wide">{lines[0]}</div>
      {lines[1] && <div className="text-[11px] font-mono opacity-80 mt-0.5">{lines[1]}</div>}
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !bg-slate-400" />
    </div>
  );
}

const flowNodeTypes = { flowStep: FlowStepNode, subStep: SubStepNode };

export default function Workflow() {
  const activeId = useAppStore((s) => s.activeCompanyId);
  const setActiveId = useAppStore((s) => s.setActiveCompanyId);

  const [phase, setPhase] = useState<Phase>('preflight');
  const [companies, setCompanies] = useState<any[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  // Paso 1: Scraping config
  const [headless, setHeadless] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => {
    const from = new Date();
    from.setDate(from.getDate() - 7);
    return formatLocalDate(from);
  });
  const [dateTo, setDateTo] = useState(() => formatLocalDate(new Date()));

  // Paso 1: Scraping state
  const [scrapingRunning, setScrapingRunning] = useState(false);
  const [scrapingCurrentStep, setScrapingCurrentStep] = useState('');
  const [scrapingPreview, setScrapingPreview] = useState<StepPreview | null>(null);
  const [scrapingState, setScrapingState] = useState<ScraperState | null>(null);
  const [scrapingLog, setScrapingLog] = useState<string[]>([]);
  const [scrapingError, setScrapingError] = useState('');
  const [scrapingStartTime, setScrapingStartTime] = useState(0);
  const [scrapingElapsed, setScrapingElapsed] = useState('');
  const [stepTimes, setStepTimes] = useState<Record<string, number>>({});
  const stepStartMsRef = useRef<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [sourcePage, setSourcePage] = useState(1);
  const [expandedConvert, setExpandedConvert] = useState<number | null>(null);
  const [convertPage, setConvertPage] = useState(1);
  const [pdfPreview, setPdfPreview] = useState<{
    title: string;
    numeroCompleto: string;
    html: string;
    total: number;
    itemCount: number;
  } | null>(null);
  const [previewLoadingIndex, setPreviewLoadingIndex] = useState<number | null>(null);
  const [htmlViewer, setHtmlViewer] = useState<{ path: string; content: string; error?: string } | null>(null);
  const [imageViewer, setImageViewer] = useState<{ path: string; dataUrl: string; error?: string } | null>(null);
  const scrapingPauseRequestedRef = useRef(false);

  // Paso 2: Convertir state
  const [convertRunning, setConvertRunning] = useState(false);
  const [convertLog, setConvertLog] = useState<string[]>([]);
  const [convertError, setConvertError] = useState('');
  const [omittedFacturaOrders, setOmittedFacturaOrders] = useState<any[]>([]);

  const [homeDir, setHomeDir] = useState('');
  const [modoProduccion, setModoProduccion] = useState(true);

  // Shared ventas data
  const [rawOrdersData, setRawOrdersData] = useState<any[]>([]);
  const [pendingVentasData, setPendingVentasData] = useState<any[]>([]);
  const [ventasData, setVentasData] = useState<any[]>([]);
  const [ventasErrors, setVentasErrors] = useState<string[]>([]);

  // Paso 3: Emitir state
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<BoletaResult[]>([]);
  const [workflowError, setWorkflowError] = useState('');
  const [currentBoletaSteps, setCurrentBoletaSteps] = useState<EmitStep[]>([]);
  const emitStepStartRef = useRef<Record<string, number>>({});
  const emitActiveStepRef = useRef<EmitStepKey | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousCompanyIdRef = useRef<number | null>(null);

  const hasCompanies = companies.length > 0;
  const canScrape = company?.sellerUsername && company?.sellerPassword;
  const SOURCE_PAGE_SIZE = 10;
  const CONVERT_PAGE_SIZE = 15;
  const companyLabel = company
    ? `${company.nombre || company.razonSocial || 'Empresa sin nombre'}${company.ruc ? ` (${company.ruc})` : ''}`
    : '';
  const convertTotalPages = Math.max(1, Math.ceil(ventasData.length / CONVERT_PAGE_SIZE));
  const paginatedVentas = ventasData.slice(
    (convertPage - 1) * CONVERT_PAGE_SIZE,
    convertPage * CONVERT_PAGE_SIZE,
  );
  const sourceOrdersData = rawOrdersData.length > 0
    ? rawOrdersData
    : pendingVentasData.filter((row: any) => row && typeof row === 'object' && 'orderNumber' in row && !('client' in row));
  const canConvertExtractedOrders = rawOrdersData.length > 0 || pendingVentasData.length > 0 || !!scrapingState?.exportedCount;
  const sourceTotalPages = Math.max(1, Math.ceil(sourceOrdersData.length / SOURCE_PAGE_SIZE));
  const paginatedSourceOrders = sourceOrdersData.slice(
    (sourcePage - 1) * SOURCE_PAGE_SIZE,
    sourcePage * SOURCE_PAGE_SIZE,
  );
  const sourceInvoiceSummary = useMemo(() => {
    return sourceOrdersData.reduce((acc: Record<string, number>, order: any) => {
      const key = getFalabellaInvoiceTypeLabel(order);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [sourceOrdersData]);

  const playWorkflowTone = (kind: 'success' | 'error' = 'success') => {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtx();
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = kind === 'success' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(kind === 'success' ? 880 : 220, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'success' ? 1175 : 160, now + 0.18);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.22);
  };

  const loadCompanies = async () => {
    setLoadingCompanies(true);
    const list = await api.listCompanies();
    setCompanies(list);
    setLoadingCompanies(false);
  };

  const loadCompany = async (id: number) => {
    const selected = await api.getCompany(id);
    setCompany(selected);
  };

  useEffect(() => { loadCompanies(); }, []);
  useEffect(() => {
    if (!scrapingRunning && !processing) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [scrapingRunning, processing]);

  useEffect(() => {
    if (previousCompanyIdRef.current !== null && previousCompanyIdRef.current !== activeId) {
      api.scraperCleanup().catch(() => {});
      setPhase('preflight');
      setScrapingRunning(false);
      setScrapingCurrentStep('');
      setScrapingPreview(null);
      setScrapingState(null);
      setScrapingLog([]);
      setScrapingError('');
      setConvertRunning(false);
      setConvertLog([]);
      setConvertError('');
      setOmittedFacturaOrders([]);
      setRawOrdersData([]);
      setPendingVentasData([]);
      setVentasData([]);
      setVentasErrors([]);
      setResults([]);
      setWorkflowError('');
      scrapingPauseRequestedRef.current = false;
      stepStartMsRef.current = {};
      setStepTimes({});
    }
    previousCompanyIdRef.current = activeId;
    if (!activeId) { setCompany(null); return; }
    loadCompany(activeId).catch(() => setCompany(null));
  }, [activeId]);

  useEffect(() => {
    setConvertPage(1);
    setExpandedConvert(null);
  }, [ventasData]);

  useEffect(() => {
    setSourcePage(1);
    setExpandedOrder(null);
  }, [sourceOrdersData]);

  useEffect(() => {
    api.getHomeDir().then((home: string) => {
      setHomeDir(home);
    }).catch(() => {});
  }, []);

  const handleSelectCompany = async (id: number | null) => {
    setActiveId(id);
    await api.setActiveCompanyId(id);
    if (id) await loadCompany(id);
    else setCompany(null);
  };

  const scrapingStepIndex = SCRAPER_SUBSTEPS.findIndex(s => s.key === scrapingCurrentStep);

  const importFalabellaJson = async () => {
    try {
      const filePath = await api.selectInputFile();
      if (!filePath) return;

      setScrapingLog([`📂 Cargando ${filePath.split('/').pop()}...`]);
      const result = await api.scraperLoadOrders(filePath);

      if (result.error) {
        alert(result.error);
        setScrapingLog([`❌ ${result.error}`]);
        return;
      }

      if (!result.ventas || result.ventas.length === 0) {
        if (result.isRaw && result.orders?.length) {
          setRawOrdersData(result.orders);
          setPendingVentasData([]);
          setVentasData([]);
          setOmittedFacturaOrders([]);
          setVentasErrors([]);
          setScrapingState({ step: 'completado', exportedCount: result.orderCount } as any);
          setScrapingError('');
          setScrapingLog([`📂 ${result.orderCount} órdenes raw importadas. Convierte en el Paso 2.`]);
          setPhase('scraping');
          playWorkflowTone('success');
          return;
        }
        alert('El archivo no contiene ventas.');
        setScrapingLog([`⚠️ 0 ventas.`]);
        return;
      }

      setRawOrdersData([]);
      setPendingVentasData(result.ventas);
      setVentasData([]);
      setOmittedFacturaOrders([]);
      setScrapingState({ step: 'completado', exportedCount: result.orderCount } as any);
      setVentasErrors([]);
      setScrapingError('');
      setScrapingLog([`📂 ${result.orderCount} ventas importadas. Convierte en el Paso 2.`]);
      setPhase('scraping');
      playWorkflowTone('success');
    } catch (e: any) {
      alert('Error: ' + e.message);
      setScrapingLog([`❌ ${e.message}`]);
    }
  };

  const exportFalabellaJson = async () => {
    if (ventasData.length === 0) return;
    try {
      const filePath = await api.selectSaveFile();
      if (!filePath) return;

      const result = await api.scraperExportOrders(filePath, ventasData);
      if (result.error) {
        setScrapingError(result.error);
        return;
      }

      setScrapingLog(prev => [...prev, `💾 Exportado: ${ventasData.length} órdenes a ${result.path}`]);
    } catch (e: any) {
      setScrapingError(`Error al exportar: ${e.message}`);
    }
  };

  const openHtmlViewer = async (filePath: string) => {
    try {
      const content = await api.readTextFile(filePath);
      setHtmlViewer({ path: filePath, content });
    } catch (e: any) {
      setHtmlViewer({ path: filePath, content: '', error: e.message || 'No se pudo leer el HTML.' });
    }
  };

  const openImageViewer = async (filePath: string) => {
    try {
      const dataUrl = await api.readFileDataUrl(filePath);
      setImageViewer({ path: filePath, dataUrl });
    } catch (e: any) {
      setImageViewer({ path: filePath, dataUrl: '', error: e.message || 'No se pudo leer la captura.' });
    }
  };

  const runScraping = async () => {
    if (!canScrape) return;
    if (!dateFrom) {
      setScrapingError('La fecha "Desde" es obligatoria.');
      return;
    }
    setPhase('scraping');
    setScrapingRunning(true);
    setScrapingCurrentStep('abrir');
    stepStartMsRef.current = { abrir: Date.now() };
    setStepTimes({});
    setScrapingLog([]);
    setScrapingError('');
    setRawOrdersData([]);
    setPendingVentasData([]);
    setVentasData([]);
    setOmittedFacturaOrders([]);
    scrapingPauseRequestedRef.current = false;
    const startTime = Date.now();
    setScrapingStartTime(startTime);
    setScrapingElapsed('');
    const scraperBaseDir = homeDir ? `${homeDir}/.zentofact` : '.zentofact';
    const scraperOutputDir = `${scraperBaseDir}/data`;
    const authStatePath = `${scraperBaseDir}/falabella-session-company-${company.id}.json`;

    const config = {
      sellerUrl: 'https://sellercenter.falabella.com/user/auth/login',
      username: company.sellerUsername,
      password: company.sellerPassword,
      headless,
      outputDir: scraperOutputDir,
      dateFrom,
      dateTo: dateTo || undefined,
      authStatePath,
    };

    await api.scraperInit(config);

    // Listen for step progress BEFORE running
    api.onScraperProgress((data: any) => {
      const state = data.state;
      const step = state?.step;
      const now = Date.now();

      const uiStep = SCRAPER_STEP_TO_UI[step] || '';
      if (!uiStep) return;

      // Mark previous step as complete
      const uiSteps = ['abrir', 'login', 'filtrar', 'leer', 'exportar'];
      const uiIdx = uiSteps.indexOf(uiStep);
      if (uiIdx > 0) {
        const prev = uiSteps[uiIdx - 1];
        if (stepStartMsRef.current[prev]) {
          setStepTimes(t => ({ ...t, [prev]: t[prev] ?? Math.round((now - stepStartMsRef.current[prev]) / 100) / 10 }));
        }
      }

      // Record current step start
      if (!stepStartMsRef.current[uiStep]) {
        stepStartMsRef.current = { ...stepStartMsRef.current, [uiStep]: now };
      }

      setScrapingCurrentStep(uiStep);
      setScrapingState(state);
      setScrapingLog(prev => [...prev, `⏳ ${data.preview?.description || ''}`]);
    });

    const result = await api.scraperRunAll();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    setScrapingElapsed(elapsed);
    setScrapingRunning(false);

    // Record remaining step times
    for (const s of ['abrir', 'login', 'filtrar', 'leer', 'exportar']) {
      if (stepStartMsRef.current[s]) {
        setStepTimes(prev => ({ ...prev, [s]: prev[s] ?? Math.round((Date.now() - stepStartMsRef.current[s]) / 100) / 10 }));
      }
    }

    if (scrapingPauseRequestedRef.current) {
      return;
    }

    if (result.ventas?.length || result.rawOrders?.length) {
      const hasRawOrders = Array.isArray(result.rawOrders) && result.rawOrders.length > 0;
      const sourceOrders = hasRawOrders ? result.rawOrders : (result.ventas || []);
      const { facturaOrders, boletaOrders } = hasRawOrders
        ? splitRawOrdersByInvoiceType(sourceOrders)
        : { facturaOrders: [], boletaOrders: sourceOrders };
      const { filtered: newBoletaOrders, omitted: alreadyRegisteredOrders } = await filterAlreadyRegisteredBoletas(boletaOrders);
      const nextState = {
        ...result.state,
        exportedCount: newBoletaOrders.length,
      };
      const alreadyRegisteredText = alreadyRegisteredOrders
        .map((order: any) => order.orderNumber)
        .filter(Boolean)
        .join(', ');

      setRawOrdersData(hasRawOrders ? newBoletaOrders : []);
      setPendingVentasData(hasRawOrders ? [] : newBoletaOrders);
      setVentasData([]);
      setOmittedFacturaOrders(facturaOrders);
      setScrapingState(nextState);
      setVentasErrors([]);
      setScrapingError('');

      if (newBoletaOrders.length > 0) {
        setScrapingLog(prev => [
          ...prev,
          `✅ Falabella encontró ${sourceOrders.length} órdenes sin documento en ${elapsed}s.`,
          facturaOrders.length > 0
            ? `ℹ️ ${facturaOrders.length} son FACTURA y no se emitirán como boleta.`
            : 'ℹ️ No hay FACTURAS en esta extracción.',
          alreadyRegisteredOrders.length > 0
            ? `⚠️ ${alreadyRegisteredOrders.length} boletas ya existen en nuestro sistema y no avanzan: ${alreadyRegisteredText}.`
            : '✅ Ninguna boleta estaba registrada previamente.',
          `➡️ Se emitirán ${newBoletaOrders.length} boletas nuevas. Continúa con el Paso 2.`,
        ]);
      } else {
        setScrapingLog(prev => [
          ...prev,
          `✅ Falabella encontró ${sourceOrders.length} órdenes sin documento en ${elapsed}s.`,
          facturaOrders.length > 0
            ? `ℹ️ ${facturaOrders.length} son FACTURA y no se emitirán como boleta.`
            : 'ℹ️ No hay FACTURAS en esta extracción.',
          alreadyRegisteredOrders.length > 0
            ? `⚠️ ${alreadyRegisteredOrders.length} boletas ya existen en nuestro sistema: ${alreadyRegisteredText}.`
            : '⚠️ No hay boletas nuevas para emitir.',
          '⛔ No hay boletas nuevas. El Paso 2 queda bloqueado.',
        ]);
      }
      playWorkflowTone('success');
    } else {
      setScrapingState(result.state);
      const firstError = result.state?.errors?.[0];
      const failedLabel = result.state?.failedStepLabel || firstError?.stepLabel;
      const errorText = firstError?.reason
        ? `❌ ${failedLabel ? `Falló en ${failedLabel}: ` : ''}${firstError.reason}`
        : `⚠️ 0 ventas en ${elapsed}s`;
      setScrapingLog(prev => [...prev, errorText]);
      playWorkflowTone(result.state?.errors?.length ? 'error' : 'success');
    }
  };

  useEffect(() => {
    const handler = () => {
      if (scrapingRunning) return;
      if (phase !== 'preflight' && phase !== 'scraping') return;
      runScraping();
    };

    window.addEventListener('workflow:start-scraping', handler as EventListener);
    return () => {
      window.removeEventListener('workflow:start-scraping', handler as EventListener);
    };
  }, [phase, runScraping, scrapingRunning]);

  useEffect(() => {
    const handler = async () => {
      if (!scrapingRunning) return;
      scrapingPauseRequestedRef.current = true;
      setScrapingRunning(false);
      setScrapingError('Extracción pausada por usuario.');
      setScrapingLog((prev) => [...prev, '⏸ Extracción pausada por usuario.']);
      try {
        await api.scraperCleanup();
      } catch {
        // noop
      }
    };

    window.addEventListener('workflow:pause-scraping', handler as EventListener);
    return () => {
      window.removeEventListener('workflow:pause-scraping', handler as EventListener);
    };
  }, [scrapingRunning]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ dateFrom?: string; dateTo?: string }>;
      if (typeof custom.detail?.dateFrom === 'string') setDateFrom(custom.detail.dateFrom);
      if (typeof custom.detail?.dateTo === 'string') setDateTo(custom.detail.dateTo);
    };

    window.addEventListener('workflow:set-date-range', handler as EventListener);
    return () => {
      window.removeEventListener('workflow:set-date-range', handler as EventListener);
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('workflow:running-state', { detail: { running: scrapingRunning } }));
  }, [scrapingRunning]);

  const filterAlreadyRegisteredBoletas = async (ventas: any[]) => {
    if (!company?.id || ventas.length === 0) return { filtered: ventas, omitted: [] as any[] };

    const checked = await Promise.all(ventas.map(async (venta) => {
      const orderNumber = String(venta?.orderNumber || '').trim();
      if (!orderNumber) return { venta, existing: null };

      const result = await api.listBoletas({
        companyId: company.id,
        orderNumber,
        limit: 10,
      });
      const existing = (result.boletas || []).find((boleta: any) => (
        String(boleta.orderNumber || '').trim() === orderNumber
      )) || null;

      return { venta, existing };
    }));

    const omitted = checked.filter(row => row.existing).map(row => row.venta);
    const filtered = checked.filter(row => !row.existing).map(row => row.venta);
    return { filtered, omitted };
  };

  const runConvertir = async () => {
    setPhase('convertir');
    setConvertRunning(true);
    setConvertLog([]);
    setConvertError('');
    setOmittedFacturaOrders([]);
    setPdfPreview(null);
    setExpandedConvert(null);
    setConvertPage(1);
    setSourcePage(1);

    try {
      if (rawOrdersData.length > 0) {
        const { facturaOrders, boletaOrders } = splitRawOrdersByInvoiceType(rawOrdersData);
        if (facturaOrders.length > 0) {
          setOmittedFacturaOrders(facturaOrders);
          setConvertLog(prev => [
            ...prev,
            `⚠️ ${facturaOrders.length} órdenes marcadas como FACTURA fueron omitidas en Paso 2.`,
          ]);
        }
        if (boletaOrders.length === 0) {
          setConvertError('Todas las órdenes importadas están marcadas como FACTURA. No hay boletas para convertir.');
          setConvertRunning(false);
          playWorkflowTone('error');
          return;
        }

        setConvertLog(prev => [...prev, `⏳ Convirtiendo ${boletaOrders.length} órdenes raw importadas...`]);
        const res = await api.scraperConvertOrders(boletaOrders);
        if (res.ventas?.length) {
          const normalizedVentas = normalizeVentasForSunat(res.ventas);
          setConvertLog(prev => [...prev, `✅ ${normalizedVentas.length} ventas convertidas desde JSON raw.`]);
          setRawOrdersData([]);
          setPendingVentasData([]);
          setVentasData(normalizedVentas);
          const errors = await api.validateVentas(normalizedVentas);
          setVentasErrors(errors);
          setConvertRunning(false);
          playWorkflowTone('success');
        } else {
          setConvertError(res.error || 'No se generaron ventas válidas.');
          setConvertRunning(false);
          playWorkflowTone('error');
        }
        return;
      }

      if (pendingVentasData.length > 0) {
        setOmittedFacturaOrders([]);
        setConvertLog(prev => [...prev, `⏳ Normalizando ${pendingVentasData.length} ventas al formato SUNAT...`]);
        const normalizedVentas = normalizeVentasForSunat(pendingVentasData);
        setPendingVentasData([]);
        setVentasData(normalizedVentas);
        const errors = await api.validateVentas(normalizedVentas);
        setVentasErrors(errors);
        setConvertLog(prev => [...prev, `✅ ${normalizedVentas.length} ventas normalizadas para SUNAT.`]);
        setConvertRunning(false);
        playWorkflowTone('success');
        return;
      }

      const { preview } = await api.scraperGetState();
      setConvertLog(prev => [...prev, `⏳ ${preview.description}`]);

      const res = await api.scraperStepConvertir();
      if (res.ventas?.length) {
        const normalizedVentas = normalizeVentasForSunat(res.ventas);
        setConvertLog(prev => [...prev, `✅ ${res.result.summary}`]);
        setVentasData(normalizedVentas);
        const errors = await api.validateVentas(normalizedVentas);
        setVentasErrors(errors);
        setConvertRunning(false);
        playWorkflowTone('success');
      } else {
        setConvertError('No se generaron ventas válidas.');
        setConvertRunning(false);
        playWorkflowTone('error');
      }
    } catch (error: any) {
      setConvertRunning(false);
      setConvertError(error?.message || 'No se pudo convertir a formato SUNAT.');
      playWorkflowTone('error');
    }
  };

  const proceedToEmit = () => setPhase('emitir');

  const openPdfPreview = async (venta: any, absoluteIndex: number) => {
    if (!company?.id) return;
    setPreviewLoadingIndex(absoluteIndex);
    try {
      const preview = await api.previewBoletaHtml(company.id, venta);
      setPdfPreview({
        title: `${preview.numeroCompleto} · ${venta.client?.razonSocial || 'Cliente sin nombre'}`,
        numeroCompleto: preview.numeroCompleto,
        html: preview.html,
        total: Number(preview.totals?.mtoImpVenta || venta.total || 0),
        itemCount: venta.detalles?.length || 0,
      });
    } catch (error: any) {
      alert(error?.message || 'No se pudo generar la vista previa del PDF.');
    } finally {
      setPreviewLoadingIndex(null);
    }
  };

  const startEmitir = async () => {
    if (!company || !ventasData.length) return;
    const { filtered, omitted } = await filterAlreadyRegisteredBoletas(ventasData);
    if (omitted.length > 0) {
      setVentasData(filtered);
    }
    if (filtered.length === 0) {
      setWorkflowError(`Todas las órdenes ya tienen boleta registrada: ${omitted.map((venta: any) => venta.orderNumber).join(', ')}.`);
      setLog([`⚠️ ${omitted.length} órdenes omitidas porque ya existen en el sistema.`]);
      setResults([]);
      return;
    }

    setProcessing(true);
    setLog(omitted.length > 0
      ? [`⚠️ ${omitted.length} órdenes se registraron antes de emitir y fueron omitidas: ${omitted.map((venta: any) => venta.orderNumber).join(', ')}.`]
      : []
    );
    setWorkflowError('');
    setResults([]);
    setProgress({ current: 0, total: filtered.length, status: 'Iniciando...' });

    emitStepStartRef.current = {};
    emitActiveStepRef.current = null;
    setCurrentBoletaSteps(EMIT_STEPS.map(step => ({ ...step, status: 'pending' as const })));

    const setEmitStep = (key: EmitStepKey) => {
      const now = Date.now();
      const previousKey = emitActiveStepRef.current;
      if (previousKey && previousKey !== key && emitStepStartRef.current[previousKey]) {
        const elapsedMs = now - emitStepStartRef.current[previousKey];
        setCurrentBoletaSteps(prev => prev.map(step => (
          step.key === previousKey && step.status !== 'done' ? { ...step, status: 'done', elapsedMs } : step
        )));
      }
      if (!emitStepStartRef.current[key]) emitStepStartRef.current[key] = now;
      emitActiveStepRef.current = key;
      setCurrentBoletaSteps(prev => {
        const activeIndex = prev.findIndex(step => step.key === key);
        return prev.map((step, index) => {
          if (step.key === key) return { ...step, status: 'current' };
          if (index < activeIndex && step.status !== 'error') return { ...step, status: 'done' };
          return step.status === 'error' ? step : { ...step, status: index > activeIndex ? 'pending' : step.status };
        });
      });
    };

    const finishEmitSteps = (failed = false) => {
      const now = Date.now();
      const activeKey = emitActiveStepRef.current;
      setCurrentBoletaSteps(prev => prev.map(step => {
        if (activeKey === step.key && emitStepStartRef.current[step.key]) {
          return { ...step, status: failed ? 'error' : 'done', elapsedMs: now - emitStepStartRef.current[step.key] };
        }
        if (!failed && step.status !== 'error') return { ...step, status: 'done' };
        return step;
      }));
      emitActiveStepRef.current = null;
    };

    api.onProgress(({ current, total, status }: any) => {
      setProgress({ current, total, status });
      setLog(prev => [...prev, status]);
      if (status.includes('Creando boleta')) setEmitStep('create');
      else if (status.includes('Armando resumen')) setEmitStep('build');
      else if (status.includes('Firmando') || status.includes('enviando resumen')) setEmitStep('send');
      else if (status.includes('Consultando ticket')) setEmitStep('ticket');
    });

    const savedOutputDir = localStorage.getItem('boletas.outputDir');
    const emitOutputDir = savedOutputDir || (homeDir ? `${homeDir}/boletas-emitidas` : 'boletas-emitidas');

    const config = {
      companyId: company.id,
      ruc: company.ruc, razonSocial: company.razonSocial,
      direccion: company.direccion || '', ubigeo: company.ubigeo || '',
      usuarioSol: company.usuarioSol || '', claveSol: company.claveSol || '',
      certificadoBase64: company.certificado || '',
      certificadoPassword: company.certificadoPassword || '',
      modoProduccion,
      outputDir: emitOutputDir,
    };

    const result = await api.processWorkflow(config, filtered);
    setProcessing(false);

    if (result.success) {
      const boletas = result.result.boletas || [];
      setResults(boletas);
      setWorkflowError('');
      finishEmitSteps(false);
      playWorkflowTone('success');
    } else {
      setWorkflowError(result.error);
      setResults([]);
      finishEmitSteps(true);
      playWorkflowTone('error');
    }
    setPhase('resultados');
  };

  const getPhaseStatus = (key: Phase) => {
    if (key === 'scraping') {
      if (scrapingState?.exportedCount) return 'done';
      if (phase === 'scraping') return 'current';
      return 'pending';
    }
    if (key === 'convertir') {
      if (ventasData.length > 0) return 'done';
      if (phase === 'convertir') return 'current';
      return 'pending';
    }
    if (key === 'emitir') {
      if (phase === 'resultados') return 'done';
      if (phase === 'emitir') return 'current';
      return 'pending';
    }
    return 'pending';
  };

  const canOpenPhase = (key: Phase) => {
    if (key === 'scraping') return true;
    if (key === 'convertir') return canConvertExtractedOrders || phase === 'convertir' || ventasData.length > 0;
    if (key === 'emitir') return ventasData.length > 0 || phase === 'emitir' || phase === 'resultados';
    return false;
  };

  const selectPhase = (key: Phase) => {
    if (!canOpenPhase(key) || scrapingRunning || convertRunning || processing) return;
    if (key === 'scraping') setPhase('preflight');
    if (key === 'convertir') setPhase('convertir');
    if (key === 'emitir') setPhase('emitir');
  };

  const getFlowWarning = (key: Phase) => {
    if (key === 'scraping' && !canScrape) return 'Falta configurar credenciales de Falabella Seller.';
    if (key === 'convertir' && !canConvertExtractedOrders && phase !== 'convertir' && ventasData.length === 0) {
      return 'Completa Paso 1 para convertir.';
    }
    if (key === 'emitir' && ventasData.length === 0 && phase !== 'emitir' && phase !== 'resultados') {
      return 'Completa Paso 2 para emitir.';
    }
    return undefined;
  };

  const flowNodes = useMemo<Node<FlowNodeData, 'flowStep'>[]>(
    () =>
      PHASES.map((step, index) => ({
        id: step.key,
        type: 'flowStep',
        position: { x: index * 430, y: 45 },
        draggable: false,
        selectable: false,
        data: {
          label: step.label,
          index: index + 1,
          status: getPhaseStatus(step.key),
          clickable: canOpenPhase(step.key),
          warning: getFlowWarning(step.key),
          onSelect: () => selectPhase(step.key),
        },
      })),
    [phase, scrapingState?.exportedCount, ventasData.length, scrapingRunning, convertRunning, processing, canScrape],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      PHASES.slice(0, -1).map((step, index) => ({
        id: `${step.key}-${PHASES[index + 1].key}`,
        source: step.key,
        target: PHASES[index + 1].key,
        type: 'bezier',
        animated: getPhaseStatus(step.key) === 'current',
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: {
          strokeWidth: 2,
          stroke: getPhaseStatus(step.key) === 'done' ? '#059669' : '#94a3b8',
          strokeDasharray: getPhaseStatus(step.key) === 'done' ? undefined : '6 6',
        },
      })),
    [phase, scrapingState?.exportedCount, ventasData.length],
  );

  const scrapingExtractedCount = scrapingState?.exportedCount ?? 0;
  const scrapingErrorCount = scrapingState?.errors?.length ?? 0;
  const primaryScrapingIssue =
    scrapingError || (scrapingErrorCount > 0 ? scrapingState?.errors?.[0]?.reason || '' : '');
  const primaryScrapingScreenshot = scrapingState?.errors?.find(error => error.screenshotPath)?.screenshotPath || '';
  const primaryScrapingHtml = scrapingState?.errors?.find(error => error.htmlPath)?.htmlPath || '';
  const failedScraperUiStep = !scrapingRunning && primaryScrapingIssue
    ? SCRAPER_STEP_TO_UI[scrapingState?.failedStep || scrapingState?.errors?.[0]?.step || ''] || (scrapingCurrentStep as ScraperSubStep)
    : '';
  const failedScraperStepLabel = failedScraperUiStep
    ? scrapingState?.failedStepLabel || scrapingState?.errors?.[0]?.stepLabel || SCRAPER_UI_LABELS[failedScraperUiStep]
    : '';

  const cleanedScrapingLog = useMemo(() => {
    const entries = scrapingLog.map((entry) => ({
      text: entry.replace(/^[✅❌⏳⚠️]\s*/, '').trim(),
      isError: entry.startsWith('❌'),
    }));
    return entries.filter((entry, index) => entry.text && (index === 0 || entry.text !== entries[index - 1].text));
  }, [scrapingLog]);

  const groupedResults = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      summaryNumero: string;
      ticket: string;
      estado: string;
      response: string;
      responseCode?: string;
      boletas: BoletaResult[];
    }>();

    results.forEach((result) => {
      const key = result.summaryNumero || result.summaryTicket || 'SIN_RESUMEN';
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          summaryNumero: result.summaryNumero || 'Sin resumen',
          ticket: result.summaryTicket || '-',
          estado: result.summaryEstado || result.estadoSunat,
          response: result.summaryResponse || result.error || '',
          responseCode: result.summaryResponseCode,
          boletas: [],
        });
      }

      const group = groups.get(key)!;
      group.boletas.push(result);
      if (result.summaryResponse && result.summaryResponse.length > group.response.length) {
        group.response = result.summaryResponse;
      }
      if (result.summaryEstado === 'RECHAZADO' || result.estadoSunat === 'RECHAZADO') {
        group.estado = 'RECHAZADO';
      } else if (result.summaryEstado) {
        group.estado = result.summaryEstado;
      }
    });

    return Array.from(groups.values());
  }, [results]);

  // ── Preflight / no company ──

  if (loadingCompanies) {
    return <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Cargando empresas...</div>;
  }

  if (!hasCompanies) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Building2 className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Necesitas al menos una empresa</h2>
        <p className="mt-1 text-sm text-muted-foreground">Configura una empresa con credenciales de Falabella Seller y SUNAT.</p>
        <Link to="/companies" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Ir a Empresas <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (!activeId) {
    return (
      <div className="max-w-2xl space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Selecciona empresa para emitir</h2>
        <p className="text-sm text-muted-foreground">La empresa debe tener credenciales de Falabella Seller y SUNAT.</p>
        <select value="" onChange={(e) => { if (e.target.value) handleSelectCompany(Number(e.target.value)); }}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
          <option value="">Selecciona una empresa</option>
          {companies.map(e => <option key={e.id} value={e.id}>{e.nombre || e.razonSocial} ({e.ruc})</option>)}
        </select>
        <Link to="/companies" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Gestionar empresas</Link>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No se pudo cargar la empresa.{' '}
        <button onClick={() => loadCompany(activeId)} className="font-medium text-primary hover:underline">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {htmlViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4 text-primary" />
                  HTML actual
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{htmlViewer.path}</div>
              </div>
              <button
                onClick={() => setHtmlViewer(null)}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 flex-1 p-4">
              {htmlViewer.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {htmlViewer.error}
                </div>
              ) : (
                <textarea
                  readOnly
                  value={htmlViewer.content}
                  spellCheck={false}
                  className="h-[60vh] w-full resize-none rounded-lg border border-input bg-background p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
                />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={() => navigator.clipboard?.writeText(htmlViewer.content).catch(() => {})}
                disabled={!htmlViewer.content}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copiar HTML
              </button>
              <button
                onClick={() => api.openOutputDir(htmlViewer.path)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Abrir archivo
              </button>
            </div>
          </div>
        </div>
      )}

      {imageViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Eye className="h-4 w-4 text-primary" />
                  Captura del error
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{imageViewer.path}</div>
              </div>
              <button
                onClick={() => setImageViewer(null)}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-black/5 p-4">
              {imageViewer.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {imageViewer.error}
                </div>
              ) : (
                <img
                  src={imageViewer.dataUrl}
                  alt="Captura del error"
                  className="mx-auto max-h-[70vh] max-w-full rounded-lg border border-border bg-white object-contain"
                />
              )}
            </div>
            <div className="flex justify-end border-t border-border px-4 py-3">
              <button
                onClick={() => api.openOutputDir(imageViewer.path)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Abrir archivo
              </button>
            </div>
          </div>
        </div>
      )}

      {pdfPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4 text-primary" />
                  Vista previa del PDF
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{pdfPreview.title}</div>
              </div>
              <button
                onClick={() => setPdfPreview(null)}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Cerrar
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted/30 px-2.5 py-1 font-mono text-foreground">{pdfPreview.numeroCompleto}</span>
              <span>{pdfPreview.itemCount} item{pdfPreview.itemCount !== 1 ? 's' : ''}</span>
              <span>Total: S/ {pdfPreview.total.toFixed(2)}</span>
              <span>Formato: A4</span>
            </div>
            <div className="min-h-0 flex-1 bg-muted/10 p-4">
              <iframe
                title={pdfPreview.title}
                srcDoc={pdfPreview.html}
                className="h-[72vh] w-full rounded-lg border border-border bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* Phase indicators */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Flujo de emisión</p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">SUNAT:</span>
              <button role="switch" aria-checked={modoProduccion} onClick={() => setModoProduccion(!modoProduccion)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition ${
                  modoProduccion ? 'bg-emerald-600' : 'bg-muted'
                }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                  modoProduccion ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
              <span className="text-xs font-medium">
                {modoProduccion ? <span className="text-emerald-600">Producción</span> : <span className="text-amber-600">Beta</span>}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Navegador:</span>
              <button role="switch" aria-checked={headless} onClick={() => setHeadless(!headless)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition ${
                  headless ? 'bg-muted' : 'bg-primary'
                }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                  headless ? 'translate-x-0' : 'translate-x-4'
                }`} />
              </button>
              <span className={`text-xs font-medium ${headless ? 'text-muted-foreground' : 'text-primary'}`}>
                {headless ? 'Oculto' : 'Visible'}
              </span>
            </div>
          </div>
        </div>
        <div className="h-[220px] w-full">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={flowNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.22 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            panOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            zoomOnScroll={false}
            preventScrolling
            attributionPosition="bottom-right"
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} className="opacity-25" />
          </ReactFlow>
        </div>
      </div>

      {/* ═══ PASO 1: SCRAPING ═══ */}
      {(phase === 'preflight' || phase === 'scraping') && (
        <div className="w-full space-y-4">
          {phase === 'preflight' && (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Paso 1: Extraer ventas de Falabella</h2>
              </div>

              {!canScrape ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Faltan credenciales de Falabella Seller</p>
                    <p className="mt-1">Configura Usuario Seller y Contraseña Seller en{' '}
                      <Link to="/companies" className="font-medium underline">Empresas</Link>.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-border bg-background p-4 text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Usuario:</span>
                      <span>{company.sellerUsername}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">URL:</span>
                      <span className="text-xs truncate max-w-60">sellercenter.falabella.com/user/auth/login</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => setPhase('convertir')}
                      disabled={ventasData.length === 0}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Continuar a convertir <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      onClick={importFalabellaJson}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
                    >
                      <FileUp className="h-4 w-4" />
                      Importar JSON
                    </button>
                  </div>

                </>
              )}

            </div>
          )}

          {phase === 'scraping' && (
            <div className="space-y-3">
              {!scrapingRunning && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={runScraping}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    Re-ejecutar
                  </button>
                  {ventasData.length > 0 && (
                    <button
                      onClick={exportFalabellaJson}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
                    >
                      <FileDown className="h-4 w-4" />
                      Exportar JSON
                    </button>
                  )}
                  <button
                    onClick={() => { if (ventasData.length > 0) { setPhase('convertir'); return; } runConvertir(); }}
                    disabled={scrapingExtractedCount === 0 && ventasData.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Continuar a convertir <ArrowRight className="h-4 w-4" />
                  </button>
                  {scrapingExtractedCount === 0 && (
                    <span className="text-xs text-muted-foreground">No hay ventas extraídas para convertir.</span>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-center gap-1 py-4 flex-wrap">
                {SCRAPER_SUBSTEPS.map((s, i) => {
                  const isCurrent = scrapingRunning && scrapingCurrentStep === s.key;
                  const currentIdx = SCRAPER_SUBSTEPS.findIndex(x => x.key === scrapingCurrentStep);
                  const failedIdx = failedScraperUiStep ? SCRAPER_SUBSTEPS.findIndex(x => x.key === failedScraperUiStep) : -1;
                  const isError = !scrapingRunning && failedScraperUiStep === s.key;
                  const isPending = scrapingRunning ? currentIdx < i : failedIdx >= 0 ? i > failedIdx : false;
                  const isDone = !isCurrent && !isError && !isPending;
                  const colors = isError
                    ? 'bg-red-50 border-red-300 text-red-700 shadow-sm'
                    : isCurrent
                    ? 'bg-primary border-primary-foreground/20 text-primary-foreground shadow-lg scale-105'
                    : isPending
                    ? 'bg-muted/30 border-border text-muted-foreground'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-sm';
                  const connectorDone = scrapingRunning
                    ? currentIdx >= i
                    : failedIdx >= 0
                    ? i <= failedIdx
                    : isDone;
                  let timeText = '';
                  const doneTime = stepTimes[s.key];
                  if (doneTime != null) {
                    timeText = doneTime + 's';
                  } else if (isCurrent && stepStartMsRef.current[s.key]) {
                    timeText = (Math.round((Date.now() - stepStartMsRef.current[s.key]) / 100) / 10) + 's';
                  }
                  return (
                    <Fragment key={s.key}>
                      {i > 0 && <div className={`h-0.5 w-6 rounded ${connectorDone ? 'bg-emerald-300' : 'bg-border'}`} />}
                      <div className={`rounded-xl border-2 px-3 py-2 text-center min-w-[110px] transition-all duration-300 ${colors}`}>
                        <div className="text-xs font-bold tracking-wide">{s.label}</div>
                        {timeText && <div className="text-[11px] font-mono opacity-80 mt-0.5">{timeText}</div>}
                      </div>
                    </Fragment>
                  );
                })}
              </div>

              {!scrapingRunning && scrapingExtractedCount > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  {scrapingExtractedCount} órdenes listas para convertir
                  {scrapingErrorCount > 0 ? ` · ${scrapingErrorCount} con error` : ''}
                </div>
              )}

              {!scrapingRunning && scrapingExtractedCount === 0 && primaryScrapingIssue && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {failedScraperStepLabel && (
                    <div className="mb-1 flex items-center gap-2 font-semibold">
                      <XCircle className="h-4 w-4" />
                      Falló en: {failedScraperStepLabel}
                    </div>
                  )}
                  <div>{primaryScrapingIssue}</div>
                  {(primaryScrapingScreenshot || primaryScrapingHtml) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {primaryScrapingScreenshot && (
                        <button
                          onClick={() => openImageViewer(primaryScrapingScreenshot)}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver captura
                        </button>
                      )}
                      {primaryScrapingHtml && (
                        <button
                          onClick={() => openHtmlViewer(primaryScrapingHtml)}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Ver HTML
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!scrapingRunning && scrapingExtractedCount === 0 && !primaryScrapingIssue && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  No se encontraron órdenes sin documento para extraer en este periodo.
                </div>
              )}

              <div className="rounded-lg border border-border bg-background p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Actividad</p>
                <div className="max-h-56 overflow-auto">
                  {cleanedScrapingLog.length === 0 && !scrapingRunning ? (
                    <p className="text-sm text-muted-foreground">Sin actividad registrada aún.</p>
                  ) : (
                    cleanedScrapingLog.map((entry, index) => (
                      <div key={index} className={`py-0.5 text-sm ${entry.isError ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>{entry.text}</div>
                    ))
                  )}
                  {scrapingRunning && (
                    <div className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Procesando...
                    </div>
                  )}
                </div>
              </div>

              {scrapingElapsed && (
                <div className="text-xs text-muted-foreground">
                  Tiempo total: {scrapingElapsed}s · Revisadas: {scrapingState?.totalReviewed ?? 0} · Pendientes: {scrapingState?.pendingOrderCount ?? 0}
                </div>
              )}

              {!scrapingRunning && sourceOrdersData.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="border-b border-border px-4 py-2 bg-muted/20 text-sm font-medium">
                    {sourceOrdersData.length} ventas sin documento
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/10">
                      <tr className="text-left">
                        <th className="p-2 font-medium text-muted-foreground">#</th>
                        <th className="p-2 font-medium text-muted-foreground">Orden</th>
                        <th className="p-2 font-medium text-muted-foreground">Tipo</th>
                        <th className="p-2 font-medium text-muted-foreground">Cliente</th>
                        <th className="p-2 font-medium text-muted-foreground">Documento</th>
                        <th className="p-2 font-medium text-muted-foreground">Fecha</th>
                        <th className="p-2 font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedSourceOrders.map((v: any, i: number) => {
                        const absoluteIndex = (sourcePage - 1) * SOURCE_PAGE_SIZE + i;
                        const isExpanded = expandedOrder === absoluteIndex;
                        const total = Number(v.total || 0);
                        const { invoiceType, invoiceTag, badgeClass } = getFalabellaInvoiceTypeBadge(v);
                        return (
                          <Fragment key={absoluteIndex}>
                            <tr
                              className="border-t border-border/50 cursor-pointer hover:bg-accent/50"
                              onClick={() => setExpandedOrder(isExpanded ? null : absoluteIndex)}
                            >
                              <td className="p-2">
                                <span className="inline-flex items-center gap-1">
                                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  {absoluteIndex + 1}
                                </span>
                              </td>
                              <td className="p-2 font-mono text-xs">{v.orderNumber || '-'}</td>
                              <td className="p-2">
                                <span
                                  title={invoiceType}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}
                                >
                                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-current/15 text-[10px] font-bold">
                                    {invoiceTag}
                                  </span>
                                  {invoiceType}
                                </span>
                              </td>
                              <td className="p-2">{v.clientName || v.client?.razonSocial || ''}</td>
                              <td className="p-2">
                                {v.clientDocNumber
                                  ? `${String(v.clientDocNumber).replace(/\D/g, '').length === 11 ? '6' : '1'}-${v.clientDocNumber}`
                                  : `${v.client?.tipoDocumento || ''}-${v.client?.numeroDocumento || ''}`}
                              </td>
                              <td className="p-2">{v.purchaseDate ? String(v.purchaseDate).slice(0, 10) : (v.fechaEmision || '')}</td>
                              <td className="p-2">S/ {total.toFixed(2)}</td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-muted/10">
                                <td colSpan={7} className="p-3">
                                  <div className="rounded-lg border border-border bg-background p-3">
                                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                                      {v.items?.length || 0} producto{(v.items?.length || 0) !== 1 ? 's' : ''}
                                    </p>
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-left text-muted-foreground">
                                          <th className="p-1 font-medium">SKU</th>
                                          <th className="p-1 font-medium">Descripción</th>
                                          <th className="p-1 font-medium">Cant</th>
                                          <th className="p-1 font-medium">P. Unit</th>
                                          <th className="p-1 font-medium">Subtotal</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(v.items || []).map((d: any, di: number) => (
                                          <tr key={di} className="border-t border-border/30">
                                            <td className="p-1 font-mono">{d.sku || '-'}</td>
                                            <td className="p-1">{d.name || '-'}</td>
                                            <td className="p-1">{d.quantity || 1}</td>
                                            <td className="p-1">S/ {Number(d.unitPrice || 0).toFixed(2)}</td>
                                            <td className="p-1">S/ {(Number(d.unitPrice || 0) * Number(d.quantity || 1)).toFixed(2)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  {sourceOrdersData.length > SOURCE_PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
                      <span>
                        Mostrando {(sourcePage - 1) * SOURCE_PAGE_SIZE + 1} a {Math.min(sourcePage * SOURCE_PAGE_SIZE, sourceOrdersData.length)} de {sourceOrdersData.length}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSourcePage((page) => Math.max(1, page - 1))}
                          disabled={sourcePage === 1}
                          className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
                        >
                          Anterior
                        </button>
                        <button
                          onClick={() => setSourcePage((page) => Math.min(sourceTotalPages, page + 1))}
                          disabled={sourcePage === sourceTotalPages}
                          className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ PASO 2: CONVERTIR ═══ */}
      {phase === 'convertir' && (
        <div className="w-full space-y-4">
          {!convertRunning && ventasData.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Paso 2: Preparar para SUNAT</h2>
                </div>
                <button
                  onClick={runConvertir}
                  disabled={!canConvertExtractedOrders}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowLeftRight className="h-4 w-4" /> Convertir para SUNAT
                </button>
              </div>
              {!canConvertExtractedOrders && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No hay boletas nuevas para convertir. Revisa el resumen del Paso 1.
                </div>
              )}
              <div className="rounded-lg border border-border bg-background p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Boletas nuevas para emitir:</span>
                  <span className="font-medium">{scrapingState?.exportedCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mapeo:</span>
                  <span>Falabella → formato SUNAT</span>
                </div>
                <div className="mt-2 pt-2 border-t border-border text-xs text-muted-foreground space-y-1">
                  <p>• DNI → tipoDocumento "1", RUC → "6", CE → "4"</p>
                  <p>• IGV: 18% (gravado), unidad: NIU, moneda: PEN</p>
                  <p>• SKU → código, nombre → descripción, precio → mtoValorUnitario</p>
                  <p>• FACTURA y boletas ya registradas se bloquean desde el Paso 1</p>
                </div>
              </div>

              {sourceOrdersData.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="border-b border-border px-4 py-2 bg-muted/20 text-sm font-medium flex items-center justify-between gap-3">
                    <span>Lista fuente Falabella ({sourceOrdersData.length} órdenes)</span>
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">B</span>
                        {sourceInvoiceSummary.BOLETA || 0}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-600 text-[10px] font-bold text-white">F</span>
                        {sourceInvoiceSummary.FACTURA || 0}
                      </span>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/10">
                      <tr className="text-left">
                        <th className="p-2 font-medium text-muted-foreground">#</th>
                        <th className="p-2 font-medium text-muted-foreground">Orden</th>
                        <th className="p-2 font-medium text-muted-foreground">Tipo Falabella</th>
                        <th className="p-2 font-medium text-muted-foreground">Cliente</th>
                        <th className="p-2 font-medium text-muted-foreground">Documento</th>
                        <th className="p-2 font-medium text-muted-foreground">Fecha</th>
                        <th className="p-2 font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceOrdersData.slice(0, 20).map((order: any, index: number) => {
                        const { invoiceType, invoiceTag, badgeClass } = getFalabellaInvoiceTypeBadge(order);
                        return (
                          <tr key={`${order.orderNumber || 'row'}-${index}`} className="border-t border-border/50">
                            <td className="p-2">{index + 1}</td>
                            <td className="p-2 font-mono text-xs">{order.orderNumber || '-'}</td>
                            <td className="p-2">
                              <span
                                title={invoiceType}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}
                              >
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-current/15 text-[10px] font-bold">
                                  {invoiceTag}
                                </span>
                                {invoiceType}
                              </span>
                            </td>
                            <td className="p-2">{order.clientName || '-'}</td>
                            <td className="p-2">{order.clientDocNumber || '-'}</td>
                            <td className="p-2">{order.purchaseDate ? String(order.purchaseDate).slice(0, 10) : '-'}</td>
                            <td className="p-2">S/ {Number(order.total || 0).toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sourceOrdersData.length > 20 && (
                    <div className="px-4 py-2 text-xs text-muted-foreground">
                      Mostrando 20 de {sourceOrdersData.length}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {convertRunning && (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold">Preparando ventas para SUNAT</h2>
              <div className="max-h-40 overflow-auto rounded-lg border border-border bg-background p-3">
                {convertLog.map((e, i) => (
                  <div key={i} className={`py-0.5 text-sm ${e.includes('✅') ? 'text-emerald-700' : 'text-muted-foreground'}`}>{e}</div>
                ))}
              </div>
            </div>
          )}

          {!convertRunning && ventasData.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
                <div className="flex-1 text-sm flex items-center justify-between">
                  <p className="font-medium text-emerald-800">{(ventasData || []).length} ventas listas para SUNAT</p>
                  <div className="flex gap-2">
                    <button onClick={() => { setPhase('scraping'); setConvertRunning(false); }}
                      className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium hover:bg-white">Volver</button>
                    <button onClick={proceedToEmit} disabled={ventasErrors.length > 0}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                      Continuar <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              {omittedFacturaOrders.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-medium">{omittedFacturaOrders.length} órdenes FACTURA omitidas de la conversión</p>
                  <p className="mt-1 text-xs text-amber-800">
                    {omittedFacturaOrders.map((order: any) => order.orderNumber).join(', ')}
                  </p>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="border-b border-border px-4 py-2 bg-muted/35 flex items-center justify-between">
                  <span className="text-sm font-medium">Vista previa ({ventasData.length} ventas)</span>
                  <span className="text-xs text-muted-foreground">
                    Página {convertPage} de {convertTotalPages}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/20">
                    <tr className="text-left">
                      <th className="p-2 font-medium text-muted-foreground w-8"></th>
                      <th className="p-2 font-medium text-muted-foreground">#</th>
                      <th className="p-2 font-medium text-muted-foreground">Tipo</th>
                      <th className="p-2 font-medium text-muted-foreground">Cliente</th>
                      <th className="p-2 font-medium text-muted-foreground">Documento</th>
                      <th className="p-2 font-medium text-muted-foreground">Fecha</th>
                      <th className="p-2 font-medium text-muted-foreground">Items</th>
                      <th className="p-2 font-medium text-muted-foreground">Total</th>
                      <th className="p-2 font-medium text-muted-foreground text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedVentas.map((e: any, i: number) => {
                      if (!e) return null;
                      const absoluteIndex = (convertPage - 1) * CONVERT_PAGE_SIZE + i;
                      const isExpandedConvert = expandedConvert === absoluteIndex;
                      const { invoiceType, invoiceTag, badgeClass } = getFalabellaInvoiceTypeBadge(e);
                      return (
                        <Fragment key={absoluteIndex}>
                          <tr
                            className="border-t border-border/50 cursor-pointer hover:bg-accent/50"
                            onClick={() => setExpandedConvert(isExpandedConvert ? null : absoluteIndex)}
                          >
                            <td className="p-2">{isExpandedConvert ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</td>
                            <td className="p-2">{absoluteIndex + 1}</td>
                            <td className="p-2">
                              <span
                                title={invoiceType}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}
                              >
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-current/15 text-[10px] font-bold">
                                  {invoiceTag}
                                </span>
                                {invoiceType}
                              </span>
                            </td>
                            <td className="p-2">{e.client?.razonSocial || ''}</td>
                            <td className="p-2">{e.client?.numeroDocumento || ''}</td>
                            <td className="p-2">{e.fechaEmision || ''}</td>
                            <td className="p-2">{e.detalles?.length || 0}</td>
                            <td className="p-2">S/ {(e.total || 0).toFixed(2)}</td>
                            <td className="p-2 text-right">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openPdfPreview(e, absoluteIndex);
                                }}
                                disabled={previewLoadingIndex === absoluteIndex}
                                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {previewLoadingIndex === absoluteIndex ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Eye className="h-3 w-3" />
                                )}
                                Ver PDF
                              </button>
                            </td>
                          </tr>
                          {isExpandedConvert && (
                            <tr className="bg-muted/10">
                              <td colSpan={9} className="p-3">
                                <div className="rounded-lg border border-border bg-background p-3">
                                  <div className="mb-2 flex items-center justify-between">
                                    <p className="text-xs font-medium text-muted-foreground">JSON SUNAT</p>
                                    <div className="flex items-center gap-3">
                                      <button
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openPdfPreview(e, absoluteIndex);
                                        }}
                                        disabled={previewLoadingIndex === absoluteIndex}
                                        className="text-xs text-primary hover:underline disabled:no-underline disabled:opacity-60"
                                      >
                                        {previewLoadingIndex === absoluteIndex ? 'Generando vista previa...' : 'Ver PDF'}
                                      </button>
                                      <button
                                        onClick={(ev) => { ev.stopPropagation(); navigator.clipboard.writeText(JSON.stringify(e, null, 2)); }}
                                        className="text-xs text-primary hover:underline"
                                      >
                                        Copiar JSON
                                      </button>
                                    </div>
                                  </div>
                                  <pre className="max-h-60 overflow-auto rounded bg-muted/20 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                                    {JSON.stringify({ serie: e.serie, fechaEmision: e.fechaEmision, moneda: e.moneda, client: e.client, detalles: e.detalles }, null, 2)}
                                  </pre>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {ventasData.length > CONVERT_PAGE_SIZE && (
                  <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                    <span>
                      Mostrando {(convertPage - 1) * CONVERT_PAGE_SIZE + 1}
                      {' '}a {Math.min(convertPage * CONVERT_PAGE_SIZE, ventasData.length)} de {ventasData.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setConvertPage((page) => Math.max(1, page - 1))}
                        disabled={convertPage === 1}
                        className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Anterior
                      </button>
                      <button
                        onClick={() => setConvertPage((page) => Math.min(convertTotalPages, page + 1))}
                        disabled={convertPage === convertTotalPages}
                        className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {ventasErrors.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {ventasErrors.map((e, i) => <p key={i}>• {e}</p>)}
                </div>
              )}
            </div>
          )}

          {!convertRunning && convertError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{convertError}</div>
          )}
        </div>
      )}

      {/* ═══ PASO 3: EMITIR ═══ */}
      {phase === 'emitir' && (
        <div className="w-full space-y-4">
          {!processing && !workflowError && (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Paso 3: Emitir Boletas a SUNAT</h2>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setPhase('convertir')} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent">Volver</button>
                  <button onClick={startEmitir}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                    <Play className="h-4 w-4" /> Emitir Boletas
                  </button>
                </div>
              </div>

              <details className="rounded-lg border border-border bg-background p-3">
                <summary className="text-sm font-medium cursor-pointer">Vista previa JSON ({ventasData.length} boletas)</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted/20 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(ventasData.slice(0, 3).map((v: any) => ({ orderNumber: v.orderNumber, serie: v.serie, fechaEmision: v.fechaEmision, moneda: v.moneda, client: v.client, detalles: v.detalles })), null, 2)}
                  {ventasData.length > 3 ? `\n... y ${ventasData.length - 3} más` : ''}
                </pre>
              </details>

              <div className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
                Se emitirán {ventasData.length} boletas.
              </div>
            </div>
          )}

          {(processing || workflowError) && (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Paso 3: Emitir Boletas</h2>
                <div className="flex gap-2">
                  {!processing && (
                    <>
                      <button onClick={() => { setPhase('convertir'); setWorkflowError(''); }}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent">Volver</button>
                      <button onClick={() => { setWorkflowError(''); startEmitir(); }}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                        <Play className="h-4 w-4" /> Intentar de nuevo
                      </button>
                    </>
                  )}
                </div>
              </div>

              {processing && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{progress.status}</span>
                    <span className="font-medium">{progress.current} / {progress.total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }} />
                  </div>
                </>
              )}

              {workflowError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{workflowError}</div>
              )}

              <div className="h-[220px] w-full">
                <ReactFlow
                  nodes={currentBoletaSteps.map((step, i) => ({
                    id: `step-${i}`, type: 'flowStep',
                    position: { x: i * 240, y: 45 }, draggable: false, selectable: false,
                    data: {
                      label: `${step.label}${formatDuration(
                        step.status === 'current' && emitStepStartRef.current[step.key]
                          ? Date.now() - emitStepStartRef.current[step.key]
                          : step.elapsedMs,
                      ) ? `\n${formatDuration(
                        step.status === 'current' && emitStepStartRef.current[step.key]
                          ? Date.now() - emitStepStartRef.current[step.key]
                          : step.elapsedMs,
                      )}` : ''}`,
                      index: i + 1,
                      status: step.status,
                      clickable: false,
                      onSelect: () => {},
                    },
                  }))}
                  edges={currentBoletaSteps.slice(0, -1).map((_, i) => ({
                    id: `edge-${i}`, source: `step-${i}`, target: `step-${i + 1}`, type: 'bezier',
                    animated: currentBoletaSteps[i].status === 'current',
                    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
                    style: { strokeWidth: 2, stroke: currentBoletaSteps[i].status === 'done' ? '#059669' : '#94a3b8' },
                  }))}
                  nodeTypes={flowNodeTypes} fitView fitViewOptions={{ padding: 0.3 }}
                  nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
                  panOnDrag={false} panOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} zoomOnScroll={false}
                  preventScrolling attributionPosition="bottom-right" proOptions={{ hideAttribution: true }}
                >
                  <Background gap={18} size={1} className="opacity-15" />
                </ReactFlow>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ RESULTADOS ═══ */}
      {phase === 'resultados' && (
        <div className="w-full space-y-4">
          {workflowError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{workflowError}</div>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
                <CheckCircle className="h-6 w-6 text-emerald-600" />
                <div>
                  <h2 className="font-semibold">
                    {results.filter(r => r.estadoSunat === 'ACEPTADO').length} aceptadas ·{' '}
                    {results.filter(r => r.estadoSunat === 'RECHAZADO').length} rechazadas
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {results.length} boletas procesadas{companyLabel ? ` · Empresa: ${companyLabel}` : ''}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {groupedResults.map((group) => (
                  <div key={group.key} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                    <div className="grid gap-4 border-b border-border bg-muted/20 p-4 md:grid-cols-[1.3fr_1.1fr_1.1fr_.8fr_2fr]">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Empresa</p>
                        <p className="text-sm">{companyLabel || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Resumen</p>
                        <p className="font-mono text-base">{group.summaryNumero}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Ticket</p>
                        <p className="font-mono text-base">{group.ticket}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Estado</p>
                        <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          group.estado === 'ACEPTADO' ? 'bg-emerald-100 text-emerald-700' : group.estado === 'EN_PROCESO' || group.estado === 'ENVIADO' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {group.estado === 'ACEPTADO' ? <CheckCircle className="h-3 w-3" /> : group.estado === 'EN_PROCESO' || group.estado === 'ENVIADO' ? <Loader2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {group.estado}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Respuesta SUNAT</p>
                        <p className={`mt-1 text-sm ${group.estado === 'ACEPTADO' ? 'text-emerald-700' : 'text-red-700'}`}>
                          {group.response || 'Sin respuesta registrada'}
                        </p>
                      </div>
                    </div>

                    <table className="w-full text-sm">
                      <thead className="bg-muted/35">
                        <tr className="text-left">
                          <th className="p-3 font-medium text-muted-foreground">Boleta</th>
                          <th className="p-3 font-medium text-muted-foreground">Orden</th>
                          <th className="p-3 font-medium text-muted-foreground">Estado</th>
                          <th className="p-3 font-medium text-muted-foreground">Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.boletas.map((r, i) => (
                          <tr key={`${group.key}-${r.numeroCompleto}-${i}`} className="border-t border-border/70">
                            <td className="p-3 font-mono">{r.numeroCompleto}</td>
                            <td className="p-3 font-mono">{r.orderNumber || '-'}</td>
                            <td className="p-3">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                r.estadoSunat === 'ACEPTADO' ? 'bg-emerald-100 text-emerald-700' : r.estadoSunat === 'EN_PROCESO' || r.estadoSunat === 'ENVIADO' || r.estadoSunat === 'OMITIDO' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                              }`}>
                                {r.estadoSunat === 'ACEPTADO' ? <CheckCircle className="h-3 w-3" /> : r.estadoSunat === 'EN_PROCESO' || r.estadoSunat === 'ENVIADO' || r.estadoSunat === 'OMITIDO' ? <Loader2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                {r.estadoSunat}
                              </span>
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">{r.error || r.summaryResponse || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button onClick={async () => {
                  await api.scraperCleanup();
                  setPhase('preflight');
                  setRawOrdersData([]);
                  setPendingVentasData([]);
                  setVentasData([]);
                  setOmittedFacturaOrders([]);
                }}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  Nueva emisión
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
