import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// Cloudflare R2 (S3-compatible) storage for legal XML/CDR archives.
// Enabled only when all R2_* env vars are present; otherwise callers fall back
// to local disk so development keeps working without credentials.

let cachedClient: S3Client | null = null;

export function isR2Enabled(): boolean {
  return Boolean(
    (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT) &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET,
  );
}

function getClient(): { client: S3Client; bucket: string } {
  if (!isR2Enabled()) {
    throw new Error('R2 no está configurado (faltan variables R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET).');
  }
  if (!cachedClient) {
    // R2_ENDPOINT permite apuntar a un S3 compatible local (MinIO en OrbStack).
    // Sin él, se usa el endpoint real de Cloudflare R2.
    const customEndpoint = process.env.R2_ENDPOINT;
    cachedClient = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: customEndpoint || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: Boolean(customEndpoint), // MinIO usa path-style
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });
  }
  return { client: cachedClient, bucket: process.env.R2_BUCKET as string };
}

export async function putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: typeof body === 'string' ? Buffer.from(body, 'utf-8') : body,
    ContentType: contentType,
  }));
}

export async function getObject(key: string): Promise<Buffer> {
  const { client, bucket } = getClient();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function objectExists(key: string): Promise<boolean> {
  const { client, bucket } = getClient();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}
