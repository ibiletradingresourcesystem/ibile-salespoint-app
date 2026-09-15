/**
 * Parent-child product quantity management.
 *
 * RULE: Child qty is ALWAYS derived from parent. A parent can have many children:
 *   child.qty = parent.qty × parent.qtyPerPack ÷ child.unitsPerChild
 * Child qty must NEVER be decremented/incremented directly.
 *
 * updateInventoryForSale(items):
 *   Replaces the naive for-loop in transaction endpoints.
 *   - For normal products: decrement quantity directly
 *   - For child products: redirect decrement to parent (by the child's share of a pack), then derive children
 *   - For parent products: decrement parent, then derive children
 *
 * reverseInventoryForRefund(items):
 *   Reverses a sale (restock). Same logic but increments instead.
 *
 * deriveChildQty(productId):
 *   Recalculates children qty from the parent. Use after any non-sale qty change.
 *
 * Each function accepts an optional { session } so cloud sync can apply stock changes inside
 * the same MongoDB transaction as the synced sale (src/lib/sync/cloudApply.js).
 */

import Product from "@/src/models/Product";
import { isRoomProduct } from "@/src/lib/roomReservations";
import { childQtyToParentQty, deriveChildQuantity, isDerivedChild } from "@/src/lib/packUnits";

const CHILD_FILTER = { isChildProduct: true, packType: { $ne: "pack" } };

async function applyInventoryChange(items, sign, { session = null } = {}) {
  if (!items || items.length === 0) return;

  const validItems = items.filter(i => i.productId && Number(i.qty) && !isRoomProduct(i));
  if (validItems.length === 0) return;

  // Pre-fetch all products to know which are children/parents
  const productIds = validItems.map(i => i.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id isChildProduct parentProduct packType qtyPerPack unitsPerChild productType")
    .session(session)
    .lean();
  const productMap = new Map(products.map(p => [String(p._id), p]));

  const directChanges = [];            // normal + parent products
  const childItemsByParent = new Map(); // parentId -> [{ child, qty, name }]

  for (const item of validItems) {
    const product = productMap.get(String(item.productId));

    if (isRoomProduct(product)) {
      continue;
    }

    if (isDerivedChild(product)) {
      // CHILD -> DO NOT touch child qty. Redirect to parent.
      const parentId = String(product.parentProduct);
      const childItems = childItemsByParent.get(parentId) || [];
      childItems.push({ child: product, qty: Number(item.qty), name: item.name });
      childItemsByParent.set(parentId, childItems);
    } else {
      directChanges.push({ productId: item.productId, qty: Number(item.qty), name: item.name });
    }
  }

  // 1. Normal/parent products change directly
  for (const item of directChanges) {
    const result = await Product.findByIdAndUpdate(
      item.productId,
      { $inc: { quantity: sign * item.qty } },
      { new: true, session }
    );
    if (result) {
      console.log(`✅ ${item.name || item.productId}: ${sign < 0 ? "sold" : "restocked"} ${item.qty}, now ${result.quantity}`);
    }
  }

  // 2. Parents change by each child's share of a pack
  if (childItemsByParent.size > 0) {
    const parents = await Product.find({ _id: { $in: [...childItemsByParent.keys()] } })
      .select("_id qtyPerPack")
      .session(session)
      .lean();
    for (const parent of parents) {
      const childItems = childItemsByParent.get(String(parent._id));
      const packs = childItems.reduce((sum, { child, qty }) => sum + childQtyToParentQty(qty, child, parent), 0);
      if (!packs) continue;
      const updated = await Product.findByIdAndUpdate(
        parent._id,
        { $inc: { quantity: sign * packs } },
        { new: true, session }
      );
      console.log(`📦 Parent ${parent._id}: ${sign < 0 ? "-" : "+"}${packs} packs from child items, now ${updated?.quantity}`);
    }
  }

  // 3. Derive child qty for ALL affected parents
  const affectedParentIds = new Set(childItemsByParent.keys());
  for (const { productId } of directChanges) {
    if (productMap.get(String(productId))?.packType === "pack") {
      affectedParentIds.add(String(productId));
    }
  }

  for (const parentId of affectedParentIds) {
    await deriveChildrenForParent(parentId, { session });
  }
}

/**
 * Smart inventory update for a sale. Replaces the old for-loop + syncParentChildQty pattern.
 * items = [{ productId, qty, name? }]
 */
export async function updateInventoryForSale(items, options) {
  await applyInventoryChange(items, -1, options);
}

/**
 * Reverse inventory for a refund/restock.
 * items = [{ productId, qty }]
 */
export async function reverseInventoryForRefund(items, options) {
  await applyInventoryChange(items, 1, options);
}

/**
 * Set every child's qty from its parent's current stock.
 */
export async function deriveChildrenForParent(parentId, { session = null } = {}) {
  const [parent, children] = await Promise.all([
    Product.findById(parentId).select("_id quantity qtyPerPack").session(session).lean(),
    Product.find({ parentProduct: parentId, ...CHILD_FILTER }).select("_id quantity unitsPerChild").session(session).lean(),
  ]);
  if (!parent || children.length === 0) return;

  const bulkOps = children
    .map((child) => ({ child, quantity: deriveChildQuantity(parent.quantity, parent, child) }))
    .filter(({ child, quantity }) => child.quantity !== quantity)
    .map(({ child, quantity }) => ({
      updateOne: { filter: { _id: child._id }, update: { $set: { quantity } } },
    }));

  if (bulkOps.length > 0) {
    await Product.bulkWrite(bulkOps, { session });
  }
}

/**
 * Derive child qty from parent after any direct parent qty change.
 * Works if you pass either a parent ID or a child ID.
 */
export async function deriveChildQty(productId) {
  try {
    const product = await Product.findById(productId)
      .select("_id isChildProduct parentProduct packType")
      .lean();
    if (!product) return;

    if (isDerivedChild(product)) {
      await deriveChildrenForParent(product.parentProduct);
    } else if (product.packType === "pack") {
      await deriveChildrenForParent(product._id);
    }
  } catch (err) {
    console.warn("⚠️ deriveChildQty error:", err.message);
  }
}
