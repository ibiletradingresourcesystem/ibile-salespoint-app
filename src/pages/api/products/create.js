/**
 * API Endpoint: POST /api/products/create
 * 
 * Creates a new product in the database
 * Use this to add real products instead of relying on seed data
 * 
 * Example request body:
 * {
 *   "name": "Coca Cola 500ml",
 *   "category": "Drinks",
 *   "costPrice": 150,
 *   "salePriceIncTax": 399,
 *   "quantity": 100,
 *   "description": "Refreshing cola",
 *   "barcode": "12345"
 * }
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import Product from "@/src/models/Product";
import { sanitizeBody } from '@/src/lib/apiValidation';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  req.body = sanitizeBody(req.body);

  try {
    await mongooseConnect();
    console.log("📦 Creating product:", req.body);

    const { name, category, costPrice, salePriceIncTax, quantity, description, barcode } = req.body;

    // Validate required fields
    if (!name || !category || salePriceIncTax === undefined) {
      return res.status(400).json({
        success: false,
        message: "Required fields: name, category, salePriceIncTax",
      });
    }

    // Check if product already exists
    const existing = await Product.findOne({ name, category });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Product already exists",
      });
    }

    // Create new product
    const product = new Product({
      name,
      category,
      costPrice: costPrice || 0,
      salePriceIncTax,
      quantity: quantity || 0,
      description: description || "",
      barcode: barcode || "",
      taxRate: 5,
      margin: (salePriceIncTax - (costPrice || 0)) || 0,
      minStock: 5,
      maxStock: 1000,
      images: [],
    });

    await product.save();
    console.log("✅ Product created:", product._id);

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      product: {
        _id: product._id,
        name: product.name,
        category: product.category,
        salePriceIncTax: product.salePriceIncTax,
      },
    });
  } catch (err) {
    console.error("❌ Error creating product:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create product",
      error: err.message,
    });
  }
}
