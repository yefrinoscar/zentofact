import { useEffect, useState } from 'react';
import { Search, Building2, AlertTriangle, ReceiptText, FileText, FileMinus2 } from 'lucide-react';
import { useAppStore } from '../stores/app';
import { Loading } from '../components/Loading';
import api from '../lib/api';

type ViewMode = 'boletas' | 'facturas' | 'credit-notes';

const statusBadgeClass: Record<string, string> = {
  ACEPTADO: 'bg-emerald-100 text-emerald-700',
  ANULADO: 'bg-slate-200 text-slate-700',
  RECHAZADO: 'bg-red-100 text-red-700',
  PENDIENTE: 'bg-amber-100 text-amber-700',
  REGISTRADO: 'bg-sky-100 text-sky-700',
};

function StatusBadge({ value }: { value?: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        statusBadgeClass[value || ''] || 'bg-slate-100 text-slate-700'
      }`}
    >
      {value || '-'}
    </span>
  );
}

export default function History() {
  const activeId = useAppStore((s) => s.activeCompanyId);
  const setActiveId = useAppStore((s) => s.setActiveCompanyId);

  const [viewMode, setViewMode] = useState<ViewMode>('boletas');
  const [boletas, setBoletas] = useState<any[]>([]);
  const [boletasTotal, setBoletasTotal] = useState(0);
  const [facturas, setFacturas] = useState<any[]>([]);
  const [facturasTotal, setFacturasTotal] = useState(0);
  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [creditNotesTotal, setCreditNotesTotal] = useState(0);
  const [branchId, setBranchId] = useState<number | undefined>();
  const [estado, setEstado] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [branches, setBranches] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [creditNotePreview, setCreditNotePreview] = useState<null | {
    html: string;
    numeroCompleto: string;
    totals: { mtoImpVenta: number };
  }>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);

  const loadBoletas = async () => {
    if (!activeId) return;
    const res = await api.listBoletas({
      companyId: activeId,
      branchId,
      estado: estado || undefined,
      limit: 500,
    });
    setBoletas(res?.boletas || []);
    setBoletasTotal(res?.total || 0);
  };

  const loadCreditNotes = async () => {
    if (!activeId) return;
    const res = await api.listCreditNotes({
      companyId: activeId,
      branchId,
      estado: estado || undefined,
      limit: 500,
    });
    setCreditNotes(res?.creditNotes || []);
    setCreditNotesTotal(res?.total || 0);
  };

  const loadFacturas = async () => {
    if (!activeId) return;
    const res = await api.listFacturas({
      companyId: activeId,
      estado: estado || undefined,
      limit: 500,
    });
    setFacturas(res?.facturas || []);
    setFacturasTotal(res?.total || 0);
  };

  const loadCurrentView = async () => {
    if (!activeId) return;
    try {
      setError('');
      setLoading(true);
      if (viewMode === 'boletas') {
        await loadBoletas();
      } else if (viewMode === 'facturas') {
        await loadFacturas();
      } else {
        await loadCreditNotes();
      }
    } catch (e: any) {
      setError(e.message || 'Error al cargar historial');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.listCompanies().then((cs) => setCompanies(Array.isArray(cs) ? cs : [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeId) return;
    loadCurrentView();
    api.listBranches(activeId).then((bs) => setBranches(Array.isArray(bs) ? bs : [])).catch(() => {});
  }, [activeId, viewMode]);

  useEffect(() => {
    setEstado('');
    if (viewMode === 'facturas') {
      setBranchId(undefined);
    }
  }, [viewMode]);

  useEffect(() => {
    loadCurrentView();
  }, [branchId, estado, orderNumber]);

  const handleSelectCompany = async (id: number) => {
    setBranchId(undefined);
    setEstado('');
    setOrderNumber('');
    setActiveId(id);
    await api.setActiveCompanyId(id);
  };

  const normalizedSearch = orderNumber.trim().toLowerCase();
  const filteredBoletas = normalizedSearch
    ? boletas.filter((boleta: any) =>
        [
          boleta.numeroCompleto,
          boleta.orderNumber,
          boleta.creditNoteNumeroCompleto,
          boleta.clientNumeroDocumento,
        ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch)),
      )
    : boletas;

  const filteredCreditNotes = normalizedSearch
    ? creditNotes.filter((note: any) =>
        [
          note.numeroCompleto,
          note.affectedBoletaNumeroCompleto,
          note.affectedOrderNumber,
          note.clientNumeroDocumento,
        ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch)),
      )
    : creditNotes;

  const filteredFacturas = normalizedSearch
    ? facturas.filter((factura: any) =>
        [
          factura.numeroCompleto,
          factura.orderNumber,
        ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch)),
      )
    : facturas;

  const openCreditNotePreview = async (id: number) => {
    try {
      setPreviewLoadingId(id);
      const preview = await api.previewCreditNoteHtml(id);
      setCreditNotePreview(preview);
    } catch (e: any) {
      setError(e.message || 'Error al generar vista previa de la nota de crédito');
    } finally {
      setPreviewLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        {companies.length > 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <select
              value={activeId ? String(activeId) : ''}
              onChange={(e) => {
                if (!e.target.value) return;
                handleSelectCompany(Number(e.target.value));
              }}
              className="min-w-[320px] bg-transparent outline-none"
            >
              <option value="">Selecciona una empresa</option>
              {companies.map((nextCompany) => (
                <option key={nextCompany.id} value={nextCompany.id}>
                  {nextCompany.nombre || nextCompany.razonSocial} ({nextCompany.ruc})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            No hay empresas registradas
          </div>
        )}

        <div className="inline-flex rounded-lg border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => setViewMode('boletas')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
              viewMode === 'boletas' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            <ReceiptText className="h-4 w-4" /> Boletas
          </button>
          <button
            type="button"
            onClick={() => setViewMode('facturas')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
              viewMode === 'facturas' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            <FileText className="h-4 w-4" /> Facturas
          </button>
          <button
            type="button"
            onClick={() => setViewMode('credit-notes')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
              viewMode === 'credit-notes' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            <FileMinus2 className="h-4 w-4" /> Notas de crédito
          </button>
        </div>

        <input
          type="text"
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          placeholder="Buscar por orden o número..."
          disabled={!activeId}
          className="w-48 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring disabled:opacity-50"
        />

        <select
          value={branchId || ''}
          onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : undefined)}
          disabled={!activeId || viewMode === 'facturas'}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring disabled:opacity-50"
        >
          <option value="">Todas las sucursales</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.nombre} ({branch.codigo})
            </option>
          ))}
        </select>

        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          disabled={!activeId}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring disabled:opacity-50"
        >
          <option value="">Todos los estados</option>
          {viewMode === 'facturas' ? (
            <option value="REGISTRADO">Registrado</option>
          ) : (
            <>
              <option value="ACEPTADO">Aceptado</option>
              <option value="ANULADO">Anulado</option>
              <option value="RECHAZADO">Rechazado</option>
              <option value="PENDIENTE">Pendiente</option>
            </>
          )}
        </select>

        <button
          onClick={loadCurrentView}
          disabled={!activeId}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          <Search className="h-4 w-4" /> Buscar
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {error && (
          <div className="m-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {!activeId && !error ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Selecciona una empresa para consultar el historial.
          </div>
        ) : loading ? (
          <Loading label="Cargando historial..." />
        ) : viewMode === 'boletas' ? (
          filteredBoletas.length === 0 && !error ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No se encontraron boletas.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/35">
                <tr className="text-left">
                  <th className="p-3 font-medium text-muted-foreground">Boleta</th>
                  <th className="p-3 font-medium text-muted-foreground">Orden</th>
                  <th className="p-3 font-medium text-muted-foreground">Fecha</th>
                  <th className="p-3 font-medium text-muted-foreground">Cliente</th>
                  <th className="p-3 font-medium text-muted-foreground">Total</th>
                  <th className="p-3 font-medium text-muted-foreground">Estado</th>
                  <th className="p-3 font-medium text-muted-foreground">Nota de crédito</th>
                </tr>
              </thead>
              <tbody>
                {filteredBoletas.map((boleta: any) => (
                  <tr key={boleta.id} className="border-t border-border/70 hover:bg-accent/30">
                    <td className="p-3 font-mono text-xs">{boleta.numeroCompleto || '-'}</td>
                    <td className="p-3 font-mono text-xs">{boleta.orderNumber || '-'}</td>
                    <td className="p-3">{boleta.fechaEmision || '-'}</td>
                    <td className="p-3">
                      <div>{boleta.clientRazonSocial || '-'}</div>
                      <div className="text-xs text-muted-foreground">{boleta.clientNumeroDocumento || '-'}</div>
                    </td>
                    <td className="p-3">S/ {parseFloat(boleta.mtoImpVenta || '0').toFixed(2)}</td>
                    <td className="p-3">
                      <StatusBadge value={boleta.estadoSunat} />
                    </td>
                    <td className="p-3 align-top">
                      {boleta.creditNoteNumeroCompleto ? (
                        <div className="flex min-w-[190px] flex-col gap-1">
                          <div className="font-mono text-xs leading-none">{boleta.creditNoteNumeroCompleto}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge value={boleta.creditNoteEstadoSunat} />
                            <span className="text-xs text-muted-foreground">{boleta.creditNoteFechaEmision}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin nota</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : viewMode === 'facturas' ? (
          filteredFacturas.length === 0 && !error ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No se encontraron facturas registradas. Las facturas se guardan aquí cuando se suben a Falabella.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/35">
                <tr className="text-left">
                  <th className="p-3 font-medium text-muted-foreground">Factura</th>
                  <th className="p-3 font-medium text-muted-foreground">Orden</th>
                  <th className="p-3 font-medium text-muted-foreground">Fecha</th>
                  <th className="p-3 font-medium text-muted-foreground">Fuente</th>
                  <th className="p-3 font-medium text-muted-foreground">Estado</th>
                  <th className="p-3 font-medium text-muted-foreground">PDF</th>
                </tr>
              </thead>
              <tbody>
                {filteredFacturas.map((factura: any) => (
                  <tr key={factura.id} className="border-t border-border/70 hover:bg-accent/30">
                    <td className="p-3 font-mono text-xs">{factura.numeroCompleto || '-'}</td>
                    <td className="p-3 font-mono text-xs">{factura.orderNumber || '-'}</td>
                    <td className="p-3">{factura.fechaEmision || '-'}</td>
                    <td className="p-3 uppercase">{factura.fuente || '-'}</td>
                    <td className="p-3">
                      <StatusBadge value={factura.estado} />
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {factura.pdfPath ? 'Guardado' : 'Sin PDF'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filteredCreditNotes.length === 0 && !error ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No se encontraron notas de crédito.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/35">
              <tr className="text-left">
                <th className="p-3 font-medium text-muted-foreground">Nota</th>
                <th className="p-3 font-medium text-muted-foreground">Fecha</th>
                <th className="p-3 font-medium text-muted-foreground">Boleta afectada</th>
                <th className="p-3 font-medium text-muted-foreground">Orden</th>
                <th className="p-3 font-medium text-muted-foreground">Cliente</th>
                <th className="p-3 font-medium text-muted-foreground">Total</th>
                <th className="p-3 font-medium text-muted-foreground">Estado NC</th>
                <th className="p-3 font-medium text-muted-foreground">Estado boleta</th>
                <th className="p-3 font-medium text-muted-foreground">Documento</th>
              </tr>
            </thead>
            <tbody>
              {filteredCreditNotes.map((note: any) => (
                <tr key={note.id} className="border-t border-border/70 hover:bg-accent/30">
                  <td className="p-3">
                    <div className="font-mono text-xs">{note.numeroCompleto || '-'}</div>
                    <div className="text-xs text-muted-foreground">{note.desMotivo || '-'}</div>
                  </td>
                  <td className="p-3">{note.fechaEmision || '-'}</td>
                  <td className="p-3">
                    <div className="font-mono text-xs">{note.affectedBoletaNumeroCompleto || '-'}</div>
                    <div className="text-xs text-muted-foreground">{note.numDocAfectado || '-'}</div>
                  </td>
                  <td className="p-3 font-mono text-xs">{note.affectedOrderNumber || '-'}</td>
                  <td className="p-3">
                    <div>{note.clientRazonSocial || '-'}</div>
                    <div className="text-xs text-muted-foreground">{note.clientNumeroDocumento || '-'}</div>
                  </td>
                  <td className="p-3">S/ {parseFloat(note.mtoImpVenta || '0').toFixed(2)}</td>
                  <td className="p-3">
                    <StatusBadge value={note.estadoSunat} />
                  </td>
                  <td className="p-3">
                    <StatusBadge value={note.affectedBoletaEstadoSunat} />
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => openCreditNotePreview(note.id)}
                      disabled={previewLoadingId === note.id}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
                    >
                      {previewLoadingId === note.id ? 'Cargando...' : 'Ver documento'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {!activeId
          ? ''
          : loading
            ? 'Cargando...'
            : viewMode === 'boletas'
              ? `${filteredBoletas.length} de ${boletasTotal} boletas encontradas`
              : viewMode === 'facturas'
                ? `${filteredFacturas.length} de ${facturasTotal} facturas encontradas`
                : `${filteredCreditNotes.length} de ${creditNotesTotal} notas de crédito encontradas`}
      </p>

      {creditNotePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="flex h-[92vh] w-[min(1400px,100%)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <h3 className="text-xl font-semibold text-foreground">Vista previa del documento</h3>
                <p className="text-sm text-muted-foreground">
                  {creditNotePreview.numeroCompleto} · Total: S/ {creditNotePreview.totals.mtoImpVenta.toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreditNotePreview(null)}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Cerrar
              </button>
            </div>
            <iframe
              title="Vista previa de nota de crédito"
              className="h-full w-full bg-white"
              srcDoc={creditNotePreview.html}
            />
          </div>
        </div>
      )}
    </div>
  );
}
