import { db } from './db';
import { boletas, branches, companies, dailySummaries } from './db/schema';
import { eq, and } from 'drizzle-orm';
import { createBoleta, sendBoletaToSunat } from './services/boleta.service';
import type { DetalleItem } from './utils/tax-calculator';
import type { CoreConfig, VentaItem, WorkflowResult, WorkflowProgress } from './index';

/**
 * Resuelve empresa/sucursal solo desde la base de datos.
 * No acepta ni persiste certificado, clave SOL u otros secretos del cliente.
 */
async function ensureSetup(config: CoreConfig) {
  if (!config.companyId) {
    throw new Error('companyId es obligatorio. Las credenciales se cargan en el servidor.');
  }

  const company = (await db.select().from(companies).where(eq(companies.id, config.companyId)).limit(1))[0];
  if (!company || company.activo === false) {
    throw new Error('Empresa no encontrada o inactiva');
  }
  if (!String(company.claveSol || '').trim() || !String(company.certificado || '').trim()) {
    throw new Error('La empresa no tiene certificado o clave SOL configurados en el servidor.');
  }

  let branch = config.branchId
    ? (await db.select().from(branches).where(and(
        eq(branches.id, config.branchId),
        eq(branches.companyId, company.id),
      )).limit(1))[0]
    : undefined;

  if (!branch) {
    const preferredCodigo = config.branchCodigo || '0000';
    branch = (await db.select().from(branches).where(and(
      eq(branches.companyId, company.id),
      eq(branches.codigo, preferredCodigo),
    )).limit(1))[0]
      || (await db.select().from(branches).where(and(
        eq(branches.companyId, company.id),
        eq(branches.activo, true),
      )).limit(1))[0];
  }

  if (!branch) {
    throw new Error('La empresa no tiene una sucursal activa configurada.');
  }

  return {
    companyId: company.id,
    branchId: branch.id,
    modoProduccion: Boolean(company.modoProduccion),
  };
}

export async function processWorkflow(
  config: CoreConfig,
  ventas: VentaItem[],
  onProgress?: WorkflowProgress,
): Promise<WorkflowResult> {
  process.env.STORAGE_PATH = config.outputDir || 'storage';
  const { companyId, branchId, modoProduccion: companyModoProduccion } = await ensureSetup(config);
  const serie = config.serieBoleta || 'B001';
  // Env force (via server) wins; otherwise use the company record — never trust client secrets.
  const isProduction = config.modoProduccion ?? companyModoProduccion;

  const results: WorkflowResult['boletas'] = [];
  let exitosas = 0;
  let rechazadas = 0;
  const total = ventas.length;
  const betaBoletaIds: number[] = [];

  for (let i = 0; i < ventas.length; i++) {
    const venta = ventas[i];
    const ventaSerie = venta.serie || serie;
    const orderNumber = String(venta.orderNumber || '');

    try {
      onProgress?.(i, total, `[${orderNumber || venta.client.razonSocial}] Creando boleta...`);

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
          onProgress?.(i + 1, total, `[${orderNumber || existing.numeroCompleto}] Omitida: ya existe ${existing.numeroCompleto}.`);
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
        metodo_envio: 'individual',
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

      if (!isProduction) betaBoletaIds.push(boleta.id);

      onProgress?.(i, total, `[${orderNumber || boleta.numeroCompleto}] Enviando ${boleta.numeroCompleto} a SUNAT...`);
      let sendError = '';
      try {
        const r = await sendBoletaToSunat(boleta.id);
        if (!r.success) sendError = r.message || 'Rechazado por SUNAT';
      } catch (e: any) {
        sendError = e?.message || 'Error al enviar a SUNAT';
      }

      const b = (await db.select().from(boletas).where(eq(boletas.id, boleta.id)).limit(1))[0];
      const estado = String(b?.estadoSunat || '').toUpperCase();
      const accepted = estado === 'ACEPTADO';
      if (accepted) {
        exitosas++;
      } else {
        rechazadas++;
      }
      results.push({
        numeroCompleto: b?.numeroCompleto || boleta.numeroCompleto,
        estadoSunat: (estado || 'RECHAZADO') as any,
        pdfPath: '',
        xmlPath: b?.xmlPath || '',
        orderNumber: b?.orderNumber || venta.orderNumber || undefined,
        error: accepted ? undefined : (sendError || 'Rechazado por SUNAT'),
      });
      onProgress?.(
        i + 1,
        total,
        `[${orderNumber || boleta.numeroCompleto}] ${accepted ? 'Aceptada' : `Rechazada: ${sendError || 'SUNAT rechazó el comprobante'}`} (${b?.numeroCompleto || boleta.numeroCompleto})`,
      );
    } catch (e: any) {
      rechazadas++;
      results.push({
        numeroCompleto: `ERROR-${i + 1}`,
        estadoSunat: 'RECHAZADO',
        pdfPath: '',
        xmlPath: '',
        orderNumber: venta.orderNumber || undefined,
        error: e.message,
      });
      onProgress?.(i + 1, total, `[${orderNumber || venta.client.razonSocial}] Rechazada: ${e.message}`);
    }
  }

  onProgress?.(total, total, 'Completado');
  if (!isProduction) await cleanupBetaWorkflowData(betaBoletaIds, []);

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
