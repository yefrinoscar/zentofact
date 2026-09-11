import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function decodePdf(base64) {
  const text = String(base64 || '');
  const payload = text.includes(',') ? text.slice(text.lastIndexOf(',') + 1) : text;
  return Buffer.from(payload, 'base64');
}

export async function listPrinters() {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const { stdout } = await exec('lpstat', ['-a']);
    return stdout.split('\n').map((line) => line.split(/\s+/)[0]).filter(Boolean);
  }
  throw new Error('Lista de impresoras disponible en macOS y Linux con CUPS (lpstat).');
}

export async function printPdf({ pdf, printer, filename, dryRun = false }) {
  const bytes = Buffer.isBuffer(pdf) ? pdf : decodePdf(pdf);
  if (!bytes.length) throw new Error('El PDF de etiquetas llegó vacío.');
  const dir = join(homedir(), '.zentofact-print');
  await mkdir(dir, { recursive: true });
  const target = join(dryRun ? dir : tmpdir(), filename || `bandeja-${Date.now()}.pdf`);
  await writeFile(target, bytes);
  if (dryRun) return { ok: true, dryRun: true, path: target };
  const name = String(printer || '').trim();
  if (!name) throw new Error('Indica la impresora con --printer o ZENTOFACT_PRINTER.');
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error('El agente imprime con lp en macOS o Linux.');
  }
  await exec('lp', ['-d', name, '-o', 'media=A4', '-o', 'fit-to-page', target]);
  return { ok: true, dryRun: false, path: target, printer: name };
}
