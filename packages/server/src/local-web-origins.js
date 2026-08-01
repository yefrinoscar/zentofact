import { networkInterfaces } from 'node:os';

export function localWebOrigins({
  nodeEnv = process.env.NODE_ENV,
  interfaces = networkInterfaces(),
  ports = [3011, 3000],
} = {}) {
  if (nodeEnv === 'production') return [];

  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries || [])
    .filter((entry) => (entry.family === 'IPv4' || entry.family === 4) && !entry.internal)
    .map((entry) => String(entry.address || '').trim())
    .filter(Boolean);

  return [...new Set(addresses.flatMap((address) =>
    ports.map((port) => `http://${address}:${port}`),
  ))];
}
