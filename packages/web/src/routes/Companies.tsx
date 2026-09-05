import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Pencil, Trash2, Building2, Upload, AlertCircle, Loader2, Eye, EyeOff,
  MoreHorizontal, RefreshCw, Search, Link2, Unlink,
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
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TablePanel, TablePanelFooter,
  TablePanelHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import falabellaLogo from '../assets/falabella.png';
import mercadoLibreLogo from '../assets/mercado-libre.svg';
import ripleyLogo from '../assets/ripley.svg';

type ChannelTab = 'falabella' | 'ripley' | 'mercado_libre';

const CHANNEL_TAB_CLASS = 'h-9 flex-none rounded-lg px-3 text-[13px] font-medium text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground data-active:bg-muted! data-active:text-foreground! after:hidden';

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
      className={cn('size-4 rounded-[3px] object-contain', className)}
    />
  );
}

function ChannelTabTrigger({ value }: { value: ChannelTab }) {
  return (
    <TabsTrigger value={value} className={CHANNEL_TAB_CLASS}>
      <ChannelMark channel={value} />
      {CHANNEL_MARK[value].label}
    </TabsTrigger>
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

function SetupBadge({
  ok,
  okTitle,
  badTitle,
  okLabel = 'Configurado',
  badLabel = 'Pendiente',
}: {
  ok: boolean;
  okTitle: string;
  badTitle: string;
  okLabel?: string;
  badLabel?: string;
}) {
  return (
    <Badge
      variant="outline"
      title={ok ? okTitle : badTitle}
      className={cn(
        'rounded-md',
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
      )}
    >
      {ok ? okLabel : badLabel}
    </Badge>
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
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<CompanyRow | null>(null);
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
  const [disconnectingMercadoLibre, setDisconnectingMercadoLibre] = useState(false);
  const [oauthNotice, setOauthNotice] = useState('');
  const [channelTab, setChannelTab] = useState<ChannelTab>('falabella');

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
      .then((status: { configured?: boolean }) => setMercadoLibreAppConfigured(status?.configured === true))
      .catch(() => setMercadoLibreAppConfigured(false));
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    if (params.get('ml') === 'connected') setOauthNotice('Mercado Libre quedó conectado para esta empresa.');
    if (params.get('ml') === 'error') setOauthNotice(params.get('message') || 'No se pudo conectar Mercado Libre.');
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
    setShowCreate(false);
    setEditing(null);
    resetForm();
    setSaving(false);
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

  const readyCompanies = useMemo(() => companies.filter(setupReady).length, [companies]);

  const columns = useMemo<ColumnDef<CompanyRow>[]>(() => [
    {
      accessorKey: 'ruc',
      header: 'RUC',
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums text-foreground">{row.original.ruc || '—'}</span>
      ),
    },
    {
      id: 'nombre',
      accessorFn: (c) => c.nombre || c.razonSocial || '',
      header: 'Empresa',
      cell: ({ row }) => {
        const c = row.original;
        const name = c.nombre || c.razonSocial || 'Sin nombre';
        return (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{name}</p>
            {c.nombreComercial ? (
              <p className="truncate text-xs text-muted-foreground">{c.nombreComercial}</p>
            ) : c.razonSocial && c.nombre && c.razonSocial !== c.nombre ? (
              <p className="truncate text-xs text-muted-foreground">{c.razonSocial}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'falabella',
      header: () => (
        <span className="inline-flex items-center gap-1.5">
          <ChannelMark channel="falabella" />
          Falabella
        </span>
      ),
      cell: ({ row }) => (
        <SetupBadge
          ok={hasFalabellaApi(row.original)}
          okTitle="API Falabella configurada"
          badTitle="Falta User ID o API Key de Falabella"
        />
      ),
    },
    {
      id: 'mercadoLibre',
      header: () => (
        <span className="inline-flex items-center gap-1.5">
          <ChannelMark channel="mercado_libre" />
          Mercado Libre
        </span>
      ),
      cell: ({ row }) => (
        <SetupBadge
          ok={!!row.original.hasMercadoLibreCredentials}
          okTitle={row.original.mercadoLibreUserId ? `Conectado · ${row.original.mercadoLibreUserId}` : 'Mercado Libre conectado'}
          badTitle="Esta empresa todavía no autorizó su cuenta de Mercado Libre"
        />
      ),
    },
    {
      id: 'certificado',
      header: 'Certificado',
      cell: ({ row }) => (
        <SetupBadge
          ok={hasCertificate(row.original)}
          okTitle="Certificado digital cargado"
          badTitle="Falta certificado digital"
        />
      ),
    },
    {
      id: 'estado',
      header: 'Estado',
      cell: ({ row }) => (
        <SetupBadge
          ok={setupReady(row.original)}
          okTitle="Empresa lista (Falabella + certificado + SOL)"
          badTitle="Configuración incompleta"
          okLabel="Lista"
          badLabel="Incompleta"
        />
      ),
    },
    {
      id: 'acciones',
      header: () => <span className="block text-right">Acciones</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${row.original.nombre || row.original.razonSocial || 'empresa'}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onClick={() => startEdit(row.original)}>
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
  ], []);

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
    setShowCreate(false);
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
    const oauthParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const mlResult = oauthParams.get('ml');
    setChannelTab(mlResult === 'connected' || mlResult === 'error' || oauthNotice ? 'mercado_libre' : 'falabella');
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

  const field = (
    label: string,
    key: keyof CompanyForm,
    type = 'text',
    placeholder = '',
    options?: { revealable?: boolean; revealed?: boolean; onToggleReveal?: () => void },
  ) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        <input
          name={key}
          type={options?.revealable ? (options.revealed ? 'text' : 'password') : type}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          placeholder={placeholder}
          className={`w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring ${
            options?.revealable ? 'pr-10' : ''
          }`}
        />
        {options?.revealable && options.onToggleReveal && (
          <button
            type="button"
            onClick={options.onToggleReveal}
            className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-muted-foreground hover:text-foreground"
            title={options.revealed ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            {options.revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );

  const falabellaCredentialsReady = Boolean(
    form.falabellaApiUserId.trim()
    && (form.falabellaApiKey.trim() || editing?.hasFalabellaCredentials),
  );

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
        <Button
          onClick={() => {
            resetForm();
            setEditing(null);
            setShowCreate(true);
          }}
        >
          <Plus data-icon="inline-start" />
          Nueva empresa
        </Button>
      </div>

      {(showCreate || editing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-card p-6 shadow-2xl">
            <form
              ref={formRef}
              onSubmit={(event) => {
                event.preventDefault();
                void (editing ? handleUpdate() : handleCreate());
              }}
            >
              <h2 className="mb-4 text-lg font-semibold">{editing ? 'Editar Empresa' : 'Nueva Empresa'}</h2>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {field('RUC (11 dígitos)', 'ruc')}
                {field('Nombre', 'nombre')}
                {field('Razón Social', 'razonSocial')}
                {field('Nombre Comercial', 'nombreComercial')}
                {field('Ubigeo (6 dígitos)', 'ubigeo')}
                <div className="md:col-span-2">{field('Dirección', 'direccion')}</div>
                {field('Usuario SOL', 'usuarioSol')}
                {field(
                  'Clave SOL',
                  'claveSol',
                  'password',
                  editing?.hasSolCredentials ? 'Dejar vacío para mantener la actual' : '',
                  {
                    revealable: true,
                    revealed: showClaveSol,
                    onToggleReveal: () => setShowClaveSol((value) => !value),
                  },
                )}
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <p className="text-sm font-medium text-muted-foreground">Canales</p>
                <p className="mt-1 text-xs text-muted-foreground">Credenciales y comprobantes de cada marketplace.</p>
                <Tabs
                  value={channelTab}
                  onValueChange={(value) => setChannelTab(value as ChannelTab)}
                  className="mt-3 gap-3"
                >
                  <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-1 rounded-none bg-transparent p-0">
                    <ChannelTabTrigger value="falabella" />
                    <ChannelTabTrigger value="ripley" />
                    <ChannelTabTrigger value="mercado_libre" />
                  </TabsList>

                  <TabsContent value="falabella" className="space-y-4">
                    <div>
                      <p className="mb-2 text-sm font-medium text-muted-foreground">Seller</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {field('Usuario Seller', 'sellerUsername')}
                        {field(
                          'Contraseña Seller',
                          'sellerPassword',
                          'password',
                          editing?.hasSellerPassword ? 'Dejar vacío para mantener la actual' : '',
                          {
                            revealable: true,
                            revealed: showSellerPassword,
                            onToggleReveal: () => setShowSellerPassword((value) => !value),
                          },
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-muted-foreground">API</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {field('User ID API', 'falabellaApiUserId', 'text', 'Settings > Integration Management > API')}
                        {field(
                          'API Key',
                          'falabellaApiKey',
                          'password',
                          editing?.hasFalabellaCredentials ? 'Dejar vacío para mantener la actual' : '',
                          {
                            revealable: true,
                            revealed: showFalabellaApiKey,
                            onToggleReveal: () => setShowFalabellaApiKey((value) => !value),
                          },
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
                      <div>
                        <p className="text-sm font-medium">Comprobantes</p>
                        <p className="text-xs text-muted-foreground">Emitir boletas y facturas automáticamente.</p>
                        {!falabellaCredentialsReady && (
                          <p className="mt-1 text-xs text-muted-foreground">Configura la API para activar la emisión.</p>
                        )}
                      </div>
                      <Switch
                        checked={channelAutoEmission.falabella}
                        disabled={loadingBilling || !falabellaCredentialsReady}
                        onCheckedChange={(checked) => setChannelAutoEmission((current) => ({ ...current, falabella: checked }))}
                        aria-label="Emitir boletas y facturas automáticamente para Falabella"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="ripley" className="space-y-4">
                    <div>
                      <p className="mb-2 text-sm font-medium text-muted-foreground">Mirakl</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {field('Shop ID (opcional)', 'ripleyShopId', 'text', 'Se usa cuando la key accede a varias tiendas')}
                        <div className="md:col-span-2">{field(
                          'API Key',
                          'ripleyApiKey',
                          'password',
                          editing?.hasRipleyCredentials ? 'Dejar vacío para mantener la actual' : '',
                          {
                            revealable: true,
                            revealed: showRipleyApiKey,
                            onToggleReveal: () => setShowRipleyApiKey((value) => !value),
                          },
                        )}</div>
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-muted-foreground">Seller Center</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {field('Usuario SVC', 'ripleySvcUsername', 'text', 'Credencial entregada por Ripley')}
                        {field(
                          'Contraseña SVC',
                          'ripleySvcPassword',
                          'password',
                          editing?.hasRipleySvcCredentials ? 'Dejar vacío para mantener la actual' : '',
                          {
                            revealable: true,
                            revealed: showRipleySvcPassword,
                            onToggleReveal: () => setShowRipleySvcPassword((value) => !value),
                          },
                        )}
                        <div className="md:col-span-2">
                          {field('URL productiva SVC', 'ripleySvcBaseUrl', 'url', 'La URL se entrega de manera privada por país')}
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">SVC usa credenciales distintas de Mirakl para etiquetas y manifiestos. No uses el host de laboratorio en producción.</p>
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
                      <div>
                        <p className="text-sm font-medium">Comprobantes</p>
                        <p className="text-xs text-muted-foreground">Emitir boletas y facturas automáticamente.</p>
                        <p className="mt-1 text-xs text-muted-foreground">Se activará al sincronizar pedidos.</p>
                      </div>
                      <Switch
                        checked={channelAutoEmission.ripley}
                        disabled={loadingBilling}
                        onCheckedChange={(checked) => setChannelAutoEmission((current) => ({ ...current, ripley: checked }))}
                        aria-label="Emitir boletas y facturas automáticamente para Ripley"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="mercado_libre" className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Cada empresa conecta su propia cuenta. Un administrador debe autorizar la app.
                    </p>
                    {oauthNotice && (
                      <p className="text-xs text-muted-foreground">{oauthNotice}</p>
                    )}
                    {editing?.hasMercadoLibreCredentials ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <ChannelMark channel="mercado_libre" className="mt-0.5 size-5" />
                          <div>
                            <p className="text-sm font-medium text-foreground">Conectado</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              user_id {editing.mercadoLibreUserId || '—'}
                              {editing.mercadoLibreSiteId ? ` · ${editing.mercadoLibreSiteId}` : ''}
                            </p>
                          </div>
                        </div>
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
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <ChannelMark channel="mercado_libre" className="mt-0.5 size-5" />
                          <p className="text-sm text-muted-foreground">
                            {!editing
                              ? 'Guarda la empresa para conectar la cuenta.'
                              : mercadoLibreAppConfigured
                                ? 'Todavía no hay una cuenta autorizada para esta empresa.'
                                : 'Falta configurar la app de Mercado Libre en el servidor.'}
                          </p>
                        </div>
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
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
                      <div>
                        <p className="text-sm font-medium">Comprobantes</p>
                        <p className="text-xs text-muted-foreground">Emitir boletas y facturas automáticamente.</p>
                        {!editing?.hasMercadoLibreCredentials && (
                          <p className="mt-1 text-xs text-muted-foreground">Conecta la cuenta para activar la emisión.</p>
                        )}
                      </div>
                      <Switch
                        checked={channelAutoEmission.mercado_libre}
                        disabled={loadingBilling || !editing?.hasMercadoLibreCredentials}
                        onCheckedChange={(checked) => setChannelAutoEmission((current) => ({ ...current, mercado_libre: checked }))}
                        aria-label="Emitir boletas y facturas automáticamente para Mercado Libre"
                      />
                    </div>
                  </TabsContent>
                </Tabs>
                {loadingBilling && (
                  <p className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Cargando configuración
                  </p>
                )}
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Certificado digital {!editing && <span className="text-red-500">*</span>}
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={
                        certFileName
                          || (hasStoredCert ? 'Certificado ya almacenado' : '')
                      }
                      readOnly
                      placeholder=".pfx o .p12"
                      className={`flex-1 rounded-lg border border-input px-3 py-2 text-sm ${
                        hasStoredCert && !certFileName
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-background'
                      }`}
                    />
                    <input
                      ref={certInputRef}
                      type="file"
                      accept=".pfx,.p12,application/x-pkcs12"
                      className="hidden"
                      onChange={(e) => void onCertFileChange(e.target.files?.[0] || null)}
                    />
                    <button
                      type="button"
                      onClick={() => certInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-accent"
                    >
                      <Upload className="h-4 w-4" /> Examinar
                    </button>
                  </div>
                  {certFileName ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Se subirá el archivo seleccionado al guardar.
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">Contraseña del certificado</label>
                  <div className="relative">
                    <input
                      type={showCertPassword ? 'text' : 'password'}
                      value={certPass}
                      onChange={(e) => setCertPass(e.target.value)}
                      placeholder={hasStoredCert ? 'Dejar vacío para mantener la actual' : ''}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm shadow-sm outline-none transition focus:border-ring"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCertPassword((value) => !value)}
                      className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-muted-foreground hover:text-foreground"
                      title={showCertPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showCertPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  disabled={saving}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || loadingBilling}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <TablePanel aria-label="Directorio de empresas">
        <TablePanelHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{companies.length} empresa(s)</p>
            <p className="text-xs text-muted-foreground">{readyCompanies} listas · {companies.length - readyCompanies} con configuración pendiente</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loadingCompanies}>
            <RefreshCw className={cn(loadingCompanies && 'animate-spin')} />
            Actualizar
          </Button>
        </TablePanelHeader>
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
              <p className="text-sm text-muted-foreground">Crea tu primera empresa para comenzar a emitir.</p>
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Search className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No encontramos empresas</p>
              <p className="text-sm text-muted-foreground">Prueba con otra búsqueda o filtro.</p>
            </div>
          ) : (
            <Table className="min-w-[820px]">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={cn(header.column.id === 'acciones' && 'text-right')}
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
                  <TableRow key={row.id}>
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
