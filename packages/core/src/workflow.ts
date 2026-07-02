import { db } from './db';
import { boletas, branches, companies, dailySummaries } from './db/schema';
import { eq, and } from 'drizzle-orm';
import { createBoleta, sendBoletasAsDailySummary, sendBoletaToSunat } from './services/boleta.service';
import type { DetalleItem } from './utils/tax-calculator';
import type { CoreConfig, VentaItem, WorkflowResult, WorkflowProgress } from './index';

async function ensureSetup(config: CoreConfig) {
  const now = Math.floor(Date.now() / 1000);

  // Ensure company
  let company = config.companyId
    ? (await db.select().from(companies).where(eq(companies.id, config.companyId)).limit(1))[0]
    : (await db.select().from(companies).where(eq(companies.ruc, config.ruc)).limit(1))[0];
  if (!company) {
    const insertedCompany = await db.insert(companies).values({
      ruc: config.ruc,
      razonSocial: config.razonSocial,
      direccion: config.direccion,
      ubigeo: config.ubigeo,
      usuarioSol: config.usuarioSol,
      claveSol: config.claveSol,
      certificado: config.certificadoBase64,
      certificadoPassword: config.certificadoPassword,
      modoProduccion: config.modoProduccion ?? false,
      activo: true,
      createdAt: now,
      updatedAt: now,
    }).returning();
    company = insertedCompany[0];
  } else {
    await db.update(companies).set({
      razonSocial: config.razonSocial,
      direccion: config.direccion,
      ubigeo: config.ubigeo,
      usuarioSol: config.usuarioSol,
      claveSol: config.claveSol,
      certificado: config.certificadoBase64,
      certificadoPassword: config.certificadoPassword,
      modoProduccion: config.modoProduccion ?? false,
      updatedAt: now,
    }).where(eq(companies.id, company.id));
  }

  const branchCodigo = config.branchCodigo || '0001';
  const branchNombre = config.branchNombre || 'Principal';

  // Ensure branch
  let branch = config.branchId
    ? (await db.select().from(branches).where(and(
        eq(branches.id, config.branchId),
        eq(branches.companyId, company.id),
      )).limit(1))[0]
    : (await db.select().from(branches).where(and(
        eq(branches.companyId, company.id),
        eq(branches.codigo, branchCodigo),
      )).limit(1))[0];

  if (!branch) {
    const insertedBranch = await db.insert(branches).values({
      companyId: company.id,
      codigo: branchCodigo,
      nombre: branchNombre,
      direccion: config.direccion,
      ubigeo: config.ubigeo,
      activo: true,
      createdAt: now,
      updatedAt: now,
    }).returning();
    branch = insertedBranch[0];
  }

  return { companyId: company.id, branchId: branch.id };
}

export async function processWorkflow(
  config: CoreConfig,
  ventas: VentaItem[],
  onProgress?: WorkflowProgress,
): Promise<WorkflowResult> {
  process.env.STORAGE_PATH = config.outputDir;
  const { companyId, branchId } = await ensureSetup(config);
  const serie = config.serieBoleta || 'B001';
  const isProduction = config.modoProduccion ?? false;
  // Emisión de UNA sola boleta => envío INDIVIDUAL a SUNAT (así el nombre del cliente queda en el
  // registro; el resumen diario lo muestra como "-"). En lote se usa el resumen diario.
  const isIndividual = ventas.length === 1;

  const results: WorkflowResult['boletas'] = [];
  let exitosas = 0;
  let rechazadas = 0;
  const total = ventas.length;
  const pendingBoletaIds: number[] = [];
  const betaBoletaIds: number[] = [];
  const betaSummaryIds = new Set<number>();
  let summaryReferenceDate = '';

  for (let i = 0; i < ventas.length; i++) {
    const venta = ventas[i];
    const ventaSerie = venta.serie || serie;

    try {
      onProgress?.(i, total, `[${venta.client.razonSocial}] Creando boleta...`);

      const existing = isProduction && venta.orderNumber
        ? (await db.select().from(boletas).where(and(
            eq(boletas.companyId, companyId),
            eq(boletas.orderNumber, venta.orderNumber),
          )).limit(1))[0] || null
        : null;

      if (existing) {
        const summary = existing.dailySummaryId
          ? (await db.select().from(dailySummaries).where(eq(dailySummaries.id, existing.dailySummaryId)).limit(1))[0]
          : null;
        const summaryCanRetry = summary?.estado === 'RECHAZADO' || summary?.estado === 'ERROR';
        if (existing.estadoSunat === 'ACEPTADO' || (summary && !summaryCanRetry)) {
          const summaryResponse = summary
            ? formatSummaryMessage({
                numeroCompleto: summary.numeroCompleto,
                ticket: summary.ticket,
                status: {
                  estado: summary.estado,
                  responseCode: summary.responseCode,
                  responseDescription: summary.responseDescription,
                },
              })
            : undefined;
          results.push({
            numeroCompleto: existing.numeroCompleto,
            estadoSunat: 'OMITIDO',
            pdfPath: existing.pdfPath || '',
            xmlPath: existing.xmlPath || '',
            orderNumber: existing.orderNumber || undefined,
            summaryId: summary?.id,
            summaryNumero: summary?.numeroCompleto || undefined,
            summaryTicket: summary?.ticket || undefined,
            summaryEstado: summary?.estado || undefined,
            summaryResponseCode: summary?.responseCode || undefined,
            summaryResponse,
            error: summary
              ? `Orden ${venta.orderNumber} ya está vinculada al resumen ${summary.numeroCompleto}. No se volvió a enviar a SUNAT.`
              : `Orden ${venta.orderNumber} ya fue informada en un resumen diario.`,
          });
          continue;
        }

        if (summaryCanRetry) {
          await db.update(boletas).set({
            dailySummaryId: null,
            estadoSunat: 'PENDIENTE',
            updatedAt: Math.floor(Date.now() / 1000),
          }).where(eq(boletas.id, existing.id));
          existing.dailySummaryId = null;
          existing.estadoSunat = 'PENDIENTE';
        }
      }

      // Crear boleta con zero IGV si es exonerado
      const detalles: DetalleItem[] = venta.detalles.map(d => ({
        codigo: d.codigo,
        descripcion: d.descripcion,
        unidad: d.unidad,
        cantidad: d.cantidad,
        mto_valor_unitario: d.mtoValorUnitario,
        ...(d.mtoBruto != null ? { mto_bruto: d.mtoBruto } : {}),
        porcentaje_igv: d.porcentajeIgv,
        tip_afe_igv: d.tipAfeIgv,
      }));

      const boleta = existing || await createBoleta({
        company_id: companyId,
        branch_id: branchId,
        order_number: venta.orderNumber,
        serie: ventaSerie,
        fecha_emision: venta.fechaEmision,
        moneda: venta.moneda || 'PEN',
        metodo_envio: isIndividual ? 'individual' : 'resumen_diario',
        client: {
          tipo_documento: venta.client.tipoDocumento,
          numero_documento: venta.client.numeroDocumento,
          razon_social: venta.client.razonSocial,
          direccion: venta.client.direccion,
        },
        detalles,
        // Beta: no avanzar el contador de correlativo (solo prueba).
        persistCorrelative: isProduction,
      });

      pendingBoletaIds.push(boleta.id);
      if (!isProduction) betaBoletaIds.push(boleta.id);
      if (!summaryReferenceDate) summaryReferenceDate = boleta.fechaEmision;
    } catch (e: any) {
      rechazadas++;
      results.push({
        numeroCompleto: `ERROR-${i + 1}`,
        estadoSunat: 'RECHAZADO',
        pdfPath: '',
        xmlPath: '',
        error: e.message,
      });
      break;
    }
  }

  if (pendingBoletaIds.length > 0) {
    const boletaIds = Array.from(new Set(pendingBoletaIds));

    if (isIndividual && boletaIds.length === 1) {
    // Envío INDIVIDUAL a SUNAT: la boleta se acepta al instante con su CDR y el nombre del cliente queda registrado.
    const id = boletaIds[0];
    onProgress?.(total, total, 'Enviando boleta a SUNAT (individual)...');
    let sendError = '';
    try {
      const r = await sendBoletaToSunat(id);
      if (!r.success) sendError = r.message || 'Rechazado por SUNAT';
    } catch (e: any) {
      sendError = e?.message || 'Error al enviar a SUNAT';
    }
    const b = (await db.select().from(boletas).where(eq(boletas.id, id)).limit(1))[0];
    const estado = String(b?.estadoSunat || '').toUpperCase();
    if (estado === 'ACEPTADO') exitosas++; else rechazadas++;
    results.push({
      numeroCompleto: b?.numeroCompleto || '',
      estadoSunat: (estado || 'RECHAZADO') as any,
      pdfPath: '',
      xmlPath: b?.xmlPath || '',
      orderNumber: b?.orderNumber || undefined,
      error: estado === 'ACEPTADO' ? undefined : (sendError || 'Rechazado por SUNAT'),
    });
    } else {
    const progressScope = summaryReferenceDate || 'Resumen diario';

    onProgress?.(total, total, `[${progressScope}] Enviando resumen diario a SUNAT...`);
    const summaryResult = await sendBoletasAsDailySummary(
      companyId,
      branchId,
      summaryReferenceDate,
      boletaIds,
      (message) => onProgress?.(total, total, `[${progressScope}] ${message}`),
    );
    const summaryMessage = formatSummaryMessage(summaryResult);
    const summaryStatus: any = summaryResult.status || {};
    if (!isProduction && summaryResult.summaryId) betaSummaryIds.add(summaryResult.summaryId);

    if (!summaryResult.success) {
      rechazadas += boletaIds.length;
      for (const id of boletaIds) {
        const rejected = (await db.select().from(boletas).where(eq(boletas.id, id)).limit(1))[0];
        if (!rejected) continue;
        results.push({
          numeroCompleto: rejected.numeroCompleto,
          estadoSunat: 'RECHAZADO',
          pdfPath: '',
          xmlPath: '',
          orderNumber: rejected.orderNumber || undefined,
          summaryId: summaryResult.summaryId,
          summaryNumero: summaryResult.numeroCompleto,
          summaryTicket: summaryResult.ticket,
          summaryEstado: summaryResult.status?.estado || 'RECHAZADO',
          summaryResponseCode: summaryResult.status?.responseCode || summaryResult.error?.code,
          summaryResponse: summaryMessage,
          error: summaryMessage,
        });
      }
    } else if (summaryResult.status?.estado !== 'ACEPTADO') {
      for (const id of boletaIds) {
        const pending = (await db.select().from(boletas).where(eq(boletas.id, id)).limit(1))[0];
        if (!pending) continue;
        results.push({
          numeroCompleto: pending.numeroCompleto,
          estadoSunat: summaryResult.status?.estado || 'ENVIADO',
          pdfPath: '',
          xmlPath: '',
          orderNumber: pending.orderNumber || undefined,
          summaryId: summaryResult.summaryId,
          summaryNumero: summaryResult.numeroCompleto,
          summaryTicket: summaryResult.ticket,
          summaryEstado: summaryResult.status?.estado || 'ENVIADO',
          summaryResponseCode: summaryStatus.responseCode || summaryStatus.statusCode,
          summaryResponse: summaryMessage,
          error: summaryMessage,
        });
      }
    } else {
      for (const id of boletaIds) {
        const acceptedBoleta = (await db.select().from(boletas).where(eq(boletas.id, id)).limit(1))[0];
        if (!acceptedBoleta) continue;
        exitosas++;
        results.push({
          numeroCompleto: acceptedBoleta.numeroCompleto,
          estadoSunat: 'ACEPTADO',
          pdfPath: '',
          xmlPath: acceptedBoleta.xmlPath || '',
          orderNumber: acceptedBoleta.orderNumber || undefined,
          summaryId: summaryResult.summaryId,
          summaryNumero: summaryResult.numeroCompleto,
          summaryTicket: summaryResult.ticket,
          summaryEstado: summaryResult.status?.estado || 'ACEPTADO',
          summaryResponseCode: summaryResult.status?.responseCode,
          summaryResponse: summaryMessage,
        });
      }
    }
    }
  }

  onProgress?.(total, total, 'Completado');
  if (!isProduction) await cleanupBetaWorkflowData(betaBoletaIds, Array.from(betaSummaryIds));

  return {
    total,
    exitosas,
    rechazadas,
    boletas: results,
    outputDir: config.outputDir,
    dbPath: config.dbPath || './boletas.db',
  };
}

async function cleanupBetaWorkflowData(boletaIds: number[], summaryIds: number[]) {
  if (!boletaIds.length && !summaryIds.length) return;
  await db.transaction(async (tx) => {
    for (const boletaId of boletaIds) {
      await tx.delete(boletas).where(eq(boletas.id, boletaId));
    }
    for (const summaryId of summaryIds) {
      await tx.delete(dailySummaries).where(eq(dailySummaries.id, summaryId));
    }
  });
}

function formatSummaryMessage(summaryResult: any): string {
  const status = summaryResult.status || {};
  const error = summaryResult.error || {};
  const code = status.responseCode || status.statusCode || error.code || '';
  const normalizedCode = String(code).replace(/^0+/, '') || String(code);
  const description = status.responseDescription || status.statusMessage || error.message
    || (normalizedCode === '98' ? 'SUNAT todavía está procesando el resumen diario. Consulta el ticket nuevamente en unos minutos.' : '');
  const prefix = summaryResult.numeroCompleto
    ? `Resumen ${summaryResult.numeroCompleto}${summaryResult.ticket ? ` / ticket ${summaryResult.ticket}` : ''}`
    : 'Resumen diario';

  if (code || description) {
    return `${prefix}: ${[code, description].filter(Boolean).join(' - ')}`;
  }
  if (status.estado === 'EN_PROCESO') return `${prefix}: SUNAT todavía lo tiene en proceso.`;
  if (status.estado === 'ACEPTADO') return `${prefix}: aceptado por SUNAT.`;
  if (status.estado) return `${prefix}: estado ${status.estado}.`;
  return `${prefix}: consultar estado luego.`;
}
