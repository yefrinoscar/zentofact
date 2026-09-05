export const DEFAULT_API_BASE = 'https://api.mercadolibre.com';
export const DEFAULT_AUTH_HOST = 'https://auth.mercadolibre.com.pe';
export const DEFAULT_TOKEN_PATH = '/oauth/token';

export function objectRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function nonEmptyText(value: unknown): string | null {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text || null;
}

export function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function isoDate(value: unknown): string | null {
  const text = nonEmptyText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); }
  catch { return { message: text }; }
}

export function providerError(status: number, body: unknown) {
  const record = objectRecord(body);
  const message = nonEmptyText(record?.message ?? record?.error_description ?? record?.error);
  return new Error(`Mercado Libre respondió HTTP ${status}${message ? `: ${message}` : ''}`);
}

export function attributeValue(attributes: unknown, id: string): string | null {
  if (!Array.isArray(attributes)) return null;
  for (const entry of attributes) {
    const attribute = objectRecord(entry);
    if (!attribute) continue;
    if (nonEmptyText(attribute.id) !== id) continue;
    return nonEmptyText(attribute.value_name ?? attribute.value_id);
  }
  return null;
}
