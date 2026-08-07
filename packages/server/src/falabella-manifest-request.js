function identity(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  return String(value).trim();
}

const MANIFEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeFalabellaManifestOrders(value, limit = 500, action = 'manifestar') {
  if (!Array.isArray(value) || !value.length) {
    return { ok: false, error: `No hay pedidos listos para ${action}.`, orders: [] };
  }
  if (value.length > limit) {
    return { ok: false, error: `Puedes ${action} hasta ${limit} pedidos por vez.`, orders: [] };
  }

  const normalized = [];
  const identitiesByCompany = new Map();
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    const rawCompanyId = candidate?.companyId;
    const companyId = typeof rawCompanyId === 'string' || typeof rawCompanyId === 'number'
      ? Number(rawCompanyId)
      : Number.NaN;
    const orderId = identity(candidate?.orderId);
    const orderNumber = identity(candidate?.orderNumber);
    if (!Number.isInteger(companyId) || companyId <= 0 || (!orderId && !orderNumber)) {
      return {
        ok: false,
        error: `El pedido en la posición ${index + 1} no tiene una tienda e identidad válidas.`,
        orders: [],
      };
    }

    const seen = identitiesByCompany.get(companyId) || {
      orderIds: new Set(),
      orderNumbers: new Set(),
    };
    const duplicate = (orderId && seen.orderIds.has(orderId))
      || (orderNumber && seen.orderNumbers.has(orderNumber));
    if (orderId) seen.orderIds.add(orderId);
    if (orderNumber) seen.orderNumbers.add(orderNumber);
    identitiesByCompany.set(companyId, seen);
    if (duplicate) continue;
    normalized.push({
      companyId,
      ...(orderId ? { orderId } : {}),
      ...(orderNumber ? { orderNumber } : {}),
    });
  }

  if (!normalized.length) {
    return { ok: false, error: `No hay pedidos válidos para ${action}.`, orders: [] };
  }
  return { ok: true, orders: normalized };
}

export function normalizeFalabellaManifestDocumentRequests(value, limit = 50) {
  if (!Array.isArray(value) || !value.length) {
    return { ok: false, error: 'Selecciona al menos un manifiesto para imprimir.', manifests: [] };
  }
  if (value.length > limit) {
    return { ok: false, error: `Puedes imprimir hasta ${limit} manifiestos por vez.`, manifests: [] };
  }
  const manifests = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    const rawCompanyId = candidate?.companyId;
    const companyId = typeof rawCompanyId === 'string' || typeof rawCompanyId === 'number'
      ? Number(rawCompanyId)
      : Number.NaN;
    const manifestId = identity(candidate?.manifestId);
    if (!Number.isInteger(companyId) || companyId <= 0 || !MANIFEST_UUID.test(manifestId)) {
      return {
        ok: false,
        error: `El manifiesto en la posición ${index + 1} no tiene una tienda e identificador válidos.`,
        manifests: [],
      };
    }
    const key = `${companyId}:${manifestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    manifests.push({ companyId, manifestId });
  }
  if (!manifests.length) {
    return { ok: false, error: 'No hay manifiestos válidos para imprimir.', manifests: [] };
  }
  return { ok: true, manifests };
}
