// Ten variantes de la Bandeja, switchable via ?variant=, en /#/bandeja.
// Pregunta: ¿qué estructura le sirve al operador para preparar e imprimir?
export { VariantA } from './VariantA';
export { VariantB } from './VariantB';
export { VariantC } from './VariantC';
export { VariantD } from './VariantD';
export { VariantE } from './VariantE';
export { VariantF } from './VariantF';
export { VariantG } from './VariantG';
export { VariantH } from './VariantH';
export { VariantI } from './VariantI';
export { VariantJ } from './VariantJ';
export type { BandejaView, LogisticsItem, LogisticsOrder } from './shared';

export const BANDEJA_PROTOTYPE_VARIANTS = [
  { key: 'A', name: 'Estación' },
  { key: 'B', name: 'Tablero' },
  { key: 'C', name: 'Picking' },
  { key: 'D', name: 'Turno' },
  { key: 'E', name: 'Tickets' },
  { key: 'F', name: 'Uno a uno' },
  { key: 'G', name: 'Tabla' },
  { key: 'H', name: 'Canales' },
  { key: 'I', name: 'Tiendas' },
  { key: 'J', name: 'Impresión' },
] as const;
