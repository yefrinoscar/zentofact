import {
  alignFalabellaHeaderWithClosedFulfillment,
  closeOverdueFalabellaFulfillment,
  closeStaleFalabellaFulfillment,
} from './order-adapters/falabella.js';
import { closeStaleRipleyShippedFulfillment } from './order-adapters/ripley.js';

export async function closeStaleMarketplaceFulfillment(db) {
  if (!db?.query) return { falabella: 0, falabellaAligned: 0, falabellaOverdue: 0, ripley: 0 };
  const aligned = await alignFalabellaHeaderWithClosedFulfillment(db);
  const overdue = await closeOverdueFalabellaFulfillment(db);
  const falabella = await closeStaleFalabellaFulfillment(db);
  const ripley = await closeStaleRipleyShippedFulfillment(db);
  return {
    falabella: Number(falabella.updated || 0),
    falabellaAligned: Number(aligned.updated || 0),
    falabellaOverdue: Number(overdue.updated || 0),
    ripley: Number(ripley.updated || 0),
  };
}
