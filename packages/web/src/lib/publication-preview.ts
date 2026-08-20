export const UNPUBLISH_CONFIRMATION_TEXT = 'DESPUBLICAR';

export function canConfirmUnpublish(value: string) {
  return String(value || '') === UNPUBLISH_CONFIRMATION_TEXT;
}

export function publicationPreviewCopy(kind: 'publish' | 'unpublish') {
  if (kind === 'publish') {
    return {
      title: 'Preparar publicación',
      subtitle: 'Esta versión solo simula el flujo. No llama al canal.',
      submit: 'Simular publicación',
      notice: 'No se crea ni se edita ninguna publicación en Falabella.',
    };
  }
  return {
    title: 'Confirmar despublicación',
    subtitle: 'Acción sensible protegida; esta versión solo simula el flujo.',
    submit: 'Simular despublicación',
    notice: 'Despublicar puede detener ventas. Requiere confirmación explícita.',
  };
}

export function simulatePublicationPreview(input: {
  kind: 'publish' | 'unpublish';
  sellerName?: string;
  confirmation?: string;
}): { mutated: false; message?: string; error?: string } {
  if (input.kind === 'unpublish' && !canConfirmUnpublish(input.confirmation || '')) {
    return { mutated: false, error: 'Escribe DESPUBLICAR para confirmar.' };
  }
  if (input.kind === 'publish') {
    const seller = String(input.sellerName || '').trim() || 'el seller';
    return {
      mutated: false,
      message: `Publicación preparada para ${seller}. No se envió ningún cambio al canal.`,
    };
  }
  return {
    mutated: false,
    message: 'Simulación completada. La publicación continúa activa y no se envió ningún cambio.',
  };
}
