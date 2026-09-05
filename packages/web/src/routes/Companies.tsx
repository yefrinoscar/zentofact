import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, Building2, Upload, AlertCircle, Loader2, Eye, EyeOff,
  MoreHorizontal, Search, Link2, Unlink, ArrowLeft,
} from 'lucide-react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import api from '../lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TablePanelFooter, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import falabellaLogo from '../assets/falabella.png';
import mercadoLibreLogo from '../assets/mercado-libre.png';
import ripleyLogo from '../assets/ripley.svg';

type ChannelTab = 'falabella' | 'ripley' | 'mercado_libre';

const CHANNEL_MARK: Record<ChannelTab, { src: string; label: string }> = {
  falabella: { src: falabellaLogo, label: 'Falabella' },
  ripley: { src: ripleyLogo, label: 'Ripley' },
  mercado_libre: { src: mercadoLibreLogo, label: 'Mercado Libre' },
};

function ChannelMark({ channel, className }: { channel: ChannelTab; className?: string }) {
  const mark = CHANNEL_MARK[channel];
  return (
    <img
      src={mark.src}
      alt=""
      title={mark.label}
      className={cn('size-4 overflow-hidden rounded-[3px] object-cover', className)}
    />
  );
}

function FormSection({
  id,
  title,
  channel,
  children,
}: {
  id?: string;
  title: string;
  channel?: ChannelTab;
  children: ReactNode;
}) {
  return (
    <section id={id} className="space-y-4 border-t border-border pt-8 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        {channel ? <ChannelMark channel={channel} /> : null}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      </div>
      {children}
    </section>
  );
}

function EmissionRow({
  checked,
  disabled,
  onCheckedChange,
  hint,
  label = 'Emitir automáticamente',
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  hint?: string;
  label?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

type CompanyForm = {
  nombre: string;
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  ubigeo: string;
  usuarioSol: string;
  claveSol: string;
  sellerUsername: string;
  sellerPassword: string;
  falabellaApiUserId: string;
  falabellaApiKey: string;
  ripleyApiKey: string;
  ripleyShopId: string;
  ripleySvcUsername: string;
  ripleySvcPassword: string;
  ripleySvcBaseUrl: string;
};

type CompanyRow = {
  id: number;
  nombre?: string | null;
  ruc?: string | null;
  razonSocial?: string | null;
  nombreComercial?: string | null;
  direccion?: string | null;
  ubigeo?: string | null;
  usuarioSol?: string | null;
  sellerUsername?: string | null;
  falabellaApiUserId?: string | null;
  ripleyShopId?: string | null;
  ripleySvcUsername?: string | null;
  ripleySvcBaseUrl?: string | null;
  mercadoLibreUserId?: string | null;
  mercadoLibreSiteId?: string | null;

  activo?: boolean | null;
  hasSolCredentials?: boolean;
  hasCertificate?: boolean;
  hasSellerPassword?: boolean;
  hasFalabellaCredentials?: boolean;
  hasRipleyCredentials?: boolean;
  hasRipleySvcCredentials?: boolean;
  hasMercadoLibreCredentials?: boolean;
};

type ChannelAutoEmission = { falabella: boolean; ripley: boolean; mercado_libre: boolean };
type ChannelAutoCreateOrders = { falabella: boolean; ripley: boolean; mercado_libre: boolean };
type ChannelAccount = {
  channelCode?: string;
  autoCreateOrders?: boolean;
  documentRequirement?: string;
  settings?: { autoEmitDocuments?: boolean };
};

const initialAutoEmission: ChannelAutoEmission = { falabella: false, ripley: false, mercado_libre: false };
const initialAutoCreateOrders: ChannelAutoCreateOrders = { falabella: true, ripley: true, mercado_libre: true };

const initialForm: CompanyForm = {
  nombre: '',
  ruc: '',
  razonSocial: '',
  nombreComercial: '',
  direccion: '',
  ubigeo: '',
  usuarioSol: '',
  claveSol: '',
  sellerUsername: '',
  sellerPassword: '',
  falabellaApiUserId: '',
  falabellaApiKey: '',
  ripleyApiKey: '',
  ripleyShopId: '',
  ripleySvcUsername: '',
  ripleySvcPassword: '',
  ripleySvcBaseUrl: '',
};

function hasFalabellaApi(c: CompanyRow) {
  return !!c.hasFalabellaCredentials;
}

function hasCertificate(c: CompanyRow) {
  return !!c.hasCertificate;
}

function hasSol(c: CompanyRow) {
  return !!c.hasSolCredentials;
}

/** Estado operativo sin exponer credenciales. */
function setupReady(c: CompanyRow) {
  return hasFalabellaApi(c) && hasCertificate(c) && hasSol(c);
}

function companyShortName(c: CompanyRow) {
  return (c.nombreComercial || c.nombre || c.razonSocial || 'Sin nombre').trim();
}

function setupGap(c: CompanyRow) {
  const missing: string[] = [];
  if (!hasFalabellaApi(c)) missing.push('Falabella');
  if (!hasCertificate(c)) missing.push('certificado');
  if (!hasSol(c)) missing.push('SOL');
  return missing.join(', ');
}

function ChannelReady({
  channel,
  ready,
  title,
}: {
  channel: ChannelTab;
  ready: boolean;
  title: string;
}) {
  return (
    <img
      src={CHANNEL_MARK[channel].src}
      alt={CHANNEL_MARK[channel].label}
      title={title}
      className={cn('size-4 overflow-hidden rounded-[3px] object-cover', ready ? 'opacity-100' : 'opacity-25')}
    />
  );
}

function isChannelAccount(value: unknown): value is ChannelAccount {
  if (!value || typeof value !== 'object') return false;
  const channelCode = Reflect.get(value, 'channelCode');
  const autoCreateOrders = Reflect.get(value, 'autoCreateOrders');
  const documentRequirement = Reflect.get(value, 'documentRequirement');
  const settings = Reflect.get(value, 'settings');
  const autoEmitDocuments = settings && typeof settings === 'object'
    ? Reflect.get(settings, 'autoEmitDocuments')
    : undefined;
  return (channelCode === undefined || typeof channelCode === 'string')
    && (autoCreateOrders === undefined || typeof autoCreateOrders === 'boolean')
    && (documentRequirement === undefined || typeof documentRequirement === 'string')
    && (autoEmitDocuments === undefined || typeof autoEmitDocuments === 'boolean');
}

function billingInput(
  companyId: number,
  channelCode: 'falabella' | 'ripley' | 'mercado_libre',
  autoCreateOrders: boolean,
  autoEmitDocuments: boolean,
  externalAccountId = 'default',
): {
  companyId: number;
  channelCode: 'falabella' | 'ripley' | 'mercado_libre';
  externalAccountId: string;
  displayName: string;
  autoCreateOrders: boolean;
  documentRequirement: 'disabled' | 'required';
  documentTypePolicy: 'automatic';
  settings: { autoEmitDocuments: boolean };
  active: boolean;
} {
  return {
    companyId,
    channelCode,
    externalAccountId,
    displayName: channelCode === 'falabella' ? 'Falabella' : channelCode === 'ripley' ? 'Ripley' : 'Mercado Libre',
    autoCreateOrders,
    documentRequirement: autoEmitDocuments ? 'required' : 'disabled',
    documentTypePolicy: 'automatic',
    settings: { autoEmitDocuments },
    active: true,
  };
}

export default function Companies() {
  const navigate = useNavigate();
  const location = useLocation();
  const { companyId: companyIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const isNew = location.pathname === '/companies/nueva';
  const companyId = Number(companyIdParam);
  const isEditor = isNew || Boolean(companyIdParam);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [editorLoading, setEditorLoading] = useState(Boolean(companyIdParam));
  const [form, setForm] = useState<CompanyForm>(initialForm);
  const formRef = useRef<HTMLFormElement | null>(null);
  const certInputRef = useRef<HTMLInputElement | null>(null);
  const [hasStoredCert, setHasStoredCert] = useState(false);
  const [certFileName, setCertFileName] = useState('');
  const [certBase64, setCertBase64] = useState('');
  const [certPass, setCertPass] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'nombre', desc: false }]);
  const [showClaveSol, setShowClaveSol] = useState(false);
  const [showSellerPassword, setShowSellerPassword] = useState(false);
  const [showFalabellaApiKey, setShowFalabellaApiKey] = useState(false);
  const [showRipleyApiKey, setShowRipleyApiKey] = useState(false);
  const [showRipleySvcPassword, setShowRipleySvcPassword] = useState(false);
  const [showCertPassword, setShowCertPassword] = useState(false);
  const [channelAutoEmission, setChannelAutoEmission] = useState<ChannelAutoEmission>(initialAutoEmission);
  const [channelAutoCreateOrders, setChannelAutoCreateOrders] = useState<ChannelAutoCreateOrders>(initialAutoCreateOrders);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [initialFalabellaAutoEmission, setInitialFalabellaAutoEmission] = useState(false);
  const [search, setSearch] = useState('');
  const [setupFilter, setSetupFilter] = useState('all');
  const [mercadoLibreAppConfigured, setMercadoLibreAppConfigured] = useState(false);
  const [mercadoLibreSandbox, setMercadoLibreSandbox] = useState(false);
  const [disconnectingMercadoLibre, setDisconnectingMercadoLibre] = useState(false);
  const [oauthNotice, setOauthNotice] = useState('');
  const [channelTab, setChannelTab] = useState<ChannelTab>(() => {
    const ml = new URLSearchParams(window.location.hash.split('?')[1] || '').get('ml');
    return ml === 'connected' || ml === 'error' ? 'mercado_libre' : 'falabella';
  });

  const load = () => {
    setLoadingCompanies(true);
    return api.listCompanies()
      .then((list: any[]) => {
        setCompanies(Array.isArray(list) ? list : []);
        setLoadError('');
      })
      .catch((e: any) => {
        setCompanies([]);
        setLoadError(e?.message || 'No se pudieron cargar las empresas.');
      })
      .finally(() => setLoadingCompanies(false));
  };

  useEffect(() => {
    load();
    api.getMercadoLibreIntegrationStatus()
      .then((status: { configured?: boolean; sandbox?: boolean }) => {
        setMercadoLibreAppConfigured(status?.configured === true);
        setMercadoLibreSandbox(status?.sandbox === true);
      })
      .catch(() => {
        setMercadoLibreAppConfigured(false);
        setMercadoLibreSandbox(false);
      });
    const ml = searchParams.get('ml');
    if (ml === 'connected') {
      setOauthNotice('Mercado Libre quedó conectado para esta empresa.');
      setChannelTab('mercado_libre');
    }
    if (ml === 'error') {
      setOauthNotice(searchParams.get('message') || 'No se pudo conectar Mercado Libre.');
      setChannelTab('mercado_libre');
    }
  }, []);

  const resetForm = () => {
    setForm(initialForm);
    setHasStoredCert(false);
    setCertFileName('');
    setCertBase64('');
    setCertPass('');
    setError('');
    setShowClaveSol(false);
    setShowSellerPassword(false);
    setShowFalabellaApiKey(false);
    setShowRipleyApiKey(false);
    setShowRipleySvcPassword(false);
    setShowCertPassword(false);
    setChannelAutoEmission(initialAutoEmission);
    setChannelAutoCreateOrders(initialAutoCreateOrders);
    setLoadingBilling(false);
    setInitialFalabellaAutoEmission(false);
    setChannelTab('falabella');
    if (certInputRef.current) certInputRef.current.value = '';
  };

  const onCertFileChange = async (file: File | null) => {
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);
      setCertBase64(base64);
      setCertFileName(file.name);
      setError('');
    } catch (e: any) {
      setCertBase64('');
      setCertFileName('');
      setError(e?.message || 'No se pudo leer el certificado.');
    }
  };

  const closeEditor = () => {
    setEditing(null);
    resetForm();
    setSaving(false);
    navigate('/companies');
  };

  const readFormSnapshot = (): CompanyForm => {
    if (!formRef.current) return form;

    const formData = new FormData(formRef.current);
    const snapshot = { ...form };
    for (const key of Object.keys(initialForm) as Array<keyof CompanyForm>) {
      const value = formData.get(key);
      if (typeof value === 'string') snapshot[key] = value;
    }
    return snapshot;
  };

  const validate = (candidate: CompanyForm, isEdit: boolean): string | null => {
    if (!candidate.ruc || candidate.ruc.length !== 11) return 'El RUC debe tener 11 dígitos.';
    if (!candidate.razonSocial.trim()) return 'La razón social es requerida.';
    if (!candidate.usuarioSol.trim()) return 'El usuario SOL es requerido.';
    // Al editar, dejar la clave vacía conserva la almacenada en el servidor.
    if (!isEdit && !candidate.claveSol.trim()) return 'La clave SOL es requerida.';
    if (isEdit && !editing?.hasSolCredentials && !candidate.claveSol.trim()) {
      return 'La clave SOL es requerida.';
    }
    return null;
  };

  const saveBilling = async (companyId: number, hasFalabellaCredentials: boolean) => {
    const enablingFalabellaEmission = channelAutoEmission.falabella;
    if (enablingFalabellaEmission && !hasFalabellaCredentials) {
      throw new Error('Configura las credenciales API de Falabella antes de activar la emisión automática.');
    }
    const jobs = [
      api.configureOrderChannelAccount(billingInput(
        companyId,
        'falabella',
        channelAutoCreateOrders.falabella,
        channelAutoEmission.falabella,
      )),
      api.configureOrderChannelAccount(billingInput(
        companyId,
        'ripley',
        channelAutoCreateOrders.ripley,
        channelAutoEmission.ripley,
      )),
      api.autoEmitSetCompany(companyId, enablingFalabellaEmission),
    ];
    const mercadoLibreUserId = String(editing?.mercadoLibreUserId || '').trim();
    if (mercadoLibreUserId) {
      jobs.push(api.configureOrderChannelAccount(billingInput(
        companyId,
        'mercado_libre',
        channelAutoCreateOrders.mercado_libre,
        channelAutoEmission.mercado_libre,
        mercadoLibreUserId,
      )));
    }
    await Promise.all(jobs);
  };

  const confirmFalabellaEmission = () => {
    const enabling = channelAutoEmission.falabella;
    if (!enabling || initialFalabellaAutoEmission) return true;
    return window.confirm(
      'La emisión automática creará comprobantes reales para los pedidos Falabella listos para enviar. ¿Activarla?',
    );
  };

  const handleCreate = async () => {
    const nextForm = readFormSnapshot();
    setForm(nextForm);

    const validationError = validate(nextForm, false);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!certBase64) {
      setError('Debes seleccionar un certificado digital (.pfx o .p12).');
      return;
    }
    if (!confirmFalabellaEmission()) return;

    setSaving(true);
    setError('');

    try {
      const created = await api.createCompany({
        ...nextForm,
        certificado: certBase64,
        ...(certPass ? { certificadoPassword: certPass } : {}),
      });
      await saveBilling(Number(created.id), Boolean(
        nextForm.falabellaApiUserId.trim() && nextForm.falabellaApiKey.trim(),
      ));
      closeEditor();
      load();
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('UNIQUE') && msg.includes('ruc')) {
        setError('Ya existe una empresa con ese RUC.');
      } else {
        setError(msg || 'Error al crear la empresa.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;

    const nextForm = readFormSnapshot();
    setForm(nextForm);

    const validationError = validate(nextForm, true);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!confirmFalabellaEmission()) return;

    setSaving(true);
    setError('');

    try {
      // Solo enviar secretos cuando el usuario escribe un valor nuevo; vacío = conservar.
      const updateData: Record<string, unknown> = {
        nombre: nextForm.nombre,
        ruc: nextForm.ruc,
        razonSocial: nextForm.razonSocial,
        nombreComercial: nextForm.nombreComercial,
        direccion: nextForm.direccion,
        ubigeo: nextForm.ubigeo,
        usuarioSol: nextForm.usuarioSol,
        sellerUsername: nextForm.sellerUsername,
        falabellaApiUserId: nextForm.falabellaApiUserId,
        ripleyShopId: nextForm.ripleyShopId,
        ripleySvcUsername: nextForm.ripleySvcUsername,
        ripleySvcBaseUrl: nextForm.ripleySvcBaseUrl,
      };
      if (nextForm.claveSol.trim()) updateData.claveSol = nextForm.claveSol;
      if (nextForm.sellerPassword.trim()) updateData.sellerPassword = nextForm.sellerPassword;
      if (nextForm.falabellaApiKey.trim()) updateData.falabellaApiKey = nextForm.falabellaApiKey;
      if (nextForm.ripleyApiKey.trim()) updateData.ripleyApiKey = nextForm.ripleyApiKey;
      if (nextForm.ripleySvcPassword.trim()) updateData.ripleySvcPassword = nextForm.ripleySvcPassword;
      if (certBase64) updateData.certificado = certBase64;
      if (certPass.trim()) updateData.certificadoPassword = certPass;

      await api.updateCompany(editing.id, updateData);
      await saveBilling(editing.id, Boolean(
        nextForm.falabellaApiUserId.trim() && (nextForm.falabellaApiKey.trim() || editing.hasFalabellaCredentials),
      ));
      closeEditor();
      load();
    } catch (e: any) {
      setError(e?.message || 'Error al actualizar la empresa.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Desactivar esta empresa?')) return;
    await api.deleteCompany(id);
    load();
  };

  const filteredCompanies = useMemo(() => {
    const query = search.trim().toLowerCase();
    return companies.filter((company) => {
      const matchesSearch = !query || [
        company.ruc,
        company.nombre,
        company.razonSocial,
        company.nombreComercial,
      ].some((value) => String(value || '').toLowerCase().includes(query));
      const ready = setupReady(company);
      const matchesSetup = setupFilter === 'all'
        || (setupFilter === 'ready' && ready)
        || (setupFilter === 'incomplete' && !ready);
      return matchesSearch && matchesSetup;
    });
  }, [companies, search, setupFilter]);

  const columns = useMemo<ColumnDef<CompanyRow>[]>(() => [
    {
      id: 'nombre',
      accessorFn: (c) => companyShortName(c),
      header: 'Empresa',
      cell: ({ row }) => {
        const company = row.original;
        return (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{companyShortName(company)}</p>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">{company.ruc || '—'}</p>
          </div>
        );
      },
    },
    {
      id: 'canales',
      header: 'Canales',
      enableSorting: false,
      cell: ({ row }) => {
        const company = row.original;
        const ripleyReady = Boolean(company.hasRipleyCredentials || company.hasRipleySvcCredentials);
        return (
          <div className="flex items-center gap-2">
            <ChannelReady
              channel="falabella"
              ready={hasFalabellaApi(company)}
              title={hasFalabellaApi(company) ? 'Falabella configurado' : 'Falabella pendiente'}
            />
            <ChannelReady
              channel="ripley"
              ready={ripleyReady}
              title={ripleyReady ? 'Ripley configurado' : 'Ripley pendiente'}
            />
            <ChannelReady
              channel="mercado_libre"
              ready={Boolean(company.hasMercadoLibreCredentials)}
              title={company.hasMercadoLibreCredentials
                ? (company.mercadoLibreUserId ? `Mercado Libre · ${company.mercadoLibreUserId}` : 'Mercado Libre conectado')
                : 'Mercado Libre pendiente'}
            />
          </div>
        );
      },
    },
    {
      id: 'estado',
      accessorFn: (company) => setupReady(company) ? 'Lista' : setupGap(company),
      header: 'Estado',
      cell: ({ row }) => {
        const ready = setupReady(row.original);
        return (
          <div className="min-w-0">
            <p className={cn('text-sm', ready ? 'text-foreground' : 'text-muted-foreground')}>
              {ready ? 'Lista' : 'Incompleta'}
            </p>
            {!ready && setupGap(row.original) ? (
              <p className="truncate text-xs text-muted-foreground">Falta {setupGap(row.original)}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'acciones',
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${companyShortName(row.original)}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onClick={() => navigate(`/companies/${row.original.id}`)}>
                <Pencil /> Editar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void handleDelete(row.original.id)}>
                <Trash2 /> Desactivar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ], [navigate]);

  const table = useReactTable({
    data: filteredCompanies,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const startEdit = (company: CompanyRow) => {
    setEditing(company);
    setHasStoredCert(!!company.hasCertificate);
    setCertFileName('');
    setCertBase64('');
    setCertPass('');
    setError('');
    if (certInputRef.current) certInputRef.current.value = '';
    // Secretos nunca vienen del API: campos de contraseña vacíos = conservar al guardar.
    setForm({
      nombre: company.nombre || company.razonSocial || '',
      ruc: company.ruc || '',
      razonSocial: company.razonSocial || '',
      nombreComercial: company.nombreComercial || '',
      direccion: company.direccion || '',
      ubigeo: company.ubigeo || '',
      usuarioSol: company.usuarioSol || '',
      claveSol: '',
      sellerUsername: company.sellerUsername || '',
      sellerPassword: '',
      falabellaApiUserId: company.falabellaApiUserId || '',
      falabellaApiKey: '',
      ripleyApiKey: '',
      ripleyShopId: company.ripleyShopId || '',
      ripleySvcUsername: company.ripleySvcUsername || '',
      ripleySvcPassword: '',
      ripleySvcBaseUrl: company.ripleySvcBaseUrl || '',
    });
    setLoadingBilling(true);
    void Promise.all([
      api.listOrderChannelAccounts({ companyId: company.id }),
      api.autoEmitGetConfig(),
    ]).then(([accounts, autoEmission]) => {
      const channelAccounts = Array.isArray(accounts) ? accounts.filter(isChannelAccount) : [];
      const falabella = channelAccounts.find((account) => account.channelCode === 'falabella');
      const ripley = channelAccounts.find((account) => account.channelCode === 'ripley');
      const mercadoLibre = channelAccounts.find((account) => account.channelCode === 'mercado_libre');
      const configuredCompanies = Array.isArray(autoEmission?.companies) ? autoEmission.companies : [];
      const automatic = configuredCompanies.find((configured: { id?: number; enabled?: boolean }) => configured.id === company.id)?.enabled === true;
      setChannelAutoCreateOrders({
        falabella: falabella?.autoCreateOrders !== false,
        ripley: ripley?.autoCreateOrders !== false,
        mercado_libre: mercadoLibre?.autoCreateOrders !== false,
      });
      setChannelAutoEmission({
        falabella: automatic,
        ripley: ripley?.settings?.autoEmitDocuments === true,
        mercado_libre: mercadoLibre?.settings?.autoEmitDocuments === true,
      });
      setInitialFalabellaAutoEmission(automatic);
    }).catch((caught: unknown) => {
      const message = caught instanceof Error ? caught.message : 'No se pudo cargar la configuración de canales.';
      setError(message);
    }).finally(() => setLoadingBilling(false));
  };

  useEffect(() => {
    if (!isEditor) return;
    if (isNew) {
      setEditing(null);
      resetForm();
      setEditorLoading(false);
      return;
    }
    if (!Number.isInteger(companyId) || companyId < 1) {
      setError('No se encontró la empresa.');
      setEditing(null);
      setEditorLoading(false);
      return;
    }

    let cancelled = false;
    setEditorLoading(true);
    setError('');
    void api.getCompany(companyId)
      .then((company: CompanyRow) => {
        if (cancelled) return;
        startEdit(company);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setEditing(null);
        setError(caught instanceof Error ? caught.message : 'No se encontró la empresa.');
      })
      .finally(() => {
        if (!cancelled) setEditorLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isEditor, isNew, companyId]);

  const field = (
    label: string,
    key: keyof CompanyForm,
    type = 'text',
    placeholder = '',
    options?: { revealable?: boolean; revealed?: boolean; onToggleReveal?: () => void },
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <div className="relative">
        <Input
          id={key}
          name={key}
          type={options?.revealable ? (options.revealed ? 'text' : 'password') : type}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          placeholder={placeholder}
          className={options?.revealable ? 'pr-10' : undefined}
        />
        {options?.revealable && options.onToggleReveal && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute inset-y-0 right-1 my-auto"
            onClick={options.onToggleReveal}
            title={options.revealed ? 'Ocultar' : 'Mostrar'}
          >
            {options.revealed ? <EyeOff /> : <Eye />}
          </Button>
        )}
      </div>
    </div>
  );

  const falabellaCredentialsReady = Boolean(
    form.falabellaApiUserId.trim()
    && (form.falabellaApiKey.trim() || editing?.hasFalabellaCredentials),
  );

  const keepSecret = 'Vacío conserva la actual';
  const falabellaChannelPanel = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('Usuario seller', 'sellerUsername')}
        {field(
          'Contraseña seller',
          'sellerPassword',
          'password',
          editing?.hasSellerPassword ? keepSecret : '',
          {
            revealable: true,
            revealed: showSellerPassword,
            onToggleReveal: () => setShowSellerPassword((value) => !value),
          },
        )}
        {field('User ID', 'falabellaApiUserId')}
        {field(
          'API key',
          'falabellaApiKey',
          'password',
          editing?.hasFalabellaCredentials ? keepSecret : '',
          {
            revealable: true,
            revealed: showFalabellaApiKey,
            onToggleReveal: () => setShowFalabellaApiKey((value) => !value),
          },
        )}
      </div>
      <EmissionRow
        checked={channelAutoEmission.falabella}
        disabled={loadingBilling || !falabellaCredentialsReady}
        onCheckedChange={(checked) => setChannelAutoEmission((current) => ({ ...current, falabella: checked }))}
        hint={falabellaCredentialsReady ? 'Boletas y facturas al dejar el pedido listo.' : 'Configura la API para activarla.'}
      />
    </div>
  );

  const ripleyChannelPanel = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('Shop ID', 'ripleyShopId', 'text', 'Si la key cubre varias tiendas')}
        {field(
          'API key',
          'ripleyApiKey',
          'password',
          editing?.hasRipleyCredentials ? keepSecret : '',
          {
            revealable: true,
            revealed: showRipleyApiKey,
            onToggleReveal: () => setShowRipleyApiKey((value) => !value),
          },
        )}
        {field('Usuario SVC', 'ripleySvcUsername')}
        {field(
          'Contraseña SVC',
          'ripleySvcPassword',
          'password',
          editing?.hasRipleySvcCredentials ? keepSecret : '',
          {
            revealable: true,
            revealed: showRipleySvcPassword,
            onToggleReveal: () => setShowRipleySvcPassword((value) => !value),
          },
        )}
        <div className="sm:col-span-2">
          {field('URL SVC', 'ripleySvcBaseUrl', 'url', 'La de producción, no la de laboratorio')}
        </div>
      </div>
      <EmissionRow
        checked={channelAutoEmission.ripley}
        disabled={loadingBilling}
        onCheckedChange={(checked) => setChannelAutoEmission((current) => ({ ...current, ripley: checked }))}
        hint="Se activa al sincronizar pedidos."
      />
    </div>
  );

  const mercadoLibreChannelPanel = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {editing?.hasMercadoLibreCredentials ? 'Conectado' : 'Sin conectar'}
          </p>
          <p className="text-xs text-muted-foreground">
            {oauthNotice || (editing?.hasMercadoLibreCredentials
              ? `${mercadoLibreSandbox ? 'Sandbox local · ' : ''}user_id ${editing.mercadoLibreUserId || '—'}${editing.mercadoLibreSiteId ? ` · ${editing.mercadoLibreSiteId}` : ''}`
              : !editing
                ? 'Guarda la empresa para conectar la cuenta.'
                : mercadoLibreAppConfigured
                  ? 'Autoriza la cuenta de esta empresa.'
                  : mercadoLibreSandbox
                    ? 'Sandbox local activo. LIMBO se conecta al sembrar el preview.'
                    : 'Falta la app de Mercado Libre en el servidor.')}
          </p>
        </div>
        {editing?.hasMercadoLibreCredentials ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disconnectingMercadoLibre}
            onClick={() => {
              if (!window.confirm('¿Desconectar Mercado Libre de esta empresa? Los pedidos ya importados se conservan.')) return;
              setDisconnectingMercadoLibre(true);
              api.disconnectMercadoLibre(editing.id)
                .then(() => { setOauthNotice('Mercado Libre quedó desconectado.'); return load(); })
                .then(() => {
                  setEditing((current) => current ? {
                    ...current,
                    hasMercadoLibreCredentials: false,
                    mercadoLibreUserId: null,
                    mercadoLibreSiteId: null,
                  } : current);
                })
                .catch((caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : 'No se pudo desconectar Mercado Libre.');
                })
                .finally(() => setDisconnectingMercadoLibre(false));
            }}
          >
            <Unlink /> Desconectar
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!editing || !mercadoLibreAppConfigured}
            onClick={() => {
              if (!editing) return;
              window.location.assign(`/integrations/mercado-libre/${editing.id}/connect`);
            }}
          >
            <Link2 /> Conectar
          </Button>
        )}
      </div>
      <EmissionRow
        checked={channelAutoEmission.mercado_libre}
        disabled={loadingBilling || !editing?.hasMercadoLibreCredentials}
        onCheckedChange={(checked) => setChannelAutoEmission((current) => ({ ...current, mercado_libre: checked }))}
        hint={editing?.hasMercadoLibreCredentials ? undefined : 'Conecta la cuenta para activarla.'}
      />
    </div>
  );

  useEffect(() => {
    if (!isEditor) return;
    const ml = searchParams.get('ml');
    if (ml === 'connected' || ml === 'error') setChannelTab('mercado_libre');
  }, [isEditor, searchParams]);

  if (isEditor) {
    return (
      <div className="mx-auto max-w-3xl space-y-8 pb-6">
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            className="-ml-2 h-9 shrink-0 px-2 text-muted-foreground hover:text-foreground"
            onClick={closeEditor}
          >
            <ArrowLeft /> Empresas
          </Button>
          {!editorLoading && (isNew || editing) ? (
            <Button type="submit" form="company-form" disabled={saving || loadingBilling}>
              {saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear empresa'}
            </Button>
          ) : null}
        </div>

        {editorLoading ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">Cargando empresa</p>
          </div>
        ) : !isNew && !editing ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <p className="text-sm font-medium">No se pudo abrir la empresa</p>
            <p className="text-sm text-muted-foreground">{error || 'No se encontró la empresa.'}</p>
          </div>
        ) : (
            <form
              id="company-form"
              ref={formRef}
              className="space-y-8"
              onSubmit={(event) => {
                event.preventDefault();
                void (editing ? handleUpdate() : handleCreate());
              }}
            >
              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <FormSection title="Empresa">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {field('RUC', 'ruc')}
                  {field('Nombre', 'nombre')}
                  {field('Razón social', 'razonSocial')}
                  {field('Nombre comercial', 'nombreComercial')}
                  <div className="sm:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_8.5rem]">
                    {field('Dirección', 'direccion')}
                    {field('Ubigeo', 'ubigeo')}
                  </div>
                </div>
              </FormSection>

              <FormSection title="SUNAT">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {field('Usuario SOL', 'usuarioSol')}
                  {field(
                    'Clave SOL',
                    'claveSol',
                    'password',
                    editing?.hasSolCredentials ? keepSecret : '',
                    {
                      revealable: true,
                      revealed: showClaveSol,
                      onToggleReveal: () => setShowClaveSol((value) => !value),
                    },
                  )}
                </div>
              </FormSection>

              <FormSection title="Canales">
                <Tabs
                  value={channelTab}
                  onValueChange={(value) => setChannelTab(value as ChannelTab)}
                  className="gap-0"
                >
                  <TabsList variant="line" aria-label="Canales" className="h-11 w-full justify-start gap-0 rounded-none border-b border-border bg-transparent p-0">
                    <TabsTrigger value="falabella" className="h-full flex-none rounded-none px-3">
                      <ChannelMark channel="falabella" /> Falabella
                    </TabsTrigger>
                    <TabsTrigger value="ripley" className="h-full flex-none rounded-none px-3">
                      <ChannelMark channel="ripley" /> Ripley
                    </TabsTrigger>
                    <TabsTrigger value="mercado_libre" className="h-full flex-none rounded-none px-3">
                      <ChannelMark channel="mercado_libre" /> Mercado Libre
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="falabella" className="space-y-4 pt-5">{falabellaChannelPanel}</TabsContent>
                  <TabsContent value="ripley" className="space-y-4 pt-5">{ripleyChannelPanel}</TabsContent>
                  <TabsContent value="mercado_libre" className="space-y-4 pt-5">{mercadoLibreChannelPanel}</TabsContent>
                </Tabs>
                {loadingBilling && (
                  <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Cargando canales
                  </p>
                )}
              </FormSection>

              <FormSection title="Certificado">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="company-certificate">
                      Archivo {!editing && <span className="text-destructive">*</span>}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="company-certificate"
                        readOnly
                        value={certFileName || (hasStoredCert ? 'Ya está cargado' : '')}
                        placeholder=".pfx o .p12"
                      />
                      <input
                        ref={certInputRef}
                        type="file"
                        accept=".pfx,.p12,application/x-pkcs12"
                        className="hidden"
                        onChange={(e) => void onCertFileChange(e.target.files?.[0] || null)}
                      />
                      <Button type="button" variant="outline" onClick={() => certInputRef.current?.click()}>
                        <Upload /> Examinar
                      </Button>
                    </div>
                    {certFileName ? (
                      <p className="text-xs text-muted-foreground">Se sube al guardar.</p>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="company-cert-pass">Contraseña</Label>
                    <div className="relative">
                      <Input
                        id="company-cert-pass"
                        type={showCertPassword ? 'text' : 'password'}
                        value={certPass}
                        onChange={(e) => setCertPass(e.target.value)}
                        placeholder={hasStoredCert ? keepSecret : ''}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute inset-y-0 right-1 my-auto"
                        onClick={() => setShowCertPassword((value) => !value)}
                        title={showCertPassword ? 'Ocultar' : 'Mostrar'}
                      >
                        {showCertPassword ? <EyeOff /> : <Eye />}
                      </Button>
                    </div>
                  </div>
                </div>
              </FormSection>
            </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {oauthNotice && (
        <p className="text-sm text-muted-foreground">{oauthNotice}</p>
      )}
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid min-w-0 w-full gap-3 sm:grid-cols-[minmax(0,24rem)_12rem] lg:max-w-xl">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar empresa o RUC"
              className="pl-9"
            />
          </div>
          <Select value={setupFilter} onValueChange={setSetupFilter}>
            <SelectTrigger className="w-full" aria-label="Filtrar empresas por configuración">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="ready">Listas</SelectItem>
              <SelectItem value="incomplete">Incompletas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => navigate('/companies/nueva')}>
          <Plus data-icon="inline-start" />
          Nueva empresa
        </Button>
      </div>

      <TablePanel aria-label="Directorio de empresas">
          {loadingCompanies ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Loader2 className="size-8 animate-spin text-muted-foreground/60" />
              <p className="text-sm font-medium">Cargando empresas</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <AlertCircle className="size-8 text-destructive" />
              <p className="text-sm font-medium">No se pudieron cargar las empresas</p>
              <p className="text-sm text-muted-foreground">{loadError}</p>
            </div>
          ) : companies.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Building2 className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">No hay empresas registradas</p>
              <p className="text-sm text-muted-foreground">Crea la primera para emitir.</p>
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Search className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No encontramos empresas</p>
              <p className="text-sm text-muted-foreground">Prueba con otra búsqueda o filtro.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={cn(header.column.id === 'acciones' && 'w-12 text-right')}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 transition hover:text-foreground"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {{
                              asc: ' ↑',
                              desc: ' ↓',
                            }[header.column.getIsSorted() as string] ?? null}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/companies/${row.original.id}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        {!loadingCompanies && companies.length > 0 && (
          <TablePanelFooter className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Mostrando {filteredCompanies.length} de {companies.length} empresas</p>
          </TablePanelFooter>
        )}
      </TablePanel>
    </div>
  );
}
