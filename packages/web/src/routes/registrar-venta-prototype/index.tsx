import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProductSearchPicker } from '../../components/ProductSearchPicker';
import { PrototypeSwitcher } from '../../components/PrototypeSwitcher';
import { PROTOTYPE_VARIANTS, type PrototypeKey, type SaleFormView } from './view';
import { Variant1, Variant2, Variant3, Variant4, Variant5 } from './variants';

const VARIANTS: Record<PrototypeKey, (props: { view: SaleFormView }) => React.JSX.Element> = {
  1: Variant1,
  2: Variant2,
  3: Variant3,
  4: Variant4,
  5: Variant5,
};

export function RegistrarVentaPrototype({ view }: { view: SaleFormView }) {
  const [params, setParams] = useSearchParams();
  const raw = String(params.get('variant') || '1');
  const current = (PROTOTYPE_VARIANTS.some((variant) => variant.key === raw) ? raw : '1') as PrototypeKey;
  const Variant = VARIANTS[current];

  const filled = useRef(false);
  useEffect(() => {
    if (filled.current) return;
    filled.current = true;
    view.fillDemo();
  }, [view]);

  return (
    <form onSubmit={view.submit} className="pb-[calc(8rem+env(safe-area-inset-bottom))]">
      {/* PROTOTYPE — cinco steppers en grises de DESIGN.md, `?variant=1`…`5`. */}
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
