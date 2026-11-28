// Validación local de documentos de identidad peruanos (sin consulta externa).
// Códigos SUNAT (catálogo 06): 0 sin documento, 1 DNI, 4 CE, 6 RUC, 7 pasaporte.

export const ANONYMOUS_BOLETA_MAX = 700;
export const ANONYMOUS_NAME = 'CLIENTE VARIOS';

export const STORE_DOC_TYPES = { DNI: '1', CE: '4', PASSPORT: '7', RUC: '6' };

export function isValidRuc(value) {
  const ruc = String(value || '').trim();
  if (!/^\d{11}$/.test(ruc)) return false;
  if (!['10', '15', '17', '20'].includes(ruc.slice(0, 2))) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(ruc[index]), 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 1;
  return check === Number(ruc[10]);
}

// Devuelve un mensaje de error en español o null si el número es válido.
export function fiscalIdError(type, number) {
  const value = String(number || '').trim();
  if (type === '0') return null;
  if (type === '1') return /^\d{8}$/.test(value) ? null : 'El DNI debe tener 8 dígitos.';
  if (type === '4') return /^[A-Za-z0-9]{9,12}$/.test(value) ? null : 'El carné de extranjería debe tener de 9 a 12 letras o números.';
  if (type === '7') return /^[A-Za-z0-9]{6,12}$/.test(value) ? null : 'El pasaporte debe tener de 6 a 12 letras o números.';
  if (type === '6') return isValidRuc(value) ? null : 'El RUC no es válido (11 dígitos y dígito verificador).';
  return 'Tipo de documento inválido.';
}

/**
 * Valida los datos fiscales que el operador carga en un pedido antes de emitir.
 * Devuelve { errors, value } con el cliente normalizado.
 */
export function validateBillingInput(input = {}, { total } = {}) {
  const errors = [];
  const kind = String(input.kind || '').trim().toLowerCase();
  if (!['boleta', 'factura'].includes(kind)) errors.push({ path: 'kind', message: 'Elige boleta o factura.' });
  let documentType = String(input.documentType ?? '').trim();
  if (kind === 'factura') documentType = '6';
  if (kind === 'boleta' && !['0', '1', '4', '7'].includes(documentType)) {
    errors.push({ path: 'documentType', message: 'Elige DNI, carné de extranjería, pasaporte o sin documento.' });
  }
  const documentNumber = documentType === '0' ? '' : String(input.documentNumber || '').trim().toUpperCase();
  const idError = documentType ? fiscalIdError(documentType, documentNumber) : null;
  if (idError) errors.push({ path: 'documentNumber', message: idError });
  if (documentType === '0' && Number(total) > ANONYMOUS_BOLETA_MAX) {
    errors.push({ path: 'documentType', message: `Las boletas mayores a S/ ${ANONYMOUS_BOLETA_MAX} requieren identificar al cliente.` });
  }
  const name = documentType === '0' ? ANONYMOUS_NAME : String(input.name || '').trim().slice(0, 200);
  if (!name) errors.push({ path: 'name', message: 'Ingresa el nombre o razón social.' });
  const address = String(input.address || '').trim().slice(0, 300);
  if (kind === 'factura' && !address) errors.push({ path: 'address', message: 'La factura requiere la dirección fiscal.' });
  return {
    errors,
    value: { kind, documentType, documentNumber, name, address },
  };
}
