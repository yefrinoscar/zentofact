/**
 * Copiar al portapapeles con respaldo. `navigator.clipboard` falla cuando la pestaña no tiene foco
 * o el navegador niega el permiso; en ese caso vale la selección temporal de toda la vida.
 */
export async function copyText(text: string) {
  const value = String(text || '');
  if (!value) return false;

  // Sin foco el API rechaza con NotAllowedError, así que ni se intenta.
  if (navigator.clipboard?.writeText && document.hasFocus()) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Sigue con el respaldo.
    }
  }

  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
