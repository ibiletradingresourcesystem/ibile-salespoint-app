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
    const allProductNames = [];
    (vendors || []).forEach((v) => {
      if (Array.isArray(v.products)) {
        v.products.forEach((p) => {
          if (p.product) allProductIds.push(p.product);
          else if (p.productName) allProductNames.push(p.productName);
        });
      }
    });

    const idQuery = allProductIds.length > 0
      ? Product.find({ _id: { $in: [...new Set(allProductIds.map(String))] } })
          .select("_id name costPrice salePriceIncTax barcode quantity")
          .lean()
      : Promise.resolve([]);
    const nameQuery = allProductNames.length > 0
      ? Product.find({ name: { $in: allProductNames } })
          .select("_id name costPrice salePriceIncTax barcode quantity")
          .lean()
      : Promise.resolve([]);

    const [dbProductsById, dbProductsByName] = await Promise.all([idQuery, nameQuery]);
    const productMap = new Map(dbProductsById.map((p) => [String(p._id), p]));
    const productNameMap = new Map(dbProductsByName.map((p) => [p.name, p]));

    const vendorsWithProducts = (vendors || []).map((vendor) => {
      if (!Array.isArray(vendor.products) || vendor.products.length === 0) return vendor;

      vendor.products = vendor.products
        .map((vp) => {
          let dbProd = null;
          if (vp.product) {
            dbProd = productMap.get(String(vp.product));
          }
          if (!dbProd && vp.productName) {
            dbProd = productNameMap.get(vp.productName);
          }
          if (!dbProd) return null;
          return {
            ...vp,
            productId: String(dbProd._id),
            productName: dbProd.name || vp.productName || "",
            costPrice: dbProd.costPrice || vp.price || 0,
            currentStock: dbProd.quantity || 0,
          };
        })
        .filter(Boolean);

      return vendor;
    });

    return res.status(200).json({ success: true, vendors: vendorsWithProducts });
  } catch (err) {
    console.error("Petty cash vendors fetch error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
