import { ipcMain } from 'electron';
import {
  falabellaGetOrders, falabellaGetOrderItems, falabellaBuildBoletaVenta, falabellaResolveOrderIds,
  falabellaResolveDocument, falabellaUploadInvoicePdf, falabellaUploadBoletaPdf, falabellaMonthSummary,
} from '@boletas/core';

// Handlers delgados: toda la lógica vive en @boletas/core (compartida con el server web).
export function registerFalabellaApiHandlers() {
  ipcMain.handle('falabella-api:get-orders', (_e, payload) => falabellaGetOrders(payload));
  ipcMain.handle('falabella-api:get-order-items', (_e, payload) => falabellaGetOrderItems(payload));
  ipcMain.handle('falabella-api:build-boleta-venta', (_e, payload) => falabellaBuildBoletaVenta(payload));
  ipcMain.handle('falabella-api:resolve-order-ids', (_e, payload) => falabellaResolveOrderIds(payload));
  ipcMain.handle('falabella-api:resolve-document', (_e, payload) => falabellaResolveDocument(payload));
  ipcMain.handle('falabella-api:upload-invoice-pdf', (_e, payload) => falabellaUploadInvoicePdf(payload));
  ipcMain.handle('falabella-api:upload-boleta-pdf', (_e, payload) => falabellaUploadBoletaPdf(payload));
  ipcMain.handle('falabella-api:month-summary', (_e, payload) => falabellaMonthSummary(payload));
}
