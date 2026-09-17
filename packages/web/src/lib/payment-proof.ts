export const PAYMENT_PROOF_MAX_BYTES = 1_500_000;

export type PaymentProof = {
  name: string;
  type: string;
  dataUrl: string;
};

export type PaymentProofMeta = {
  name?: string | null;
  type?: string | null;
  dataUrl?: string | null;
  hasData?: boolean | null;
};

export function hasPaymentProof(proof?: PaymentProofMeta | null) {
  if (!proof || typeof proof !== 'object') return false;
  if (proof.hasData === true) return true;
  return Boolean(String(proof.dataUrl || '').trim());
}

export function paymentProofPreview(proof?: PaymentProofMeta | null) {
  const dataUrl = String(proof?.dataUrl || '').trim();
  const name = String(proof?.name || '').trim();
  return {
    hasProof: hasPaymentProof(proof),
    name: name || null,
    dataUrl: dataUrl || null,
  };
}

/** List payloads keep the filename but drop the photo so rows stay light. */
export function redactPaymentProofForList<T extends Record<string, unknown>>(metadata?: T | null) {
  const current = metadata && typeof metadata === 'object' ? metadata : {} as T;
  const proof = current.paymentProof;
  if (!proof || typeof proof !== 'object') return current;
  const { dataUrl, ...rest } = proof as PaymentProofMeta;
  return {
    ...current,
    paymentProof: {
      ...rest,
      hasData: hasPaymentProof(proof as PaymentProofMeta),
    },
  };
}

export async function readPaymentProof(file: File): Promise<PaymentProof> {
  if (file.size <= PAYMENT_PROOF_MAX_BYTES) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('No se pudo leer la constancia.'));
      reader.readAsDataURL(file);
    });
    return { name: file.name, type: file.type || 'image/jpeg', dataUrl };
  }

  const bitmap = await createImageBitmap(file);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('No se pudo comprimir la constancia en este dispositivo.');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = 0.82;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length * 0.75 > PAYMENT_PROOF_MAX_BYTES && quality > 0.45) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length * 0.75 > PAYMENT_PROOF_MAX_BYTES) {
    throw new Error('La constancia sigue pesando demasiado. Usa una foto más liviana.');
  }
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'constancia';
  return { name: `${baseName}.jpg`, type: 'image/jpeg', dataUrl };
}
