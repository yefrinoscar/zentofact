import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Banknote, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import {
  SALE_STEPS,
  buildManualSaleOrderPayload,
  firstInvalidSaleStep,
  limaTodayKey,
  productPrice,
  saleLinesTotal,
  validateSaleStep,
  type BoletaIdentity,
  type CatalogProductForSale,
  type DocumentRequest,
  type ManualSaleInput,
  type PaymentMethod,
  type SaleLine,
  type SaleSource,
  type SaleStepId,
} from '../lib/registrar-venta';
import { OWN_FLEET_CARRIER, quoteOwnFleetShipping, saleTotals } from '../lib/own-fleet-shipping';
import { formatSaleMoney } from '../lib/sale-summary';
import {
  applyOptimisticSale,
  buildOptimisticSale,
  humanizeSaleError,
  type OptimisticHome,
} from '../lib/sale-feedback';
import type { ShippingCarrier } from '../lib/shipping-carrier';
import type { MapPlace } from '../components/PlacePicker';
import { ProductSearchPicker } from '../components/ProductSearchPicker';
import { useOperatorSnackbar } from '../components/OperatorSnackbar';
import { Button } from '../components/ui/button';
import { ClienteStep, EntregaStep, PagoStep, ProductosStep } from './registrar-venta/steps';
import { ResumenStep } from './registrar-venta/resumen';
import { FieldHint, SaleStepper, type StepState } from './registrar-venta/widgets';
import type { PaymentProof, SaleFormView } from './registrar-venta/view';

type ChannelAccount = {
  id: number;
  companyId: number;
  channelCode: string;
  active: boolean;
};

const PROOF_MAX_BYTES = 1_500_000;

async function readPaymentProof(file: File): Promise<PaymentProof> {
  if (file.size <= PROOF_MAX_BYTES) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('No se pudo leer la constancia.'));
      reader.readAsDataURL(file);
    });
    return { name: file.name, type: file.type || 'image/jpeg', dataUrl };
  }

  const bitmap = await createImageBitmap(file);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('No se pudo comprimir la constancia en este dispositivo.');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = 0.82;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length * 0.75 > PROOF_MAX_BYTES && quality > 0.45) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length * 0.75 > PROOF_MAX_BYTES) {
    throw new Error('La constancia sigue pesando demasiado. Usa una foto más liviana.');
  }
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'constancia';
  return { name: `${baseName}.jpg`, type: 'image/jpeg', dataUrl };
}

export default function RegistrarVenta() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showSnackbar } = useOperatorSnackbar();
  const { can, isAdmin } = usePermissions();
  const afterSavePath = can('salesperson') && !can('order_management') ? '/mis-ventas' : '/orders';

  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saleSource, setSaleSource] = useState<SaleSource>('marketplace');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [documentRequest, setDocumentRequest] = useState<DocumentRequest>('none');
  const [boletaIdentity, setBoletaIdentity] = useState<BoletaIdentity>('dni');
  const [customerDocumentNumber, setCustomerDocumentNumber] = useState('');
  const [legalName, setLegalName] = useState('');
  const [fiscalAddress, setFiscalAddress] = useState('');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [delivery, setDelivery] = useState<'recojo' | 'envio'>('envio');
  const [deliveryDate, setDeliveryDate] = useState(limaTodayKey);
  const [shippingCarrier, setShippingCarrier] = useState<ShippingCarrier | ''>('');
  const [dropoffPlace, setDropoffPlace] = useState<MapPlace | null>(null);
  const [shippingNote, setShippingNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('despues');
  const [receivedBy, setReceivedBy] = useState('');
  const [paymentProof, setPaymentProof] = useState<PaymentProof | null>(null);
  const [creating, setCreating] = useState(false);

  const [stepId, setStepId] = useState<SaleStepId>('cliente');
  const [reachedIndex, setReachedIndex] = useState(0);
  const [stepError, setStepError] = useState('');

  useEffect(() => {
    api.listOrderChannelAccounts({ active: true }).then((accountRows) => {
      setAccounts(Array.isArray(accountRows) ? accountRows : []);
    }).catch((error: any) => {
      setLoadError(error?.message || 'No se pudo cargar el canal de venta manual.');
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSubmittedSearch(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  const productsQuery = useQuery({
    queryKey: ['sale-product-search', submittedSearch],
    queryFn: () => api.listCatalogProducts({
      search: submittedSearch || undefined,
      status: 'active',
      sortBy: 'updatedAt',
      sortDir: 'desc',
      limit: 12,
    }),
    enabled: pickerOpen,
    staleTime: 15_000,
  });

  const fleetQuery = useQuery({
    queryKey: ['own-fleet-config'],
    queryFn: api.getOwnFleetConfig,
    staleTime: 30_000,
  });
  const fleetConfig = fleetQuery.data;

  const manualAccount = useMemo(
    () => accounts.find((account) => account.channelCode === 'manual' && account.active) || null,
    [accounts],
  );
  const products = (productsQuery.data?.products || []) as CatalogProductForSale[];
  const shippingQuote = delivery === 'envio' && shippingCarrier === OWN_FLEET_CARRIER
    ? quoteOwnFleetShipping(dropoffPlace, fleetConfig)
    : null;
  const totals = saleTotals(saleLinesTotal(lines), shippingQuote);

  const saleInput: ManualSaleInput = {
    channelAccountId: manualAccount?.id,
    customerName,
    customerPhone,
    lines,
    delivery,
    deliveryDate,
    shippingCarrier,
    dropoffPlace,
    shippingNote,
    saleSource,
    paymentMethod,
    receivedBy,
    paymentProof,
    documentRequest,
    boletaIdentity,
    customerDocumentNumber,
    legalName,
    fiscalAddress,
  };

  const stepIndex = SALE_STEPS.findIndex((step) => step.id === stepId);
  const isLastStep = stepId === 'resumen';
  const blockingStep = firstInvalidSaleStep(saleInput, fleetConfig);
  const blockingMessage = blockingStep ? validateSaleStep(blockingStep, saleInput, fleetConfig) : null;

  const goToStep = (next: SaleStepId, error = '') => {
    setStepError(error);
    setStepId(next);
    setReachedIndex((current) => Math.max(current, SALE_STEPS.findIndex((step) => step.id === next)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goNext = () => {
    const error = validateSaleStep(stepId, saleInput, fleetConfig);
    if (error) {
      setStepError(error);
      return;
    }
    const next = SALE_STEPS[stepIndex + 1];
    if (next) goToStep(next.id);
  };

  const goBack = () => {
    const previous = SALE_STEPS[stepIndex - 1];
    if (previous) goToStep(previous.id);
  };

  const stepStateOf = (id: SaleStepId): StepState => {
    if (id === stepId) return 'current';
    if (SALE_STEPS.findIndex((step) => step.id === id) > reachedIndex) return 'pending';
    return validateSaleStep(id, saleInput, fleetConfig) ? 'invalid' : 'done';
  };

  const addProduct = (product: CatalogProductForSale) => {
    const price = productPrice(product);
    setStepError('');
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...current, {
        id: `${product.id}-${Date.now()}`,
        productId: product.id,
        sku: String(product.mainSku || '').trim(),
        name: product.name,
        imageUrl: product.imageUrl,
        shopSku: product.listings?.[0]?.shopSku || null,
        catalogPrice: price,
        unitPrice: price,
        quantity: 1,
      }];
    });
    setSearch('');
    setSubmittedSearch('');
    setPickerOpen(false);
  };

  const attachProof = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showSnackbar({ message: 'La constancia debe ser una foto o captura.', tone: 'error', duration: 6000 });
      return;
    }
    void readPaymentProof(file)
      .then(setPaymentProof)
      .catch((error: Error) => {
        showSnackbar({
          message: humanizeSaleError(error.message || 'No se pudo adjuntar la constancia.'),
          tone: 'error',
          duration: 6000,
        });
      });
  };

  const registerSale = async () => {
    if (blockingStep) {
      goToStep(blockingStep, blockingMessage || '');
      return;
    }

    let payload;
    try {
      payload = buildManualSaleOrderPayload(saleInput, fleetConfig);
    } catch (error: any) {
      setStepError(humanizeSaleError(error?.message));
      return;
    }

    const registered = {
      number: payload.externalOrderNumber,
      customer: String(payload.customer?.name || customerName).trim(),
      total: Number(payload.total) || 0,
    };
    const optimisticSale = buildOptimisticSale({
      orderNumber: registered.number,
      customerName: registered.customer,
      total: registered.total,
      paymentMethod,
      orderedAt: payload.orderedAt,
    });
    const previousHome = queryClient.getQueryData<OptimisticHome>(['salesperson-home']);
    queryClient.setQueryData<OptimisticHome>(['salesperson-home'], (current) => (
      applyOptimisticSale(current ?? previousHome, optimisticSale, Number(previousHome?.commissionPercent) || 0)
    ));

    // Optimistic: show the list with the new sale right away, then confirm in the background.
    setCreating(true);
    navigate(afterSavePath, { replace: true, state: { registered } });

    try {
      await api.createManagedOrder(payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['salesperson-home'] }),
        queryClient.invalidateQueries({ queryKey: ['managed-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['managed-order-sales-pulse'] }),
      ]);
    } catch (error: any) {
      queryClient.setQueryData(['salesperson-home'], previousHome);
      navigate(afterSavePath, { replace: true, state: { saveFailed: true, saveError: error?.message } });
    } finally {
      setCreating(false);
    }
  };

  const channelMissing = !loadError && accounts.length > 0 && !manualAccount;
  const setupError = loadError
    ? humanizeSaleError(loadError)
    : channelMissing
      ? 'Todavía no hay un canal de venta manual habilitado.'
      : '';
  const submitDisabled = creating || !!loadError || channelMissing;

  const view: SaleFormView = {
    isAdmin,
    saleSource,
    setSaleSource,
    customerName,
    setCustomerName: (value) => {
      setCustomerName(value);
      setStepError('');
    },
    customerPhone,
    setCustomerPhone,
    documentRequest,
    setDocumentRequest,
    boletaIdentity,
    setBoletaIdentity,
    customerDocumentNumber,
    setCustomerDocumentNumber: (value) => {
      setCustomerDocumentNumber(value);
      setStepError('');
    },
    legalName,
    setLegalName,
    fiscalAddress,
    setFiscalAddress,
    lines,
    setLines,
    updateLine: (id, patch) => {
      setStepError('');
      setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
    },
    removeLine: (id) => setLines((current) => current.filter((line) => line.id !== id)),
    delivery,
    setDelivery,
    deliveryDate,
    setDeliveryDate: (value) => {
      setDeliveryDate(value);
      setStepError('');
    },
    shippingCarrier,
    setShippingCarrier: (value) => {
      setShippingCarrier(value);
      setStepError('');
    },
    dropoffPlace,
    setDropoffPlace: (place) => {
      setDropoffPlace(place);
      setStepError('');
    },
    shippingNote,
    setShippingNote,
    paymentMethod,
    setPaymentMethod,
    receivedBy,
    setReceivedBy,
    paymentProof,
    setPaymentProof,
    attachProof,
    openProductPicker: () => setPickerOpen(true),
    fleetOrigin: fleetConfig?.origin ?? null,
    shippingQuote,
    totals,
    goToStep,
    navigate,
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (isLastStep) {
          void registerSale();
          return;
        }
        goNext();
      }}
      className="mx-auto max-w-3xl pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-4"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="-ml-2 h-9 shrink-0 cursor-pointer px-2 text-muted-foreground hover:text-foreground"
            onClick={() => navigate(afterSavePath)}
          >
            <ArrowLeft /> Volver
          </Button>
          <p className="ml-auto text-xs text-muted-foreground tabular-nums">
            Paso {stepIndex + 1} de {SALE_STEPS.length}
          </p>
        </div>

        <SaleStepper steps={SALE_STEPS} current={stepId} stateOf={stepStateOf} onSelect={goToStep} />

        {setupError && (
          <p className="rounded-md bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive ring-1 ring-destructive/20">
            {setupError}
          </p>
        )}

        {stepId === 'cliente' && <ClienteStep view={view} />}
        {stepId === 'productos' && <ProductosStep view={view} />}
        {stepId === 'entrega' && <EntregaStep view={view} />}
        {stepId === 'pago' && <PagoStep view={view} />}
        {stepId === 'resumen' && (
          <ResumenStep view={view} blockingMessage={blockingMessage} blockingStep={blockingStep} />
        )}

        {stepError ? (
          <p className="rounded-md bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive ring-1 ring-destructive/20">
            {stepError}
          </p>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/90 sm:static sm:z-auto sm:mt-3 sm:rounded-md sm:border sm:border-border sm:bg-card sm:px-4 sm:py-3 sm:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl items-center gap-3 pb-[env(safe-area-inset-bottom)]">
          {/* El resumen ya muestra el desglose completo; aquí solo se repite mientras se arma la venta. */}
          {!isLastStep && totals.total > 0 ? (
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {totals.shipping > 0 ? `Productos ${formatSaleMoney(totals.products)} · Envío ${formatSaleMoney(totals.shipping)}` : 'Total'}
              </p>
              <p className="truncate text-xl font-semibold tracking-tight tabular-nums">{formatSaleMoney(totals.total)}</p>
            </div>
          ) : (
            <div className="flex-1" aria-hidden="true" />
          )}
          {stepIndex > 0 ? (
            <Button type="button" variant="outline" className="h-11 shrink-0 cursor-pointer sm:h-9" onClick={goBack}>
              Atrás
            </Button>
          ) : null}
          {isLastStep ? (
            <Button type="submit" className="h-11 shrink-0 cursor-pointer sm:h-9" disabled={submitDisabled}>
              {creating ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Banknote />}
              {creating ? 'Listo…' : 'Registrar venta'}
            </Button>
          ) : (
            <Button type="submit" className="h-11 shrink-0 cursor-pointer sm:h-9">
              Continuar <ArrowRight />
            </Button>
          )}
        </div>
      </div>

      <ProductSearchPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        search={search}
        onSearchChange={setSearch}
        onSubmitSearch={() => setSubmittedSearch(search.trim())}
        products={products}
        isFetching={productsQuery.isFetching}
        submittedSearch={submittedSearch}
        onSelect={addProduct}
      />
    </form>
  );
}
