/**
 * API Endpoint: GET /api/store/locations
 * 
 * Fetches all store locations from database
 * Used for staff login screen
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import Store from "@/src/models/Store";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const store = await Store.findOne().lean();

    if (!store || !store.locations || store.locations.length === 0) {
      // Return default location if none found
      return res.status(200).json({
        success: true,
        data: [
          {
            _id: "default",
            name: "Lagos Store",
            address: "Lagos, Nigeria",
            phone: "",
            isActive: true,
          },
        ],
      });
    }

    return res.status(200).json({
      success: true,
      data: store.locations,
    });
  } catch (err) {
    console.error("Error fetching locations:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch locations",
      error: err.message,
    });
  }
}
