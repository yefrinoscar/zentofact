// Tres estructuras para decidir dónde vive el plazo y dónde Listos.
// Pregunta: ¿filtros de plazo arriba, o se queda el tablero con Pendientes / Listos?
export { VariantA } from './VariantA';
export { VariantB } from './VariantB';
export { VariantC } from './VariantC';
export type { BandejaView, LogisticsItem, LogisticsOrder } from './shared';

export const BANDEJA_PROTOTYPE_VARIANTS = [
  { key: 'A', name: 'Plazo abajo' },
  { key: 'B', name: 'Columnas' },
  { key: 'C', name: 'Plazo arriba' },
] as const;
