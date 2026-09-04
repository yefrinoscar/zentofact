export function toPublicUserError(error) {
  const message = String(error?.message || error || '');
  if (!message.startsWith('Failed query:')) return error;
  const cause = String(error?.cause?.message || error?.cause || '');
  const haystack = `${message}\n${cause}`;
  const publicError = /duplicate key|unique/i.test(haystack) && /email/i.test(haystack)
    ? new Error('Ya existe un usuario con ese correo')
    : new Error('No se pudo guardar el usuario');
  publicError.cause = error;
  return publicError;
}
