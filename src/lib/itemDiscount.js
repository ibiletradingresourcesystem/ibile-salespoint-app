/**
 * Line-item discounts applied from the cart.
 *
 * A discount is stored on the cart item as:
 *   discount         – naira taken off the whole line (price × qty)
 *   discountDetails  – how it was worked out: { mode, value, reason, note, appliedBy, appliedById, appliedAt }
 * Keeping the mode and value means the line discount follows quantity changes.
 */

import { normalizeStaffRole, hasPosPermission } from './posPermissions';

export const DISCOUNT_MODES = {
  PERCENT: 'percent',
  PRICE: 'price',
};

export const DISCOUNT_REASONS = [
  'Close to expiry',
  'Damaged / defective product',
  'Price match',
  'Bulk purchase',
  'Loyal customer',
  'Staff purchase',
  'Pricing error',
  'Other',
];

export const QUICK_PERCENTAGES = [5, 10, 15, 20, 25, 50];

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** Only admins and managers (sub-admins) who still have the discount permission can discount */
export function canStaffApplyDiscount(staff) {
  if (!staff) return false;
  const rawRole = String(staff.role || '').trim().toLowerCase();
  const isSubAdmin = /^sub[\s_-]?admin$/.test(rawRole);
  const role = normalizeStaffRole(staff.role);
  const hasSeniorRole = role === 'admin' || role === 'manager' || isSubAdmin;
  return hasSeniorRole && hasPosPermission(staff, 'applyDiscount');
}

/**
 * Work out a line discount.
 * Returns { valid, error, unitPrice, newUnitPrice, unitDiscount, lineDiscount, percent, lineTotal, newLineTotal }
 */
export function calculateItemDiscount({ price, quantity, mode, value }) {
  const unitPrice = Math.max(0, Number(price) || 0);
  const qty = Math.max(1, Number(quantity) || 1);
  const lineTotal = roundMoney(unitPrice * qty);
  const raw = String(value ?? '').trim();
  const number = Number(raw);
  const base = { valid: false, error: '', unitPrice, newUnitPrice: unitPrice, unitDiscount: 0, lineDiscount: 0, percent: 0, lineTotal, newLineTotal: lineTotal };

  if (unitPrice <= 0) return { ...base, error: 'This item has no price to discount' };
  if (raw === '' || !Number.isFinite(number)) return { ...base, error: mode === DISCOUNT_MODES.PRICE ? 'Enter the new price' : 'Enter the percentage off' };

  let newUnitPrice;
  if (mode === DISCOUNT_MODES.PRICE) {
    if (number < 0) return { ...base, error: 'The new price cannot be below ₦0' };
    if (number >= unitPrice) return { ...base, error: 'The new price must be lower than the current price' };
    newUnitPrice = roundMoney(number);
  } else {
    if (number <= 0) return { ...base, error: 'The percentage must be more than 0' };
    if (number > 100) return { ...base, error: 'The percentage cannot be more than 100' };
    newUnitPrice = roundMoney(unitPrice * (1 - number / 100));
  }

  const unitDiscount = roundMoney(unitPrice - newUnitPrice);
  const lineDiscount = roundMoney(unitDiscount * qty);
  return {
    valid: true,
    error: '',
    unitPrice,
    newUnitPrice,
    unitDiscount,
    lineDiscount,
    percent: roundMoney((unitDiscount / unitPrice) * 100),
    lineTotal,
    newLineTotal: roundMoney(lineTotal - lineDiscount),
  };
}

/** Item with its discount recalculated from discountDetails (after a quantity or price change) */
export function applyDiscountDetails(item, details) {
  if (!details) return { ...item, discount: 0, discountDetails: null };
  const result = calculateItemDiscount({ price: item.price, quantity: item.quantity, mode: details.mode, value: details.value });
  if (!result.valid) return { ...item, discount: 0, discountDetails: null };
  return { ...item, discount: result.lineDiscount, discountDetails: details };
}

export function describeItemDiscount(details) {
  if (!details) return '';
  const amount = details.mode === DISCOUNT_MODES.PRICE
    ? `new price ₦${Number(details.value).toLocaleString('en-NG')}`
    : `${Number(details.value)}% off`;
  const reason = details.reason === 'Other' && details.note ? details.note : details.reason;
  return [reason, amount].filter(Boolean).join(' · ');
}

/** Totals and wording for all line discounts in a cart */
export function summarizeItemDiscounts(items = []) {
  const discounted = items.filter((item) => Number(item.discount) > 0);
  const total = roundMoney(discounted.reduce((sum, item) => sum + Number(item.discount || 0), 0));
  const reasons = [...new Set(discounted.map((item) => {
    const details = item.discountDetails;
    return details?.reason === 'Other' && details?.note ? details.note : details?.reason;
  }).filter(Boolean))];

  return {
    total,
    count: discounted.length,
    label: reasons.length === 1 ? `Discount (${reasons[0]})` : 'Discount',
    reasonText: discounted
      .map((item) => `${item.name}: ${describeItemDiscount(item.discountDetails) || 'discount'} (-₦${Number(item.discount).toLocaleString('en-NG')})${item.discountDetails?.appliedBy ? ` by ${item.discountDetails.appliedBy}` : ''}`)
      .join('; '),
  };
}
