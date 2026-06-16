import { createHmac } from 'crypto';

export function buildIsoUtcTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function canonicalizeParameters(parameters: Record<string, string>): string {
  return Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${rfc3986Encode(key)}=${rfc3986Encode(value)}`)
    .join('&');
}

export function signParameters(parameters: Record<string, string>, apiKey: string): string {
  const canonical = canonicalizeParameters(parameters);
  return createHmac('sha256', apiKey).update(canonical, 'utf8').digest('hex');
}
