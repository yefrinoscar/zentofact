// B — Tablero por plazo real, Imprimir n en cada columna.
import { Board } from './Board';
import type { BandejaView } from './shared';

export function VariantB({ view }: { view: BandejaView }) {
  return <Board view={view} emphasizePrint />;
}
