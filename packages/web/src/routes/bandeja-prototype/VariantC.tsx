// C — Plazo arriba (vencidos / hoy / mañana). Listos va al lado, compacto.
import { DeadlineAbove } from './DeadlineBoard';
import type { BandejaView } from './shared';

export function VariantC({ view }: { view: BandejaView }) {
  return <DeadlineAbove view={view} />;
}
