// Ruta que se escribe en el log [REQ]. Nunca debe incluir secretos: el token
// del webhook de Falabella viaja en el path.
const REDACTIONS = [
  [/^(\/webhooks\/falabella\/[^/]+\/)[^/]+/, '$1[redactado]'],
];

export function redactRequestPath(path) {
  let value = String(path || '');
  for (const [pattern, replacement] of REDACTIONS) value = value.replace(pattern, replacement);
  return value;
}
