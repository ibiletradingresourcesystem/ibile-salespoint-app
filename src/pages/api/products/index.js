/**
 * API Endpoint: GET /api/products
 * 
 * Fetches all products from database with optional filtering
 * Query params:
 * - category: Filter by category ObjectId
 * - search: Search by product name
 * - locationId: Filter by store location ID (resolves name from Store)
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import Product from "@/src/models/Product";
import Store from "@/src/models/Store";
import { releaseExpiredRoomBookings } from "@/src/lib/roomAvailability";

const normalizeLocationToken = (value) => String(value || "").trim().toLowerCase();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const { category, search, locationId } = req.query;
    await releaseExpiredRoomBookings();
    
    let query = {};

    // Filter by category if provided
    if (category) {
      query.category = category;
    }

    // Search by product name if provided
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    let products = await Product.find(query)
      .select("_id name category salePriceIncTax quantity images description locations isChildProduct parentProduct packType qtyPerPack childSalePrice productType roomStatus currentBooking")
      .limit(500)
      .lean();

    // Filter by location in JavaScript (more reliable than $or with mixed data)
    // POS should only show products explicitly assigned to the active location.
    if (locationId && products.length > 0) {
      let locationName = null;
      try {
        const store = await Store.findOne().lean();
        if (store?.locations && Array.isArray(store.locations)) {
          const found = store.locations.find(
            (loc) => (loc._id?.toString ? loc._id.toString() : String(loc._id)) === locationId
          );
          if (found) locationName = found.name;
        }
      } catch (storeErr) {
        console.warn("⚠️ Could not look up store for location filter:", storeErr.message);
      }

      const locationTokens = new Set([
        normalizeLocationToken(locationId),
        normalizeLocationToken(locationName),
      ].filter(Boolean));

      products = products.filter((product) => {
        if (!Array.isArray(product.locations) || product.locations.length === 0) {
          return false;
        }

        return product.locations.some((locationEntry) => {
          if (locationEntry && typeof locationEntry === "object") {
            return [locationEntry._id, locationEntry.id, locationEntry.name, locationEntry.code].some((candidate) => {
              const token = normalizeLocationToken(candidate);
              return token && locationTokens.has(token);
            });
          }

          const token = normalizeLocationToken(locationEntry);
          return token && locationTokens.has(token);
        });
      });

      console.log(`📍 Location filter: "${locationName || locationId}" | ${products.length} products after filter`);
    }

    // Derive child product quantities from their parent
    // Child qty = parent.qty × qtyPerPack (always computed, never stored independently)
    const childProducts = products.filter((p) => p.isChildProduct && p.parentProduct);
    if (childProducts.length > 0) {
      // Collect all parent IDs needed
      const parentIds = [...new Set(childProducts.map((p) => String(p.parentProduct)))];
      const parents = await Product.find({ _id: { $in: parentIds } })
        .select("_id quantity qtyPerPack")
        .lean();
      const parentMap = new Map(parents.map((p) => [String(p._id), p]));

      for (const child of childProducts) {
        const parent = parentMap.get(String(child.parentProduct));
        if (parent && parent.qtyPerPack > 0) {
          child.quantity = parent.quantity * parent.qtyPerPack;
        }
      }
    }

    return res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (err) {
    console.error("❌ Products API Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: err.message,
    });
  }
}
