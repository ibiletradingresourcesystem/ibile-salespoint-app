/**
 * API Endpoint: GET /api/petty-cash/vendors
 * 
 * Fetch petty cash vendors for the POS system (includes their product lists)
 */
import { mongooseConnect } from "@/src/lib/mongoose";
import mongoose from "mongoose";

const VendorSchema = new mongoose.Schema({}, { strict: false, collection: "vendors" });
const Vendor = mongoose.models.Vendor || mongoose.model("Vendor", VendorSchema);

import Product from "@/src/models/Product";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const vendors = await Vendor.find({ vendorType: "petty-cash", isActive: { $ne: false } })
      .sort({ companyName: 1 })
      .lean();

    // Batch load all referenced products in one query
    const allProductIds = [];
    (vendors || []).forEach((v) => {
      if (Array.isArray(v.products)) {
        v.products.forEach((p) => { if (p.product) allProductIds.push(p.product); });
      }
    });

    const dbProducts = allProductIds.length > 0
      ? await Product.find({ _id: { $in: [...new Set(allProductIds.map(String))] } })
          .select("_id name costPrice salePriceIncTax barcode quantity")
          .lean()
      : [];
    const productMap = new Map(dbProducts.map((p) => [String(p._id), p]));

    const vendorsWithProducts = (vendors || []).map((vendor) => {
      if (!Array.isArray(vendor.products) || vendor.products.length === 0) return vendor;

      vendor.products = vendor.products.map((vp) => {
        const dbProd = productMap.get(String(vp.product)) || {};
        const resolvedId = vp.product ? String(vp.product) : "";
        return {
          ...vp,
          productId: resolvedId,
          productName: vp.productName || dbProd.name || "",
          costPrice: dbProd.costPrice || vp.price || 0,
          currentStock: dbProd.quantity || 0,
        };
      });

      return vendor;
    });

    return res.status(200).json({ success: true, vendors: vendorsWithProducts });
  } catch (err) {
    console.error("Petty cash vendors fetch error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
