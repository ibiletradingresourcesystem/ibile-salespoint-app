/**
 * API Endpoint: GET /api/categories
 * 
 * Fetches product categories from database
 * Supports filtering by location (store)
 * Query params:
 *   - location: Store location ID (optional)
 * 
 * Categories are stored in Store.locations[].categories array
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import Store from "@/src/models/Store";
import { Category } from "@/src/models/Category";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    console.log("📦 Categories API: Connecting to MongoDB...");
    await mongooseConnect();
    console.log("✅ Categories API: Connected to MongoDB");

    const { location } = req.query;
    
    if (location) {
      // Fetch categories from specific location
      console.log(`📍 Fetching categories for location: ${location}`);
      
      try {
        const store = await Store.findOne().lean();
        
        if (!store) {
          console.warn("⚠️ No store found, returning empty categories");
          return res.status(200).json({
            success: true,
            count: 0,
            data: [],
          });
        }

        // Find the location in the store
        let storeLocation = null;
        if (store.locations && Array.isArray(store.locations)) {
          for (const loc of store.locations) {
            const locId = loc._id?.toString ? loc._id.toString() : String(loc._id);
            if (locId === location) {
              storeLocation = loc;
              break;
            }
          }
        }
        
        if (!storeLocation) {
          console.warn(`⚠️ Location not found: ${location}, returning all categories`);
          // Fallback to all categories if location not found
          const allCategories = await Category.find({})
            .select("_id name icon location isActive images properties")
            .sort({ name: 1 })
            .limit(500)
            .lean();
          return res.status(200).json({
            success: true,
            count: allCategories.length,
            data: allCategories,
          });
        }

        // Get the category IDs from this location
        const categoryIds = storeLocation.categories || [];
        console.log(`📍 Location has ${categoryIds.length} categories`);

        if (categoryIds.length === 0) {
          return res.status(200).json({
            success: true,
            count: 0,
            data: [],
          });
        }

        // Fetch the full category details
        const categories = await Category.find({ _id: { $in: categoryIds } })
          .select("_id name icon location isActive images properties")
          .sort({ name: 1 })
          .lean();

        console.log(`✅ Categories API: Found ${categories.length} categories for location`);

        return res.status(200).json({
          success: true,
          count: categories.length,
          data: categories,
        });
      } catch (locErr) {
        console.error("❌ Error in location-specific categories query:", locErr.message);
        // Fallback to all categories on error
        try {
          const allCategories = await Category.find({})
            .select("_id name icon location isActive images properties")
            .sort({ name: 1 })
            .limit(500)
            .lean();
          console.log(`✅ Fallback: Returning ${allCategories.length} all categories`);
          return res.status(200).json({
            success: true,
            count: allCategories.length,
            data: allCategories,
          });
        } catch (fallbackErr) {
          console.error("❌ Fallback query also failed:", fallbackErr.message);
          return res.status(200).json({
            success: true,
            count: 0,
            data: [],
          });
        }
      }
    } else {
      // Fetch all categories if no location specified
      console.log("📦 Fetching all categories (no location filter)");
      
      const categories = await Category.find({})
        .select("_id name icon location isActive images properties")
        .sort({ name: 1 })
        .limit(500)
        .lean();

      console.log(`✅ Categories API: Found ${categories.length} categories`);

      return res.status(200).json({
        success: true,
        count: categories.length,
        data: categories,
      });
    }
  } catch (err) {
    console.error("❌ Categories API Error:", err.message);
    console.error("❌ Stack:", err.stack);
    
    // Return empty array instead of 500 error
    return res.status(200).json({
      success: true,
      count: 0,
      data: [],
      warning: "Failed to fetch categories from database, returning empty"
    });
  }
}
