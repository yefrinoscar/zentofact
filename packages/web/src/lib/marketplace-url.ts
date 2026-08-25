const FALABELLA_HOST = /(^|\.)falabella\.com\.pe$/i;
const RIPLEY_PRODUCT_SKU = /^(PMP\d+)(?:-\d+)?$/i;

type MarketplaceProductUrlInput = {
  channelCode: unknown;
  metadata?: Record<string, unknown> | null;
  shopSku?: unknown;
  title?: unknown;
};

function falabellaProductUrl(metadata?: Record<string, unknown> | null) {
  const candidate = String(metadata?.url || '').trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !FALABELLA_HOST.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function ripleyProductUrl(title: unknown, shopSku: unknown) {
  const productSku = RIPLEY_PRODUCT_SKU.exec(String(shopSku || '').trim())?.[1]?.toLowerCase();
  if (!productSku) return null;

  const slug = String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return null;

  return `https://simple.ripley.com.pe/${slug}-${productSku}`;
}

export function marketplaceProductUrl({ channelCode, metadata, shopSku, title }: MarketplaceProductUrlInput) {
  const channel = String(channelCode || '').trim().toLowerCase();
  if (channel === 'falabella') return falabellaProductUrl(metadata);
  if (channel === 'ripley') return ripleyProductUrl(title, shopSku);
  return null;
}
