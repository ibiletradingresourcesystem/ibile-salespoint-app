/**
 * Is this sale worth anything?
 *
 * A product whose sale price is 0 — usually a price list imported with an empty or zero Sale
 * column — rings up as a free item, so a whole basket can come to nothing. That looks like a
 * completed sale on the till but is not one, and it is easy to miss until the day's takings are
 * counted. The till refuses it and says which products have no price.
 *
 * A deliberate giveaway still goes through: the check looks at the prices on the items, before any
 * discount, so a 100% discount or a promotion that takes the total to zero is unaffected.
 */

const lineGross = (item) => {
  const price = Number(item?.price ?? item?.salePriceIncTax ?? 0) || 0;
  const quantity = Number(item?.quantity ?? item?.qty ?? 0) || 0;
  return price * quantity;
};

/** '' when the sale can go through, otherwise the reason to show the person at the till. */
export function zeroValueSaleMessage(transaction) {
  const items = Array.isArray(transaction?.items) ? transaction.items : [];
  if (items.length === 0) return 'This sale has no items.';
  if (items.some((item) => lineGross(item) > 0)) return '';

  const names = [...new Set(items.map((item) => item?.name).filter(Boolean))];
  const shown = names.slice(0, 3).join(', ');
  const rest = names.length > 3 ? ` and ${names.length - 3} more` : '';
  const subject = shown ? `${shown}${rest}` : 'The items in this sale';

  return `${subject} ${names.length === 1 ? 'has' : 'have'} no price, so this sale is worth nothing. Set the price in the management app and sync products, then ring it up again.`;
}
