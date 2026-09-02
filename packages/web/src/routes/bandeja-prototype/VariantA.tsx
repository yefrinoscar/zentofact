// A — El tablero B, con Imprimir n discreto en cada columna.
import { Board } from './Board';
import type { BandejaView } from './shared';

export function VariantA({ view }: { view: BandejaView }) {
  return <Board view={view} />;
}
