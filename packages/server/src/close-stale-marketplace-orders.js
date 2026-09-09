import { closeStaleFalabellaFulfillment } from './order-adapters/falabella.js';
import { closeStaleRipleyShippedFulfillment } from './order-adapters/ripley.js';

export async function closeStaleMarketplaceFulfillment(db) {
  if (!db?.query) return { falabella: 0, ripley: 0 };
  const falabella = await closeStaleFalabellaFulfillment(db);
  const ripley = await closeStaleRipleyShippedFulfillment(db);
  return {
    falabella: Number(falabella.updated || 0),
    ripley: Number(ripley.updated || 0),
  };
}
