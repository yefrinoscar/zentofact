import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProductSearchPicker } from '../../components/ProductSearchPicker';
import { PrototypeSwitcher } from '../../components/PrototypeSwitcher';
import { PROTOTYPE_VARIANTS, type PrototypeKey, type SaleFormView } from './view';
import {
  VariantA,
  VariantB,
  VariantC,
  VariantD,
  VariantE,
  VariantF,
  VariantG,
  VariantH,
  VariantI,
  VariantJ,
} from './variants';

const VARIANTS: Record<PrototypeKey, (props: { view: SaleFormView }) => React.JSX.Element> = {
  A: VariantA,
  B: VariantB,
  C: VariantC,
  D: VariantD,
  E: VariantE,
  F: VariantF,
  G: VariantG,
  H: VariantH,
  I: VariantI,
  J: VariantJ,
};

export function RegistrarVentaPrototype({ view }: { view: SaleFormView }) {
  const [params, setParams] = useSearchParams();
  const raw = String(params.get('variant') || 'A').toUpperCase();
  const current = (PROTOTYPE_VARIANTS.some((variant) => variant.key === raw) ? raw : 'A') as PrototypeKey;
  const Variant = VARIANTS[current];

  const filled = useRef(false);
  useEffect(() => {
    if (filled.current) return;
    if (!view.customerName && view.lines.length === 0) {
      filled.current = true;
      view.fillDemo();
    }
  }, [view]);

  return (
    <form onSubmit={view.submit} className="pb-[calc(8rem+env(safe-area-inset-bottom))]">
      {/* PROTOTYPE — throwaway. Ten layouts of Nueva venta, `?variant=A`…`J`. */}
      {view.setupError ? (
        <p className="mb-4 text-sm text-destructive">{view.setupError}</p>
      ) : null}
      <Variant view={view} />
      <ProductSearchPicker
        open={view.pickerOpen}
        onOpenChange={view.setPickerOpen}
        search={view.search}
        onSearchChange={view.setSearch}
        onSubmitSearch={view.submitProductSearch}
        products={view.products}
        isFetching={view.productsFetching}
        submittedSearch={view.submittedSearch}
        onSelect={view.addProduct}
      />
      <PrototypeSwitcher
        variants={[...PROTOTYPE_VARIANTS]}
        current={current}
        onChange={(key) => {
          const next = new URLSearchParams(params);
          next.set('variant', key);
          setParams(next, { replace: true });
        }}
      />
    </form>
  );
}
