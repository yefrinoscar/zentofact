import { networkInterfaces } from 'node:os';

export function localAuthOriginPatterns({ nodeEnv = process.env.NODE_ENV } = {}) {
  if (nodeEnv === 'production') return [];

  return [
    'http://localhost',
    'http://localhost:*',
    'https://localhost',
    'https://localhost:*',
    'http://127.0.0.1',
    'http://127.0.0.1:*',
    'https://127.0.0.1',
    'https://127.0.0.1:*',
    'http://[::1]',
    'http://[::1]:*',
    'https://[::1]',
    'https://[::1]:*',
  ];
}

export function isLocalDevelopmentOrigin(value, { nodeEnv = process.env.NODE_ENV } = {}) {
  if (nodeEnv === 'production') return false;
  try {
    const url = new URL(String(value || ''));
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

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
