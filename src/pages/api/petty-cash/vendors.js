/**
 * API Endpoint: GET /api/petty-cash/vendors
 * 
 * Fetch petty cash vendors for the POS system (includes their product lists)
 */
import { mongooseConnect } from "@/src/lib/mongoose";
import mongoose from "mongoose";

const VendorSchema = new mongoose.Schema({}, { strict: false, collection: "vendors" });
const Vendor = mongoose.models.Vendor || mongoose.model("Vendor", VendorSchema);

const ProductSchema = new mongoose.Schema({}, { strict: false, collection: "products" });
const Product = mongoose.models.Product || mongoose.model("Product", ProductSchema);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const vendors = await Vendor.find({ vendorType: "petty-cash", isActive: { $ne: false } })
      .sort({ companyName: 1 })
      .lean();

    // Resolve product details for each vendor
    const vendorsWithProducts = await Promise.all(
      (vendors || []).map(async (vendor) => {
        if (!Array.isArray(vendor.products) || vendor.products.length === 0) {
          return vendor;
        }
        const productIds = vendor.products
          .map((p) => p.product)
          .filter(Boolean);

        const dbProducts = productIds.length > 0
          ? await Product.find({ _id: { $in: productIds } })
              .select("_id name costPrice salePriceIncTax barcode quantity")
              .lean()
          : [];

        const productMap = {};
        dbProducts.forEach((p) => { productMap[String(p._id)] = p; });

        vendor.products = vendor.products.map((vp) => {
          const dbProd = productMap[String(vp.product)] || {};
          return {
            ...vp,
            productId: String(vp.product),
            productName: vp.productName || dbProd.name || "",
            costPrice: dbProd.costPrice || vp.price || 0,
            currentStock: dbProd.quantity || 0,
          };
        });

        return vendor;
      })
    );

    return res.status(200).json({ success: true, vendors: vendorsWithProducts });
  } catch (err) {
    console.error("Petty cash vendors fetch error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
