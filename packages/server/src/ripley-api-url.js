/** Usa la URL exacta del tenant Mirakl autorizado para esta instalación. */
export function ripleyApiUrl() {
  const url = String(process.env.RIPLEY_API_URL || '').trim();
  if (!url) throw new Error('Configura RIPLEY_API_URL para consultar Ripley.');
  return url;
}
