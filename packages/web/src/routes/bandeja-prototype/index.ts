// Tres refinamientos del tablero B (las columnas no se tocan).
// Pregunta: ¿cómo se ve Imprimir el plazo (vencen hoy) sobre el tablero?
export { VariantA } from './VariantA';
export { VariantB } from './VariantB';
export { VariantC } from './VariantC';
export type { BandejaView, LogisticsItem, LogisticsOrder } from './shared';

export const BANDEJA_PROTOTYPE_VARIANTS = [
  { key: 'A', name: 'Imprimir suave' },
  { key: 'B', name: 'Imprimir grupo' },
  { key: 'C', name: 'Solo el grupo' },
] as const;
