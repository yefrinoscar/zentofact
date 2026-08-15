const FALABELLA_HOST = /(^|\.)falabella\.com\.pe$/i;

export function falabellaProductUrl(
  channelCode: unknown,
  metadata?: Record<string, unknown> | null,
) {
  if (String(channelCode || '').trim().toLowerCase() !== 'falabella') return null;

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
