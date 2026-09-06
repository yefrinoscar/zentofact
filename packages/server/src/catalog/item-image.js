function firstMediaUrl(value) {
  const entries = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const url = String(entry.dam_url || entry.damUrl || entry.media_url || entry.mediaUrl || '').trim();
    if (url) return url;
  }
  return '';
}

function firstNestedImage(value) {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  if (value && typeof value === 'object' && Array.isArray(value.Image)) {
    return String(value.Image[0] || '').trim();
  }
  return '';
}

/** Falabella usa Image/ImageUrl. Ripley/Mirakl OR11 guarda product_medias[].media_url. */
export function marketplaceItemImageUrl(raw = {}, extra = {}) {
  return String(
    extra.imageUrl
    || raw.Image
    || raw.ImageUrl
    || raw.ImageURL
    || raw.ProductImage
    || raw.MainImage
    || firstNestedImage(raw.Images)
    || extra.metaImageUrl
    || firstMediaUrl(raw.product_medias)
    || firstMediaUrl(raw.productMedias)
    || firstMediaUrl(raw.product_media)
    || firstMediaUrl(raw.productMedia)
    || '',
  ).trim();
}

export const MARKETPLACE_RAW_IMAGE_SQL = `
  nullif(oi.raw_data->>'Image', ''),
  nullif(oi.raw_data->>'ImageUrl', ''),
  nullif(oi.raw_data->>'ImageURL', ''),
  nullif(oi.raw_data->>'ProductImage', ''),
  nullif(oi.raw_data->>'MainImage', ''),
  nullif(oi.raw_data#>>'{Images,Image,0}', ''),
  nullif(oi.raw_data#>>'{Images,0}', ''),
  nullif(oi.raw_data->'product_medias'->0->>'dam_url', ''),
  nullif(oi.raw_data->'product_medias'->0->>'media_url', ''),
  nullif(oi.raw_data->'product_media'->>'dam_url', ''),
  nullif(oi.raw_data->'product_media'->>'media_url', '')
`;
