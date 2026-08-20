export type InboxNoticeRef = {
  label?: string;
  logId?: string;
};

export type InboxNotice = {
  tone: 'success' | 'warning' | 'error';
  message: string;
  refs: InboxNoticeRef[];
};

function optionalLogId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
  const verb = failed.length === 1 ? 'no pudo sincronizarse' : 'no pudieron sincronizarse';
  const storeWord = (count: number) => `tienda${count === 1 ? '' : 's'}`;
  const message = successful
    ? `${successful} ${storeWord(successful)} actualizada${successful === 1 ? '' : 's'}; ${failed.length} ${verb}.`
    : `${failed.length} ${storeWord(failed.length)} ${verb}.`;
  return {
    tone: successful ? 'warning' : 'error',
    message,
    refs: failed.map((row) => ({
      label: String(row.companyName || '').trim() || 'Tienda',
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
