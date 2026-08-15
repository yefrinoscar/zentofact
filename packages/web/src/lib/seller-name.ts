export function sellerShortName(value?: string | null) {
  const fallback = String(value || '').trim();
  if (!fallback) return 'Seller';

  const shortName = fallback
    .replace(/\s+(?:E\.?\s*I\.?\s*R\.?\s*L\.?|S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?\s*C\.?)\.?$/i, '')
    .replace(/\s+PER[ÚU]$/i, '')
    .replace(/^(?:INVERSIONES|IMPORTACIONES|TIENDAS)\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return shortName
    .toLocaleLowerCase('es-PE')
    .replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('es-PE'));
}
