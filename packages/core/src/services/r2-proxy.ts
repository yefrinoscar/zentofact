// Cliente del Worker proxy de R2 (ver carpeta r2-proxy/). Se usa cuando la red
// bloquea el endpoint S3 directo de R2 pero sí alcanza *.workers.dev.
// Habilitado cuando R2_PROXY_URL y R2_PROXY_SECRET están definidos.

export function isProxyEnabled(): boolean {
  return Boolean(process.env.R2_PROXY_URL && process.env.R2_PROXY_SECRET);
}

function endpoint(key: string): string {
  const base = (process.env.R2_PROXY_URL as string).replace(/\/+$/, '');
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${process.env.R2_PROXY_SECRET}` };
}

export async function proxyPut(key: string, body: Buffer | string, contentType: string): Promise<void> {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
  const res = await fetch(endpoint(key), {
    method: 'PUT',
    headers: { ...authHeader(), 'content-type': contentType },
    body: new Uint8Array(buf),
  });
  if (!res.ok) {
    throw new Error(`R2 proxy PUT ${key} -> ${res.status} ${await res.text().catch(() => '')}`);
  }
}

export async function proxyGet(key: string): Promise<Buffer> {
  const res = await fetch(endpoint(key), { headers: authHeader() });
  if (res.status === 404) throw new Error(`Archivo no encontrado en R2: ${key}`);
  if (!res.ok) throw new Error(`R2 proxy GET ${key} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function proxyHead(key: string): Promise<boolean> {
  const res = await fetch(endpoint(key), { method: 'HEAD', headers: authHeader() });
  return res.ok;
}
