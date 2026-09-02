// Tres refinamientos del tablero B, switchable via ?variant=, en /#/bandeja.
// Pregunta: ¿cómo se imprime un plazo entero (vencen hoy) sin ensuciar el tablero?
// Tabs: los nuestros (subrayado). La lista es lo principal.
export { VariantA } from './VariantA';
export { VariantB } from './VariantB';
export { VariantC } from './VariantC';
export type { BandejaView, LogisticsItem, LogisticsOrder } from './shared';

export const BANDEJA_PROTOTYPE_VARIANTS = [
  { key: 'A', name: 'Columnas' },
  { key: 'B', name: 'Por plazo' },
  { key: 'C', name: 'Limpio' },
] as const;
