// Tres tableros y tres filtros de etapa. El ganador se reescribe en BandejaLogistica.
export { VariantA } from './VariantA';
export { VariantB } from './VariantB';
export { VariantC } from './VariantC';
export { BANDEJA_STAGE_FILTERS } from './shared';
export type { BandejaView, LogisticsItem, LogisticsOrder } from './shared';

export const BANDEJA_PROTOTYPE_VARIANTS = [
  { key: 'A', name: 'Plazo abajo' },
  { key: 'B', name: 'Columnas' },
  { key: 'C', name: 'Plazo arriba' },
] as const;
