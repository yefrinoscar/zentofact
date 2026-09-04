import assert from 'node:assert/strict';
import test from 'node:test';
import { toPublicUserError } from './user-errors.js';

test('toPublicUserError deja pasar errores de negocio', () => {
  const error = new Error('Rol inválido');
  assert.equal(toPublicUserError(error), error);
});

test('toPublicUserError no expone SQL ni el hash de contraseña', () => {
  const error = new Error('Failed query: insert into "account" ("issuer", "password") values ($1, $2)\nparams: local:credential,hash');
  error.cause = new Error('column "issuer" of relation "account" does not exist');
  const publicError = toPublicUserError(error);
  assert.equal(publicError.message, 'No se pudo guardar el usuario');
  assert.equal(publicError.cause, error);
  assert.equal(publicError.message.includes('password'), false);
  assert.equal(publicError.message.includes('issuer'), false);
});

test('toPublicUserError traduce el correo duplicado', () => {
  const error = new Error('Failed query: insert into "user" ("email") values ($1)');
  error.cause = new Error('duplicate key value violates unique constraint "user_email_key"');
  assert.equal(toPublicUserError(error).message, 'Ya existe un usuario con ese correo');
});
