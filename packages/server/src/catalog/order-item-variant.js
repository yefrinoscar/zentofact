// Detecta color y talla de una línea de pedido de marketplace a partir de los
// atributos que el canal envía (Falabella `Variation`, Mercado Libre
// `variation_attributes`, claves Size/Talla/Color), con respaldo en la caché de
// variantes Falabella, la metadata del listing y, al final, el título.

const SIZE_TOKEN = '(?:xxxl|xxl|xxs|xl|xs|s|m|l|[2-9]xl|unica|u)';
const SIZE_ONLY_RE = new RegExp(`^${SIZE_TOKEN}$|^\\d{2,3}(?:[.,]\\d)?$|^\\d{1,2}\\s*[-/]\\s*\\d{1,2}$`, 'i');
const EMPTY_RE = /^(?:\.{2,}|-+|n\/?a|null|undefined|sin variaci[oó]n|ninguno|ninguna)$/i;
const TALLA_PREFIX_RE = /^(?:talla|size|tamano|tamaño)\s*[:\-]?\s*/i;

function fold(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function attributeKey(value) {
  return fold(value).replace(/[^a-z0-9]+/g, '');
}

function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).trim();
  return EMPTY_RE.test(text) ? '' : text;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

/**
 * Normaliza una talla. Ignora cantidades de pack de un dígito ("1"), que
 * Falabella a veces envía en el atributo size.
 */
export function cleanSize(value) {
  const text = cleanText(value).replace(TALLA_PREFIX_RE, '').trim();
  if (!text || /^\d$/.test(text)) return '';
  return text.length <= 12 ? text.toUpperCase() : text;
}

function isSizeKey(key) {
  return key === 'size' || key === 'sizename' || key.includes('talla') || key === 'tamano';
}

function isColorKey(key) {
  return key.includes('color') || key.includes('colour');
}

function objectValue(entry) {
  if (entry == null || typeof entry !== 'object') return entry;
  return entry.value_name ?? entry.valueName ?? entry.Value ?? entry.value ?? entry.Name ?? entry.name ?? entry.label ?? entry.Label;
}

/** Recorre atributos estructurados buscando color/talla. */
function structuredVariant(source) {
  const found = { color: '', size: '', loose: [] };
  const visited = new Set();
  const visit = (current, depth = 0) => {
    current = parseMaybeJson(current);
    if (current == null || depth > 6 || (found.color && found.size)) return;
    if (typeof current === 'string' || typeof current === 'number') {
      const text = cleanText(current);
      if (text) found.loose.push(text);
      return;
    }
    if (typeof current !== 'object' || visited.has(current)) return;
    visited.add(current);
    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry, depth + 1));
      return;
    }

    // Forma { name: 'Talla', value_name: 'M' } / { AttributeName: 'Size', Value: 'M' }.
    const nameKey = attributeKey(current.AttributeName ?? current.attributeName ?? current.Name ?? current.name
      ?? current.Key ?? current.key ?? current.Label ?? current.label ?? current.id);
    const pairValue = current.value_name ?? current.valueName ?? current.Value ?? current.value
      ?? current.ValueName ?? current.Option ?? current.option;
    if (nameKey && pairValue != null) {
      if (isSizeKey(nameKey)) found.size ||= cleanSize(objectValue(pairValue));
      else if (isColorKey(nameKey)) found.color ||= cleanText(objectValue(pairValue));
    }

    for (const [key, entry] of Object.entries(current)) {
      const normalized = attributeKey(key);
      if (isSizeKey(normalized)) found.size ||= cleanSize(objectValue(entry));
      else if (isColorKey(normalized)) found.color ||= cleanText(objectValue(entry));
    }
    for (const entry of Object.values(current)) {
      if (entry && typeof entry === 'object') visit(entry, depth + 1);
      else if (typeof entry === 'string' && /^[[{]/.test(entry.trim())) visit(entry, depth + 1);
    }
  };
  visit(source);
  return found;
}

/**
 * Interpreta un valor de variación sin clave, por ejemplo Falabella
 * `Variation: "M"`, `"Talla L"` o `"Negro / XL"`.
 */
export function looseVariant(value) {
  const text = cleanText(value);
  if (!text) return { color: '', size: '' };
  const stripped = text.replace(TALLA_PREFIX_RE, '').trim();
  if (SIZE_ONLY_RE.test(stripped)) return { color: '', size: cleanSize(stripped) };
  const parts = text.split(/\s*[,/|·]\s*|\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const sizePart = parts.find((part) => SIZE_ONLY_RE.test(part.replace(TALLA_PREFIX_RE, '').trim()));
  if (sizePart) {
    const color = parts.filter((part) => part !== sizePart).join(' ');
    return { color: cleanText(color), size: cleanSize(sizePart) };
  }
  const words = stripped.split(/\s+/);
  const last = words.at(-1) || '';
  if (words.length >= 2 && SIZE_ONLY_RE.test(last)) {
    return { color: cleanText(words.slice(0, -1).join(' ')), size: cleanSize(last) };
  }
  const explicit = new RegExp(`(?:^|\\s)talla\\s*:?\\s*(${SIZE_TOKEN}|\\d{2,3})(?:\\s|$)`, 'i').exec(text);
  return { color: '', size: explicit ? cleanSize(explicit[1]) : '' };
}

/** Talla escrita en el título solo cuando es explícita ("Talla M") o sufijo tras guion. */
export function sizeFromTitle(title) {
  const text = fold(title);
  const explicit = new RegExp(`(?:^|[^a-z0-9])talla\\s*:?\\s*(${SIZE_TOKEN}|\\d{2,3})(?:[^a-z0-9]|$)`).exec(text);
  if (explicit) return cleanSize(explicit[1]);
  const suffix = new RegExp(`\\s[-–—]\\s(?:[a-z]+\\s)?(${SIZE_TOKEN})\\s*$`).exec(text);
  return suffix ? cleanSize(suffix[1]) : '';
}

function rawSources(raw) {
  const value = parseMaybeJson(raw);
  if (!value || typeof value !== 'object') return [];
  return [
    value.Variation, value.variation, value.Variant, value.variant,
    value.Attributes, value.attributes, value.ProductAttributes, value.product_attributes,
    value.item?.variation_attributes, value.variation_attributes,
    {
      Color: value.Color ?? value.ColorName ?? value.color,
      Size: value.Size ?? value.SizeName ?? value.Talla ?? value.size,
    },
  ];
}

/**
 * @param {object} input
 * @param {Array<object>|object} [input.raw]   raw_data de una o varias líneas del mismo SKU
 * @param {{color?: string, size?: string}} [input.cached]  falabella_product_variants
 * @param {object} [input.listingMetadata]
 * @param {string} [input.title]
 * @returns {{ color: string, size: string, label: string, source: string }}
 */
export function detectOrderItemVariant({ raw, cached, listingMetadata, title } = {}) {
  let color = '';
  let size = '';
  let source = '';
  const take = (candidate, from) => {
    const before = Boolean(size);
    color ||= candidate.color || '';
    size ||= candidate.size || '';
    if (!before && size) source = from;
  };

  const raws = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const entry of raws) {
    const structured = structuredVariant(rawSources(entry));
    take(structured, 'order');
    for (const loose of structured.loose) take(looseVariant(loose), 'order');
    if (color && size) break;
  }
  if (cached) take({ color: cleanText(cached.color), size: cleanSize(cached.size) }, 'variant_cache');
  if (listingMetadata) {
    const meta = parseMaybeJson(listingMetadata) || {};
    take({ color: cleanText(meta.color), size: cleanSize(meta.size) }, 'listing');
  }
  take({ color: '', size: sizeFromTitle(title) }, 'title');

  const label = [color, size ? `Talla ${size}` : ''].filter(Boolean).join(' · ');
  return { color, size, label, source: size ? source : '' };
}
