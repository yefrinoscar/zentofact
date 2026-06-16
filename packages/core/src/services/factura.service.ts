import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { facturas } from '../db/schema';
import { saveFacturaPdf } from './file.service';

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export interface RecordFacturaUploadInput {
  companyId: number;
  branchId?: number | null;
  orderNumber: string;
  numeroCompleto: string;
  fechaEmision: string;
  pdfBuffer: Buffer;
  source?: string;
  orderItemIds?: string[];
  respuestaFalabella?: unknown;
}

export async function recordFacturaUpload(input: RecordFacturaUploadInput) {
  const ts = now();
  const pdfPath = saveFacturaPdf({
    numeroCompleto: input.numeroCompleto,
    fechaEmision: input.fechaEmision,
    orderNumber: input.orderNumber,
  }, input.pdfBuffer);

  const existingRows = await db.select().from(facturas).where(and(
    eq(facturas.companyId, input.companyId),
    eq(facturas.orderNumber, input.orderNumber),
    eq(facturas.numeroCompleto, input.numeroCompleto),
  )).orderBy(desc(facturas.id)).limit(1);
  const existing = existingRows[0];

  if (existing) {
    const updated = await db.update(facturas).set({
      branchId: input.branchId ?? existing.branchId ?? null,
      fechaEmision: input.fechaEmision,
      pdfPath,
      fuente: input.source || existing.fuente || 'manual',
      estado: 'REGISTRADO',
      orderItemIds: input.orderItemIds || existing.orderItemIds || null,
      respuestaFalabella: input.respuestaFalabella ? JSON.stringify(input.respuestaFalabella) : existing.respuestaFalabella,
      updatedAt: ts,
    }).where(eq(facturas.id, existing.id)).returning();

    return updated[0];
  }

  const inserted = await db.insert(facturas).values({
    companyId: input.companyId,
    branchId: input.branchId ?? null,
    tipoDocumento: '01',
    numeroCompleto: input.numeroCompleto,
    orderNumber: input.orderNumber,
    fechaEmision: input.fechaEmision,
    pdfPath,
    fuente: input.source || 'manual',
    estado: 'REGISTRADO',
    orderItemIds: input.orderItemIds || null,
    respuestaFalabella: input.respuestaFalabella ? JSON.stringify(input.respuestaFalabella) : null,
    createdAt: ts,
    updatedAt: ts,
  }).returning();

  return inserted[0];
}
