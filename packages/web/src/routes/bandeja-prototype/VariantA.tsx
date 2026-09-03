// A — Plazo abajo, como Falabella. Listos se queda arriba.
import { DeadlineBelow } from './DeadlineBoard';
import type { BandejaView } from './shared';

export function VariantA({ view }: { view: BandejaView }) {
  return <DeadlineBelow view={view} />;
}
