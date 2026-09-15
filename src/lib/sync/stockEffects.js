/**
 * The stock effect a transaction currently has on inventory, read from its own guard flags.
 *
 * The POS routes keep these flags accurate:
 *   - sale/credit sale: updateInventoryForSale, then inventoryUpdated = true
 *   - edit:             reverse old items, inventoryUpdated = false, re-apply if still a sale
 *   - refund:           reverseInventoryForRefund, then inventoryRestockedAt = now
 *
 * So a transaction's items are "applied" exactly when inventoryUpdated && !inventoryRestockedAt.
 * When the desktop pushes a transaction, the cloud compares this effect on its own copy with the
 * incoming copy and applies only the difference, which makes retries and edits safe.
 */

import { createHash } from 'crypto';

export function appliedStockItems(doc) {
  if (!doc || doc.inventoryUpdated !== true || doc.inventoryRestockedAt) return [];

  return (Array.isArray(doc.items) ? doc.items : [])
    .map((item) => ({
      ...item,
      productId: item.productId || item.id,
      qty: Number(item.qty ?? item.quantity ?? 0),
    }))
    .filter((item) => item.productId && item.qty);
}

const toQtyMap = (items) => {
  const map = new Map();
  for (const item of items) {
    const key = String(item.productId);
    map.set(key, (map.get(key) || 0) + Number(item.qty || 0));
  }
  return map;
};

/**
 * Fingerprint of the parts of a sale that affect money and stock. The cloud stores it with each
 * sale it receives from a desktop; if the cloud copy no longer matches, it was changed elsewhere
 * (for example an approved refund or a credit payment in the management app) and a later push from
 * the till must not overwrite it.
 */
export function saleStateFingerprint(doc) {
  const credits = Array.isArray(doc?.creditPayments) ? doc.creditPayments : [];
  const state = {
    status: doc?.status ?? null,
    subStatus: doc?.subStatus ?? null,
    total: Number(doc?.total || 0),
    inventoryUpdated: doc?.inventoryUpdated === true,
    restockedAt: doc?.inventoryRestockedAt ? new Date(doc.inventoryRestockedAt).getTime() : null,
    items: [...toQtyMap((doc?.items || []).map((item) => ({ productId: item.productId || item.id, qty: Number(item.qty ?? item.quantity ?? 0) })))]
      .sort(([left], [right]) => left.localeCompare(right)),
    creditStatus: doc?.creditStatus ?? null,
    creditPaid: credits.length > 0
      ? credits.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0)
      : Number(doc?.creditPaidAmount || 0),
  };
  return createHash('sha1').update(JSON.stringify(state)).digest('hex');
}

export function sameStockEffect(left, right) {
  const a = toQtyMap(left);
  const b = toQtyMap(right);
  if (a.size !== b.size) return false;
  for (const [key, qty] of a) {
    if (Math.abs((b.get(key) ?? NaN) - qty) > 1e-9) return false;
  }
  return true;
}
