import { sellerShortName } from './seller-name.ts';

export type OrderSyncIssueSource = {
  channelAccountId: number;
  channelCode: string;
  displayName?: string | null;
  status: string;
  lastError?: string | null;
  lastErrorSource?: string | null;
  lastLogId?: string | null;
  lastFinishedAt?: string | null;
};

export type OrderSyncIssueOrigin = 'marketplace' | 'zentofact';

export type OrderSyncIssue = {
  key: number;
  channelCode: string;
  channel: string;
  seller: string;
  origin: OrderSyncIssueOrigin;
  originLabel: string;
  message: string;
  logId: string | null;
  at: string | null;
};

const CHANNEL_NAMES: Record<string, string> = {
  falabella: 'Falabella',
  ripley: 'Ripley',
  mercado_libre: 'Mercado Libre',
};

// El servidor indica quién falló (last_error_source). Para estados guardados
// antes de esa columna, o canales que aún no la informan, se infiere del texto
// que redactan los clientes de marketplace.
const MARKETPLACE_FAILURE = /(respondió HTTP|No se pudo conectar con)/i;

export function orderSyncIssueOrigin(message: string, source?: string | null): OrderSyncIssueOrigin {
  if (source === 'zentofact') return 'zentofact';
  if (source) return 'marketplace';
  return MARKETPLACE_FAILURE.test(message) ? 'marketplace' : 'zentofact';
}

/** Cuentas cuya última sincronización falló o quedó incompleta, con el motivo. */
export function orderSyncIssues(
  accounts: OrderSyncIssueSource[] | null | undefined,
  channelCode?: string | null,
): OrderSyncIssue[] {
  const channelFilter = channelCode && channelCode !== 'all' ? channelCode : null;
  return (accounts || [])
    .filter((account) => (account.status === 'error' || account.status === 'partial') && account.lastError)
    .filter((account) => !channelFilter || account.channelCode === channelFilter)
    .map((account) => {
      const channel = CHANNEL_NAMES[account.channelCode] || account.channelCode || 'Canal';
      const message = String(account.lastError);
      const origin = orderSyncIssueOrigin(message, account.lastErrorSource);
      return {
        key: account.channelAccountId,
        channelCode: account.channelCode,
        channel,
        seller: sellerShortName(account.displayName) || account.displayName || 'Vendedor',
        origin,
        originLabel: origin === 'marketplace' ? `Falla de ${channel}` : 'Error de Zentofact',
        message,
        logId: account.lastLogId || null,
        at: account.lastFinishedAt || null,
      };
    })
    .sort((left, right) => String(right.at || '').localeCompare(String(left.at || '')));
}
