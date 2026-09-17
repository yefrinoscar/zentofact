import { isFailedOrderSyncResult } from './order-sync-presentation.ts';
import { sellerShortName } from './seller-name.ts';

export type InboxNoticeRef = {
  label?: string;
  logId?: string;
};

export type InboxNotice = {
  tone: 'success' | 'warning' | 'error';
  message: string;
  refs: InboxNoticeRef[];
};

export type OrderSyncNoticeRow = {
  status?: string;
  failed?: number;
  companyName?: string;
  displayName?: string;
  companyId?: number | null;
  logId?: string | null;
};

function optionalLogId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function storeLabel(
  row: { companyName?: string; displayName?: string; companyId?: number | null },
  nameByCompanyId?: Map<number, string> | Readonly<Record<number, string>>,
) {
  const mapped = row.companyId == null
    ? undefined
    : nameByCompanyId instanceof Map
      ? nameByCompanyId.get(row.companyId)
      : nameByCompanyId?.[row.companyId];
  const raw = String(row.companyName || row.displayName || mapped || '').trim();
  const name = sellerShortName(raw);
  return name === 'Seller' ? '' : name;
}

function failedStoreMessage(names: string[], count: number) {
  const verb = count === 1 ? 'no pudo sincronizarse' : 'no pudieron sincronizarse';
  if (names.length === 1) return `${names[0]} ${verb}.`;
  if (names.length === 2) return `${names[0]} y ${names[1]} ${verb}.`;
  return `${count} tienda${count === 1 ? '' : 's'} ${verb}.`;
}

function busyStoreMessage(names: string[], count: number) {
  if (names.length === 1) return `${names[0]} ya se estaba sincronizando.`;
  if (names.length === 2) return `${names[0]} y ${names[1]} ya se estaban sincronizando.`;
  if (count > 0) return `${count} tienda${count === 1 ? '' : 's'} ya se estaban sincronizando.`;
  return 'La sincronización ya estaba en curso. La bandeja se actualiza al terminar.';
}

export function noticeFromError(error: unknown, fallback: string): InboxNotice {
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
  const logId = error && typeof error === 'object'
    ? optionalLogId((error as { logId?: unknown }).logId)
    : undefined;
  return {
    tone: 'error',
    message,
    refs: logId ? [{ label: 'ID de seguimiento', logId }] : [],
  };
}

export function inboxSyncNotice(result: {
  successful?: number;
  results?: Array<{ ok?: boolean; companyName?: string; logId?: string }>;
} | null | undefined): InboxNotice {
  const rows = Array.isArray(result?.results) ? result.results : [];
  const failed = rows.filter((row) => !row.ok);
  const successful = Number(result?.successful || 0);
  if (!failed.length) {
    return { tone: 'success', message: 'Pedidos actualizados con Falabella.', refs: [] };
  }
  const names = failed.map((row) => storeLabel(row)).filter(Boolean);
  return {
    tone: successful ? 'warning' : 'error',
    message: failedStoreMessage(names, failed.length),
    refs: failed.map((row) => ({
      label: storeLabel(row) || 'Tienda',
      logId: optionalLogId(row.logId),
    })),
  };
}

export function logisticsSyncNotice(
  result: { results?: OrderSyncNoticeRow[] } | null | undefined,
  nameByCompanyId?: Map<number, string> | Readonly<Record<number, string>>,
): InboxNotice {
  const rows = Array.isArray(result?.results) ? result.results : [];
  const failed = rows.filter(isFailedOrderSyncResult);
  const running = rows.filter((row) => String(row.status || '') === 'already_running');
  if (!failed.length && running.length) {
    const names = running.map((row) => storeLabel(row, nameByCompanyId)).filter(Boolean);
    return { tone: 'warning', message: busyStoreMessage(names, running.length), refs: [] };
  }
  if (!failed.length) {
    return { tone: 'success', message: 'Estados de pedidos actualizados.', refs: [] };
  }
  const names = failed.map((row) => storeLabel(row, nameByCompanyId)).filter(Boolean);
  return {
    tone: rows.length === failed.length ? 'error' : 'warning',
    message: failedStoreMessage(names, failed.length),
    refs: failed.map((row) => ({
      label: storeLabel(row, nameByCompanyId) || 'Tienda',
      logId: optionalLogId(row.logId),
    })),
  };
}

export function inboxBulkReadyErrorNotice(failed: Array<{
  orderNumber?: string;
  logId?: string;
}>): InboxNotice {
  const count = failed.length;
  const message = `${count} pedido${count === 1 ? '' : 's'} ${count === 1 ? 'no pudo actualizarse' : 'no pudieron actualizarse'}. Intenta sincronizar y vuelve a revisar.`;
  return {
    tone: 'error',
    message,
    refs: failed.map((row) => ({
      label: row.orderNumber || 'Pedido',
      logId: optionalLogId(row.logId),
    })),
  };
}
