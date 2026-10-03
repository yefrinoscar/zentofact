import { isAdminRole } from './permissions.js';

export function orderDateTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Elige una fecha válida para el pedido.');
  }
  const timestamp = `${value}T12:00:00-05:00`;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Elige una fecha válida para el pedido.');
  }
  return date.toISOString();
}

export function requireOrderDateConfirmations(input) {
  if (input.dateConfirmed !== true || input.dateFinalConfirmed !== true) {
    throw new Error('Confirma dos veces el cambio de fecha del pedido.');
  }
}

export function manualOrderTimestamp(input, role) {
  if (input.orderDate != null || input.orderedAt != null) {
    if (!isAdminRole(role)) {
      const error = new Error('Solo un administrador puede cambiar la fecha del pedido.');
      error.status = 403;
      throw error;
    }
    requireOrderDateConfirmations(input);
    return orderDateTimestamp(input.orderDate);
  }
  return new Date().toISOString();
}
