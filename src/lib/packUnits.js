/**
 * Pack / child unit maths (kept identical to the inventory app's lib/packUnits.js).
 *
 * A parent (mother) product is a pack holding `qtyPerPack` base units, e.g. a pack of 24.
 * A parent can have many children, each holding `unitsPerChild` of those base units
 * (e.g. unit of 6, unit of 2, unit of 1). Children have no stock of their own:
 *   child.qty = parent.qty × parent.qtyPerPack ÷ child.unitsPerChild
 */

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function roundQty(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

export function isDerivedChild(product) {
  return Boolean(product?.isChildProduct && product?.parentProduct && product?.packType !== "pack");
}

export function getPackSize(parent) {
  return positiveNumber(parent?.qtyPerPack);
}

export function getUnitsPerChild(child) {
  return positiveNumber(child?.unitsPerChild);
}

/** Parent packs used up when `childQty` of a child is sold or refunded. */
export function childQtyToParentQty(childQty, child, parent) {
  return ((Number(childQty) || 0) * getUnitsPerChild(child)) / getPackSize(parent);
}

/** Whole child items available from `parentQty` packs of the parent. */
export function deriveChildQuantity(parentQty, parent, child) {
  const childQty = roundQty(((Number(parentQty) || 0) * getPackSize(parent)) / getUnitsPerChild(child));
  return Math.trunc(childQty) || 0;
}
