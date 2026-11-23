export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = window.atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function isTouchDevice() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

async function tryShareFile(blob: Blob, filename: string): Promise<boolean> {
  if (!isTouchDevice() || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  const file = new File([blob], filename, { type: blob.type });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch (error) {
    // The user closed the share sheet: treat it as handled, do not force a second download.
    if (error instanceof DOMException && error.name === 'AbortError') return true;
    return false;
  }
}

/**
 * Saves a file in a way that works on desktop and mobile web.
 * Mobile browsers (iOS Safari, installed PWAs, Chrome Android) ignore or block
 * `data:` URLs with `download`, so files go through a Blob URL, and touch devices
 * use the native share sheet ("Guardar en Archivos") when available.
 */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (await tryShareFile(blob, filename)) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Mobile browsers read the Blob asynchronously; revoking too early cancels the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function saveBase64File(base64: string, filename: string, mimeType: string): Promise<void> {
  return saveFile(base64ToBlob(base64, mimeType), filename);
}
