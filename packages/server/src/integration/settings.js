import { stableHash } from './crypto.js';
import { ANONYMOUS_BOLETA_MAX } from './fiscal-id.js';

// Política de la cuenta de tienda (order_channel_accounts.settings).
export const DEFAULT_STORE_SETTINGS = Object.freeze({
  integration: true,
  allowNegative: true,
  skuFallback: true,
  issuanceMode: 'on_request',
  creditNoteOnCancel: 'auto',
  boletaIdRequired: false,
});

export const ISSUANCE_MODES = ['on_request', 'always'];
export const CREDIT_NOTE_POLICIES = ['auto', 'manual'];

// Modo de emisión → document_requirement existente.
export function documentRequirementForIssuance(mode) {
  return mode === 'always' ? 'required' : 'optional';
}

export function storeSettings(account) {
  const raw = account?.settings && typeof account.settings === 'object' ? account.settings : {};
  const issuanceMode = ISSUANCE_MODES.includes(raw.issuanceMode)
    ? raw.issuanceMode
    : account?.documentRequirement === 'required' || account?.document_requirement === 'required'
      ? 'always'
      : 'on_request';
  return {
    integration: raw.integration === true,
    allowNegative: raw.allowNegative !== false,
    skuFallback: raw.skuFallback !== false,
    issuanceMode,
    creditNoteOnCancel: CREDIT_NOTE_POLICIES.includes(raw.creditNoteOnCancel) ? raw.creditNoteOnCancel : 'auto',
    boletaIdRequired: raw.boletaIdRequired === true,
    series: {
      boleta: String(raw.series?.boleta || 'B001').toUpperCase(),
      factura: String(raw.series?.factura || 'F001').toUpperCase(),
    },
  };
}

export function buildPolicy(account) {
  const settings = storeSettings(account);
  const policy = {
    issuance: { mode: settings.issuanceMode },
    documentTypes: ['boleta', 'factura'],
    boletaIdRequired: settings.boletaIdRequired,
    anonymousMaxAmount: ANONYMOUS_BOLETA_MAX,
    creditNoteOnCancel: settings.creditNoteOnCancel,
    series: settings.series,
  };
  const updatedAt = account?.updatedAt || account?.updated_at;
  const stamp = updatedAt ? new Date(updatedAt).toISOString().replace(/\.\d{3}Z$/, 'Z') : 'initial';
  return { version: `${stamp}#${stableHash(policy).slice(0, 8)}`, ...policy };
}
