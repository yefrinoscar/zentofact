import { ipcMain } from 'electron';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getCompany, listBoletas, listFacturas, listCreditNotes, generateAcceptedBoletaPdf, recordFacturaUpload } from '@boletas/core';
import { FalabellaApiClient, getFalabellaError, normalizeGetOrdersResult, buildIsoUtcTimestamp, signParameters } from '@boletas/falabella-api';
import type { GetOrdersV2Filters } from '@boletas/falabella-api';

export function registerFalabellaApiHandlers() {
  ipcMain.handle('falabella-api:get-orders', async (_event, payload: { companyId: number; filters: GetOrdersV2Filters }) => {
    const company = await getCompany(payload.companyId);

    if (!company || !company.activo) {
      return { error: 'Empresa no encontrada o inactiva.' };
    }

    if (!company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
      return { error: 'La empresa no tiene credenciales de Falabella API configuradas.' };
    }

    if (!payload.filters?.createdAfter && !payload.filters?.updatedAfter) {
      return { error: 'Debes indicar Created After o Updated After.' };
    }

    const client = new FalabellaApiClient({
      userId: company.falabellaApiUserId,
      apiKey: company.falabellaApiKey,
      version: '2.0',
      defaultFormat: 'JSON',
    });

    const response = await client.getOrdersV2(payload.filters);
    const error = getFalabellaError(response.data);

    if (error) {
      return {
        ok: response.ok,
        status: response.status,
        url: response.url,
        error,
      };
    }

    const normalized = normalizeGetOrdersResult(response.data);
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      totalCount: normalized.totalCount,
      orders: normalized.orders,
    };
  });

  ipcMain.handle('falabella-api:get-order-items', async (_event, payload: { companyId: number; orderId: string | number }) => {
    const company = await getCompany(payload.companyId);
    if (!company || !company.activo) return { error: 'Empresa no encontrada o inactiva.' };
    if (!company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
      return { error: 'La empresa no tiene credenciales de Falabella API configuradas.' };
    }

    const client = new FalabellaApiClient({
      userId: company.falabellaApiUserId,
      apiKey: company.falabellaApiKey,
      version: '1.0',
      defaultFormat: 'JSON',
    });

    const response = await client.call({
      action: 'GetOrderItems',
      params: { OrderId: payload.orderId },
      accept: 'application/json',
    });

    const error = getFalabellaError(response.data);
    if (error) {
      return { ok: response.ok, status: response.status, url: response.url, error };
    }

    const orderItems = extractOrderItems(response.data);
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      orderItems,
      orderItemIds: orderItems.map((item: any) => String(item.OrderItemId)),
    };
  });

  ipcMain.handle('falabella-api:resolve-order-ids', async (_event, payload: {
    companyId: number;
    entries: Array<{ orderNumber: string; invoiceDate: string }>;
  }) => {
    const company = await getCompany(payload.companyId);
    if (!company || !company.activo) return { error: 'Empresa no encontrada o inactiva.' };
    if (!company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
      return { error: 'La empresa no tiene credenciales de Falabella API configuradas.' };
    }

    const client = new FalabellaApiClient({
      userId: company.falabellaApiUserId,
      apiKey: company.falabellaApiKey,
      version: '2.0',
      defaultFormat: 'JSON',
    });

    const resolved = await client.resolveOrderIds(payload.entries || []);

    console.log(`[falabella-api:resolve-order-ids] companyId=${payload.companyId} ruc=${company.ruc} razonSocial=${company.razonSocial} userId=${company.falabellaApiUserId}`);
    for (const [date, debugLines] of Object.entries(resolved.debug.searchesByDate)) {
      console.log(`[falabella-api:resolve-order-ids] fecha=${date}:`);
      for (const line of debugLines) console.log(`  ${line}`);
    }

    return {
      ...resolved,
      debug: {
        company: {
          id: payload.companyId,
          nombre: company.nombre,
          ruc: company.ruc,
          razonSocial: company.razonSocial,
          falabellaApiUserId: company.falabellaApiUserId,
        },
        searchedDates: Object.keys(resolved.debug.searchesByDate),
        searchesByDate: resolved.debug.searchesByDate,
        totalOrdersFound: resolved.debug.totalOrdersFound,
      },
    };
  });

  ipcMain.handle('falabella-api:resolve-document', async (_event, payload: { companyId: number; orderNumber: string }) => {
    const boletasResult = await listBoletas({ companyId: payload.companyId, orderNumber: payload.orderNumber, limit: 20 });
    const facturasResult = await listFacturas({ companyId: payload.companyId, orderNumber: payload.orderNumber, limit: 20 });
    const creditNotesResult = await listCreditNotes({ companyId: payload.companyId, orderNumber: payload.orderNumber, limit: 20 });

    const boleta = boletasResult.boletas.find((row: any) => row.orderNumber === payload.orderNumber) || boletasResult.boletas[0] || null;
    const factura = facturasResult.facturas.find((row: any) => row.orderNumber === payload.orderNumber) || facturasResult.facturas[0] || null;
    const creditNote = creditNotesResult.creditNotes.find((row: any) => row.affectedOrderNumber === payload.orderNumber) || creditNotesResult.creditNotes[0] || null;

    const options: Array<any> = [];
    if (boleta) {
      options.push({
        kind: 'BOLETA',
        source: 'local_boleta',
        boletaId: boleta.id,
        invoiceNumber: boleta.numeroCompleto,
        invoiceDate: boleta.fechaEmision,
        invoiceType: 'BOLETA',
        pdfPath: boleta.pdfPath || '',
        estadoSunat: boleta.estadoSunat,
      });
    }
    if (factura) {
      options.push({
        kind: 'FACTURA',
        source: 'manual',
        invoiceNumber: factura.numeroCompleto,
        invoiceDate: factura.fechaEmision,
        invoiceType: 'FACTURA',
        pdfPath: factura.pdfPath || '',
        estadoSunat: factura.estado,
      });
    }
    if (creditNote) {
      options.push({
        kind: 'NOTA_DE_CREDITO',
        source: 'local_credit_note',
        creditNoteId: creditNote.id,
        invoiceNumber: creditNote.numeroCompleto,
        invoiceDate: creditNote.fechaEmision,
        invoiceType: 'NOTA_DE_CREDITO',
        pdfPath: creditNote.pdfPath || '',
        estadoSunat: creditNote.estadoSunat,
      });
    }

    if (!factura) {
      options.push({
        kind: 'FACTURA',
        source: 'manual',
        invoiceNumber: '',
        invoiceDate: '',
        invoiceType: 'FACTURA',
        pdfPath: '',
        estadoSunat: '',
      });
    }

    return {
      orderNumber: payload.orderNumber,
      boleta: boleta
        ? {
            id: boleta.id,
            numeroCompleto: boleta.numeroCompleto,
            fechaEmision: boleta.fechaEmision,
            pdfPath: boleta.pdfPath || '',
            estadoSunat: boleta.estadoSunat,
          }
        : null,
      factura: factura
        ? {
            id: factura.id,
            numeroCompleto: factura.numeroCompleto,
            fechaEmision: factura.fechaEmision,
            pdfPath: factura.pdfPath || '',
            estado: factura.estado,
          }
        : null,
      creditNote: creditNote
        ? {
            id: creditNote.id,
            numeroCompleto: creditNote.numeroCompleto,
            fechaEmision: creditNote.fechaEmision,
            pdfPath: creditNote.pdfPath || '',
            estadoSunat: creditNote.estadoSunat,
          }
        : null,
      options,
      defaultKind: boleta ? 'BOLETA' : factura ? 'FACTURA' : creditNote ? 'NOTA_DE_CREDITO' : 'FACTURA',
    };
  });

  ipcMain.handle('falabella-api:upload-invoice-pdf', async (_event, payload: {
    companyId: number;
    orderNumber: string;
    orderItemIds: string[];
    invoiceNumber: string;
    invoiceDate: string;
    invoiceType: 'BOLETA' | 'FACTURA' | 'NOTA_DE_CREDITO';
    source?: 'local_boleta' | 'local_credit_note' | 'manual';
    boletaId?: number;
    pdfPath?: string;
    pdfBase64?: string;
  }) => {
    const company = await getCompany(payload.companyId);
    if (!company || !company.activo) return { error: 'Empresa no encontrada o inactiva.' };
    if (!company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
      return { error: 'La empresa no tiene credenciales de Falabella API configuradas.' };
    }

    return uploadInvoicePdfForCompany(company, payload);
  });

  ipcMain.handle('falabella-api:upload-boleta-pdf', async (_event, payload: {
    companyId: number;
    boletaId: number;
    orderNumber: string;
    orderId?: string | number;
    invoiceNumber: string;
    invoiceDate: string;
    pdfPath: string;
  }) => {
    const company = await getCompany(payload.companyId);
    if (!company || !company.activo) return { error: 'Empresa no encontrada o inactiva.' };
    if (!company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
      return { error: 'La empresa no tiene credenciales de Falabella API configuradas.' };
    }

    if (!payload.orderNumber?.trim()) {
      return { ok: false, skipped: true, error: 'La boleta no tiene orderNumber asociado.' };
    }

    if (!payload.pdfPath?.trim()) {
      return { ok: false, skipped: true, error: 'La boleta no tiene PDF generado.' };
    }

    const client = new FalabellaApiClient({
      userId: company.falabellaApiUserId,
      apiKey: company.falabellaApiKey,
      version: '2.0',
      defaultFormat: 'JSON',
    });

    const order = payload.orderId
      ? { OrderId: payload.orderId, OrderNumber: payload.orderNumber, InvoiceRequired: false }
      : await client.findOrderByOrderNumber(payload.orderNumber, payload.invoiceDate);
    if (!order) {
      return {
        ok: false,
        skipped: true,
        error: `No se encontró la orden ${payload.orderNumber} en Falabella para resolver su OrderId.`,
      };
    }

    if (order.InvoiceRequired) {
      return {
        ok: false,
        skipped: true,
        error: `La orden ${payload.orderNumber} requiere FACTURA en Falabella.`,
        orderId: order.OrderId,
      };
    }

    const itemsClient = new FalabellaApiClient({
      userId: company.falabellaApiUserId,
      apiKey: company.falabellaApiKey,
      version: '1.0',
      defaultFormat: 'JSON',
    });

    const itemsResponse = await itemsClient.call({
      action: 'GetOrderItems',
      params: { OrderId: order.OrderId as string | number },
      accept: 'application/json',
    });

    const itemsError = getFalabellaError(itemsResponse.data);
    if (itemsError) {
      return {
        ok: itemsResponse.ok,
        status: itemsResponse.status,
        orderId: order.OrderId,
        error: itemsError,
      };
    }

    const orderItems = extractOrderItems(itemsResponse.data);
    const orderItemIds = orderItems.map((item: any) => String(item.OrderItemId)).filter(Boolean);
    if (!orderItemIds.length) {
      return {
        ok: false,
        orderId: order.OrderId,
        error: 'Falabella no devolvió OrderItemIds para esta orden.',
      };
    }

    const upload = await uploadInvoicePdfForCompany(company, {
      companyId: payload.companyId,
      orderNumber: payload.orderNumber,
      orderItemIds,
      invoiceNumber: payload.invoiceNumber,
      invoiceDate: payload.invoiceDate,
      invoiceType: 'BOLETA',
      source: 'manual',
      pdfPath: payload.pdfPath,
    });

    return {
      ...upload,
      boletaId: payload.boletaId,
      orderNumber: payload.orderNumber,
      orderId: order.OrderId,
      orderItemIds,
    };
  });
}

function extractOrderItems(document: any): any[] {
  const candidate =
    document?.SuccessResponse?.Body?.OrderItems?.OrderItem
    || document?.OrderItems?.OrderItem
    || document?.OrderItems
    || document?.data?.orderItems
    || document?.data?.OrderItems
    || document?.orderItems;

  if (Array.isArray(candidate)) return candidate;
  if (candidate && typeof candidate === 'object') return [candidate];
  return [];
}

async function uploadInvoicePdfForCompany(
  company: any,
  payload: {
    companyId: number;
    orderNumber: string;
    orderItemIds: string[];
    invoiceNumber: string;
    invoiceDate: string;
    invoiceType: 'BOLETA' | 'FACTURA' | 'NOTA_DE_CREDITO';
    source?: 'local_boleta' | 'local_credit_note' | 'manual';
    boletaId?: number;
    pdfPath?: string;
    pdfBase64?: string;
  },
) {
  let pdfBase64 = payload.pdfBase64 || '';

  if (!pdfBase64 && payload.source === 'local_boleta' && payload.boletaId) {
    const generated = await generateAcceptedBoletaPdf(payload.boletaId, join(tmpdir(), 'boletas-falabella-upload'), 'A4');
    pdfBase64 = readFileSync(generated.pdfPath, { encoding: 'base64' });
  }

  if (!pdfBase64 && payload.pdfPath) {
    pdfBase64 = readFileSync(payload.pdfPath, { encoding: 'base64' });
  }

  if (!pdfBase64) {
    return { error: 'No se encontró un PDF para subir. Selecciona un archivo PDF o usa una boleta con PDF disponible.' };
  }

  const timestamp = buildIsoUtcTimestamp();
  const authParameters = {
    Action: 'SetInvoicePDF',
    Format: 'JSON',
    Service: 'Invoice',
    Timestamp: timestamp,
    UserID: company.falabellaApiUserId,
    Version: process.env.FALABELLA_API_VERSION || '1.0',
  };

  const signature = signParameters(authParameters, company.falabellaApiKey);
  const response = await fetch('https://sellercenter-api.falabella.com/v1/marketplace-sellers/invoice/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      UserID: authParameters.UserID,
      Version: authParameters.Version,
      Timestamp: authParameters.Timestamp,
      Signature: signature,
      Action: authParameters.Action,
      Format: authParameters.Format,
      Service: authParameters.Service,
    },
    body: JSON.stringify({
      orderItemIds: payload.orderItemIds,
      invoiceNumber: payload.invoiceNumber,
      invoiceDate: payload.invoiceDate,
      invoiceType: payload.invoiceType,
      operatorCode: 'FAPE',
      invoiceDocumentFormat: 'pdf',
      invoiceDocument: pdfBase64,
    }),
  });

  const rawText = await response.text();
  let data: any = rawText;
  try {
    data = JSON.parse(rawText);
  } catch {}

  const error = getFalabellaError(data);
  const result = {
    ok: response.ok,
    status: response.status,
    error,
    data,
    rawText,
  };

  if (response.ok && !error && payload.invoiceType === 'FACTURA') {
    const pdfBuffer = payload.pdfBase64
      ? Buffer.from(payload.pdfBase64, 'base64')
      : payload.pdfPath
        ? readFileSync(payload.pdfPath)
        : null;

    if (pdfBuffer) {
      await recordFacturaUpload({
        companyId: payload.companyId,
        orderNumber: payload.orderNumber,
        numeroCompleto: payload.invoiceNumber,
        fechaEmision: payload.invoiceDate,
        pdfBuffer,
        source: payload.source || 'manual',
        orderItemIds: payload.orderItemIds,
        respuestaFalabella: data,
      });
    }
  }

  return result;
}
