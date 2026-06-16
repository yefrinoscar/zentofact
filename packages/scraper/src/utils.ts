import { mkdirSync } from 'fs';

export function parseAmount(raw: string): number {
  const cleaned = raw
    .replace(/S\/\.?\s*/gi, '')
    .replace(/[^0-9,.\-]/g, '')
    .trim();
  if (!cleaned) return 0;
  const num = parseFloat(cleaned.replace(/,/g, ''));
  if (isNaN(num)) throw new Error(`No se pudo parsear monto: "${raw}"`);
  return Math.round(num * 100) / 100;
}

export function splitIgv(
  total: number,
  porcentajeIgv: number,
): { base: number; igv: number } {
  const factor = 1 + porcentajeIgv / 100;
  const base = Math.round((total / factor) * 100) / 100;
  const igv = Math.round((total - base) * 100) / 100;
  return { base, igv };
}

export function parseUserDate(raw: string): string {
  const trimmed = raw.trim();
  const ddmmyyyy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const yyyymmdd = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(trimmed);
  if (yyyymmdd) {
    const [, y, m, d] = yyyymmdd;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return trimmed;
}

export function cleanText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}
