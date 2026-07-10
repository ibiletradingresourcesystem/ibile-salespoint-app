/**
 * API Endpoint: POST /api/categories/create
 * 
 * Creates a new category in the database
 * Use this to add real categories instead of relying on seed data
 * 
 * Example request body:
 * {
 *   "name": "Drinks"
 * }
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import { Category } from "@/src/models/Category";
import { sanitizeBody } from '@/src/lib/apiValidation';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  req.body = sanitizeBody(req.body);

  try {
    await mongooseConnect();
    console.log("📦 Creating category:", req.body);

    const { name } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Required field: name",
      });
    }

    // Check if category already exists
    const existing = await Category.findOne({ name });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Category already exists",
      });
    }

    // Create new category
    const category = new Category({
      name,
    });

    await category.save();
    console.log("✅ Category created:", category._id);

    return res.status(201).json({
      success: true,
      message: "Category created successfully",
      category: {
        _id: category._id,
        name: category.name,
      },
    });
  } catch (err) {
    console.error("❌ Error creating category:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create category",
      error: err.message,
    });
  }
}
