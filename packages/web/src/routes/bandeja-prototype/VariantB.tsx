// B — El tablero B, con Imprimir n bien visible en cada plazo.
import { Board } from './Board';
import type { BandejaView } from './shared';

export function VariantB({ view }: { view: BandejaView }) {
  return <Board view={view} emphasizePrint />;
}
