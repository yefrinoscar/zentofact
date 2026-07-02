import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Building2, Upload, AlertCircle, Loader2, ShieldCheck, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import api from '../lib/api';

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
};

type SunatConnectionResult = {
  success: boolean;
  severity: 'success' | 'warning' | 'error';
  environment: 'beta' | 'produccion';
  endpoint: string;
  authAccepted: boolean;
  certificateValid: boolean;
  code?: string;
  message: string;
  rawStatusCode?: string;
  rawContent?: string;
};

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
};

export default function Companies() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<CompanyForm>(initialForm);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [certPath, setCertPath] = useState('');
  const [certPass, setCertPass] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sunatChecks, setSunatChecks] = useState<Record<string, { loading: boolean; result?: SunatConnectionResult }>>({});
  const [showClaveSol, setShowClaveSol] = useState(false);
  const [showSellerPassword, setShowSellerPassword] = useState(false);
  const [showFalabellaApiKey, setShowFalabellaApiKey] = useState(false);
  const [showCertPassword, setShowCertPassword] = useState(false);

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
  }, []);

  const resetForm = () => {
    setForm(initialForm);
    setCertPath('');
    setCertPass('');
    setError('');
    setShowClaveSol(false);
    setShowSellerPassword(false);
    setShowFalabellaApiKey(false);
    setShowCertPassword(false);
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

  const validate = (candidate: CompanyForm): string | null => {
    if (!candidate.ruc || candidate.ruc.length !== 11) return 'El RUC debe tener 11 dígitos.';
    if (!candidate.razonSocial.trim()) return 'La razón social es requerida.';
    if (!candidate.usuarioSol.trim()) return 'El usuario SOL es requerido.';
    if (!candidate.claveSol.trim()) return 'La clave SOL es requerida.';
    return null;
  };

  const handleCreate = async () => {
    const nextForm = readFormSnapshot();
    setForm(nextForm);

    const validationError = validate(nextForm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    try {
      let certificado: string | undefined;
      if (certPath && certPath !== '(certificado guardado)') {
        certificado = await api.readCertFile(certPath);
      }

      await api.createCompany({
        ...nextForm,
        ...(certificado ? { certificado } : {}),
        ...(certPass ? { certificadoPassword: certPass } : {}),
      });
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

    const validationError = validate(nextForm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    try {
      let certificado: string | undefined;
      if (certPath && certPath !== '(certificado guardado)') {
        certificado = await api.readCertFile(certPath);
      }

      const updateData: any = { ...nextForm };
      if (certificado) updateData.certificado = certificado;
      if (certPass) updateData.certificadoPassword = certPass;

      await api.updateCompany(editing.id, updateData);
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

  const handleTestSunat = async (companyId: number, environment: 'beta' | 'produccion') => {
    const key = `${companyId}-${environment}`;
    setSunatChecks((prev) => ({
      ...prev,
      [key]: { loading: true },
    }));

    try {
      const result = await api.testSunatConnection(companyId, environment);
      setSunatChecks((prev) => ({
        ...prev,
        [key]: { loading: false, result },
      }));
    } catch (e: any) {
      setSunatChecks((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          result: {
            success: false,
            environment,
            endpoint: '',
            severity: 'error',
            authAccepted: false,
            certificateValid: false,
            code: 'CLIENT_ERROR',
            message: e?.message || 'No se pudo verificar la conexión SUNAT.',
          },
        },
      }));
    }
  };

  const startEdit = (company: any) => {
    setEditing(company);
    setShowCreate(false);
    setCertPath(company.certificado ? '(certificado guardado)' : '');
    setCertPass(company.certificadoPassword || '');
    setError('');
    setForm({
      nombre: company.nombre || company.razonSocial || '',
      ruc: company.ruc,
      razonSocial: company.razonSocial,
      nombreComercial: company.nombreComercial || '',
      direccion: company.direccion || '',
      ubigeo: company.ubigeo || '',
      usuarioSol: company.usuarioSol || '',
      claveSol: company.claveSol || '',
      sellerUsername: company.sellerUsername || '',
      sellerPassword: company.sellerPassword || '',
      falabellaApiUserId: company.falabellaApiUserId || '',
      falabellaApiKey: company.falabellaApiKey || '',
    });
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
          value={form[key] as string}
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

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Empresas</h2>
            <p className="text-sm text-muted-foreground">
              Configura credenciales de Falabella Seller, SUNAT y certificado por empresa.
            </p>
          </div>
          <button
            onClick={() => {
              resetForm();
              setEditing(null);
              setShowCreate(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Nueva Empresa
          </button>
        </div>
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
                {field('Clave SOL', 'claveSol', 'password', '', {
                  revealable: true,
                  revealed: showClaveSol,
                  onToggleReveal: () => setShowClaveSol((value) => !value),
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <p className="mb-2 text-sm font-medium text-muted-foreground">Credenciales Falabella Seller</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {field('Usuario Seller', 'sellerUsername')}
                  {field('Contraseña Seller', 'sellerPassword', 'password', '', {
                    revealable: true,
                    revealed: showSellerPassword,
                    onToggleReveal: () => setShowSellerPassword((value) => !value),
                  })}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <p className="mb-2 text-sm font-medium text-muted-foreground">Credenciales Falabella API</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {field('User ID API', 'falabellaApiUserId', 'text', 'Settings > Integration Management > API')}
                  {field('API Key', 'falabellaApiKey', 'password', '', {
                    revealable: true,
                    revealed: showFalabellaApiKey,
                    onToggleReveal: () => setShowFalabellaApiKey((value) => !value),
                  })}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Certificado digital {!editing && <span className="text-red-500">*</span>}
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={certPath === '(certificado guardado)' ? 'Certificado ya almacenado' : certPath ? certPath.split('/').pop() || certPath : ''}
                      readOnly
                      placeholder=".pfx o .p12"
                      className={`flex-1 rounded-lg border border-input px-3 py-2 text-sm ${certPath === '(certificado guardado)' ? 'text-emerald-700 bg-emerald-50' : 'bg-background'}`}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const p = await api.selectCertificate();
                        if (p) setCertPath(p);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-accent"
                    >
                      <Upload className="h-4 w-4" /> Examinar
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">Contraseña del certificado</label>
                  <div className="relative">
                    <input
                      type={showCertPassword ? 'text' : 'password'}
                      value={certPass}
                      onChange={(e) => setCertPass(e.target.value)}
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
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {loadingCompanies ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-muted-foreground/60" />
            <p className="font-medium text-foreground">Cargando empresas</p>
          </div>
        ) : loadError ? (
          <div className="p-10 text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <p className="font-medium text-foreground">No se pudieron cargar las empresas</p>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
          </div>
        ) : companies.length === 0 ? (
          <div className="p-10 text-center">
            <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
            <p className="font-medium text-foreground">No hay empresas registradas</p>
            <p className="mt-1 text-sm text-muted-foreground">Crea tu primera empresa para comenzar a emitir.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="p-3 font-medium text-muted-foreground">RUC</th>
                <th className="p-3 font-medium text-muted-foreground">Nombre</th>
                <th className="p-3 font-medium text-muted-foreground">SUNAT</th>
                <th className="p-3 font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const betaKey = `${company.id}-beta`;
                const prodKey = `${company.id}-produccion`;
                const betaCheck = sunatChecks[betaKey];
                const prodCheck = sunatChecks[prodKey];
                const latestCheck = prodCheck?.result || betaCheck?.result;
                const toneClass = latestCheck
                  ? latestCheck.severity === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : latestCheck.severity === 'warning'
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-red-200 bg-red-50 text-red-800'
                  : '';

                return (
                  <tr key={company.id} className="border-t border-border/70 hover:bg-accent/40">
                    <td className="p-3 font-mono text-xs">{company.ruc}</td>
                    <td className="p-3">{company.nombre || company.razonSocial}</td>
                    <td className="p-3 align-top">
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleTestSunat(company.id, 'beta')}
                            disabled={betaCheck?.loading}
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {betaCheck?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                            {betaCheck?.loading ? 'Probando beta...' : 'Probar beta'}
                          </button>
                          <button
                            onClick={() => handleTestSunat(company.id, 'produccion')}
                            disabled={prodCheck?.loading}
                            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {prodCheck?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                            {prodCheck?.loading ? 'Probando prod...' : 'Probar prod'}
                          </button>
                        </div>
                        {latestCheck && (
                          <div className={`rounded-lg border px-2.5 py-2 text-xs ${toneClass}`}>
                            <div className="flex items-center gap-1.5 font-medium">
                              {latestCheck.severity === 'success' ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                              <span>
                                {latestCheck.severity === 'success'
                                  ? 'Conexión correcta'
                                  : latestCheck.severity === 'warning'
                                    ? 'Prueba no concluyente'
                                    : 'Conexión fallida'}
                              </span>
                            </div>
                            <p className="mt-1 leading-5">{latestCheck.message}</p>
                            {latestCheck.code && (
                              <p className="mt-1 font-mono text-[11px] opacity-80">Código: {latestCheck.code}</p>
                            )}
                            <p className="mt-1 opacity-80">
                              Ambiente: {latestCheck.environment === 'produccion' ? 'Producción' : 'Beta'}
                              {latestCheck.rawStatusCode ? ` · SUNAT ${latestCheck.rawStatusCode}` : ''}
                            </p>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEdit(company)}
                          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(company.id)}
                          className="rounded-md p-1.5 text-red-600 transition hover:bg-red-50"
                          title="Desactivar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
