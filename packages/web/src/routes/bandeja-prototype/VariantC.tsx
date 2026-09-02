// C — El tablero B, más limpio: imprime el grupo, sin botón en cada tarjeta.
import { Board } from './Board';
import type { BandejaView } from './shared';

export function VariantC({ view }: { view: BandejaView }) {
  return <Board view={view} emphasizePrint showRowAction={false} />;
}
