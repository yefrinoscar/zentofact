// datos_adicionales es jsonb y, según el origen, guarda un objeto o un arreglo
// de objetos. Estas funciones leen y escriben una clave sin perder el resto.

export function readDatoAdicional<T = any>(datosAdicionales: unknown, key: string): T | undefined {
  const source = Array.isArray(datosAdicionales)
    ? datosAdicionales.find(item => item && typeof item === 'object' && key in item)
    : datosAdicionales;
  return source && typeof source === 'object' ? (source as any)[key] : undefined;
}

export function withDatoAdicional(datosAdicionales: unknown, key: string, value: unknown): unknown {
  if (Array.isArray(datosAdicionales)) {
    const rest = datosAdicionales.filter(item => !(item && typeof item === 'object' && key in item));
    return [...rest, { [key]: value }];
  }
  if (datosAdicionales && typeof datosAdicionales === 'object') return { ...datosAdicionales, [key]: value };
  return { [key]: value };
}
