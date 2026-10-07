/**
 * Line-item discounts applied from the cart.
 *
 * A discount is stored on the cart item as:
 *   discount         – naira taken off the whole line (price × qty)
 *   discountDetails  – how it was worked out: { mode, value, reason, note, appliedBy, appliedById, appliedAt }
 * Keeping the mode and value means the line discount follows quantity changes.
 *
 * A product on promotion carries it on the line (promotion, promotionDetails) and its discount
 * details are the promotion's ({ mode: 'promotion', reason: its name, promotion }). A discount
 * staff give replaces it; removing that discount puts the promotion back.
 */

import { normalizeStaffRole, hasPosPermission } from './posPermissions';
import { describePromotion, promotionBlock, promotionDiscount, promotionLabel } from './promotionRules';

export const DISCOUNT_MODES = {
  PERCENT: 'percent',
  PRICE: 'price',
  // A product promotion, applied by the till: { mode, reason (its name), promotion (the deal) }
  PROMOTION: 'promotion',
};

/**
 * The line discount a product's promotion gives right now, for this customer type, or null when
 * it does not apply (not started, over, not one of its days, or kept for other customers).
 */
export function promotionDetailsFor(promotion, { now = new Date(), customerType = null } = {}) {
  if (!promotion || promotionBlock(promotion, { now, customerType })) return null;
  return { mode: DISCOUNT_MODES.PROMOTION, reason: promotionLabel(promotion), promotion };
}

export const isPromotionDiscount = (details) => details?.mode === DISCOUNT_MODES.PROMOTION;

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

/**
 * Item with its discount recalculated from discountDetails (after a quantity or price change).
 * Taking a staff discount off (details null) puts the line back on its promotion, if it has one.
 */
export function applyDiscountDetails(item, details) {
  const effective = details || item.promotionDetails || null;
  if (!effective) return { ...item, discount: 0, discountDetails: null };
  if (isPromotionDiscount(effective)) {
    // Kept on the line even when it takes nothing off yet: "buy 2" starts paying at the second one
    const discount = promotionDiscount(effective.promotion, { unitPrice: item.price, quantity: item.quantity });
    return { ...item, discount, discountDetails: effective };
  }
  const result = calculateItemDiscount({ price: item.price, quantity: item.quantity, mode: effective.mode, value: effective.value });
  if (!result.valid) return { ...item, discount: 0, discountDetails: null };
  return { ...item, discount: result.lineDiscount, discountDetails: effective };
}

export function describeItemDiscount(details) {
  if (!details) return '';
  if (isPromotionDiscount(details)) return [details.reason, describePromotion(details.promotion)].filter(Boolean).join(' · ');
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
  const manual = discounted.filter((item) => !isPromotionDiscount(item.discountDetails));
  const reasons = [...new Set(manual.map((item) => {
    const details = item.discountDetails;
    return details?.reason === 'Other' && details?.note ? details.note : details?.reason;
  }).filter(Boolean))];
  const promotionTotal = roundMoney(
    discounted.filter((item) => isPromotionDiscount(item.discountDetails)).reduce((sum, item) => sum + Number(item.discount || 0), 0)
  );

  return {
    total,
    promotionTotal,
    count: discounted.length,
    label: manual.length === 0 && promotionTotal > 0
      ? 'Promotions'
      : reasons.length === 1 ? `Discount (${reasons[0]})` : 'Discount',
    reasonText: discounted
      .map((item) => `${item.name}: ${describeItemDiscount(item.discountDetails) || 'discount'} (-₦${Number(item.discount).toLocaleString('en-NG')})${item.discountDetails?.appliedBy ? ` by ${item.discountDetails.appliedBy}` : ''}`)
      .join('; '),
  };
}
