/**
 * Parent-child product quantity management.
 * 
 * RULE: Child qty is ALWAYS derived from parent: child.qty = parent.qty * qtyPerPack.
 * Child qty must NEVER be decremented/incremented directly.
 *
 * updateInventoryForSale(items):
 *   Replaces the naive for-loop in transaction endpoints.
 *   - For normal products: decrement quantity directly
 *   - For child products: redirect decrement to parent, then derive child qty
 *   - For parent products: decrement parent, then derive child qty
 *
 * reverseInventoryForRefund(items):
 *   Reverses a sale (restock). Same logic but increments instead.
 *
 * deriveChildQty(productId):
 *   Recalculates child qty from parent. Use after any non-sale qty change.
 */

import Product from "@/src/models/Product";

/**
 * Smart inventory update for a sale. Replaces the old for-loop + syncParentChildQty pattern.
 * items = [{ productId, qty, name? }]
 */
export async function updateInventoryForSale(items) {
  if (!items || items.length === 0) return;

  const validItems = items.filter(i => i.productId && i.qty);
  if (validItems.length === 0) return;

  // Pre-fetch all sold products to know which are children/parents
  const productIds = validItems.map(i => i.productId);
  const soldProducts = await Product.find({ _id: { $in: productIds } })
    .select("_id isChildProduct parentProduct packType qtyPerPack")
    .lean();
  const productMap = new Map(soldProducts.map(p => [String(p._id), p]));

  // Separate: normal/parent decrements vs child-to-parent redirects
  const directDecrements = [];          // normal + parent products
  const childToParent = new Map();      // parentId -> total child units sold

  for (const item of validItems) {
    const product = productMap.get(String(item.productId));

    if (product && product.isChildProduct && product.parentProduct && product.packType !== "pack") {
      // CHILD sold -> DO NOT touch child qty. Redirect to parent.
      const parentId = String(product.parentProduct);
      const current = childToParent.get(parentId) || 0;
      childToParent.set(parentId, current + item.qty);
      console.log(`📦 Child "${item.name || item.productId}" sold ${item.qty} units → redirecting to parent ${parentId}`);
    } else {
      // Normal or parent product -> decrement directly
      directDecrements.push(item);
    }
  }

  // 1. Decrement normal/parent products
  for (const item of directDecrements) {
    const result = await Product.findByIdAndUpdate(
      item.productId,
      { $inc: { quantity: -item.qty } },
      { new: true }
    );
    if (result) {
      console.log(`✅ ${item.name || item.productId}: sold ${item.qty}, remaining ${result.quantity}`);
    }
  }

  // 2. Decrement parents for child sales (convert units to packs)
  for (const [parentId, totalUnitsSold] of childToParent.entries()) {
    const parent = await Product.findById(parentId).select("qtyPerPack").lean();
    if (parent && parent.qtyPerPack > 0) {
      const packDecrement = totalUnitsSold / parent.qtyPerPack;
      const updated = await Product.findByIdAndUpdate(
        parentId,
        { $inc: { quantity: -packDecrement } },
        { new: true }
      );
      console.log(`📦 Parent ${parentId}: -${packDecrement} packs (${totalUnitsSold} units sold), remaining ${updated.quantity}`);
    }
  }

  // 3. Derive child qty for ALL affected parents
  const affectedParentIds = new Set([
    ...childToParent.keys(),
    ...directDecrements
      .filter(item => {
        const p = productMap.get(String(item.productId));
        return p && p.packType === "pack" && p.qtyPerPack > 0;
      })
      .map(item => String(item.productId)),
  ]);

  for (const parentId of affectedParentIds) {
    const parent = await Product.findById(parentId).select("quantity qtyPerPack").lean();
    if (!parent || !parent.qtyPerPack) continue;

    const child = await Product.findOne({
      parentProduct: parentId,
      isChildProduct: true,
      packType: { $ne: "pack" },
    }).select("_id").lean();

    if (child) {
      const newChildQty = parent.quantity * parent.qtyPerPack;
      await Product.findByIdAndUpdate(child._id, { $set: { quantity: newChildQty } });
      console.log(`🔗 Child ${child._id} qty derived = ${parent.quantity} × ${parent.qtyPerPack} = ${newChildQty}`);
    }
  }
}

/**
 * Reverse inventory for a refund/restock.
 * items = [{ productId, qty }]
 */
export async function reverseInventoryForRefund(items) {
  if (!items || items.length === 0) return;

  const validItems = items.filter(i => i.productId && i.qty);
  if (validItems.length === 0) return;

  const productIds = validItems.map(i => i.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id isChildProduct parentProduct packType qtyPerPack")
    .lean();
  const productMap = new Map(products.map(p => [String(p._id), p]));

  const directIncrements = [];
  const childToParent = new Map();

  for (const item of validItems) {
    const product = productMap.get(String(item.productId));
    if (product && product.isChildProduct && product.parentProduct && product.packType !== "pack") {
      const parentId = String(product.parentProduct);
      const current = childToParent.get(parentId) || 0;
      childToParent.set(parentId, current + Number(item.qty));
    } else {
      directIncrements.push(item);
    }
  }

  for (const item of directIncrements) {
    await Product.findByIdAndUpdate(item.productId, { $inc: { quantity: Number(item.qty) } });
  }

  for (const [parentId, totalUnits] of childToParent.entries()) {
    const parent = await Product.findById(parentId).select("qtyPerPack").lean();
    if (parent && parent.qtyPerPack > 0) {
      await Product.findByIdAndUpdate(parentId, { $inc: { quantity: totalUnits / parent.qtyPerPack } });
    }
  }

  // Derive child qty for all affected parents
  const allParentIds = new Set([
    ...childToParent.keys(),
    ...directIncrements
      .filter(item => {
        const p = productMap.get(String(item.productId));
        return p && p.packType === "pack" && p.qtyPerPack > 0;
      })
      .map(item => String(item.productId)),
  ]);

  for (const parentId of allParentIds) {
    await deriveChildQty(parentId);
  }
}

/**
 * Derive child qty from parent after any direct parent qty change.
 * Works if you pass either a parent ID or a child ID.
 */
export async function deriveChildQty(productId) {
  try {
    const product = await Product.findById(productId)
      .select("isChildProduct parentProduct packType qtyPerPack quantity")
      .lean();
    if (!product) return;

    if (product.isChildProduct && product.parentProduct && product.packType !== "pack") {
      const parent = await Product.findById(product.parentProduct)
        .select("quantity qtyPerPack")
        .lean();
      if (parent && parent.qtyPerPack > 0) {
        const newChildQty = parent.quantity * parent.qtyPerPack;
        await Product.findByIdAndUpdate(productId, { $set: { quantity: newChildQty } });
      }
    } else if (product.packType === "pack" && product.qtyPerPack > 0) {
      const child = await Product.findOne({
        parentProduct: productId,
        isChildProduct: true,
        packType: { $ne: "pack" },
      }).select("_id").lean();
      if (child) {
        const newChildQty = product.quantity * product.qtyPerPack;
        await Product.findByIdAndUpdate(child._id, { $set: { quantity: newChildQty } });
      }
    }
  } catch (err) {
    console.warn("⚠️ deriveChildQty error:", err.message);
  }
}
