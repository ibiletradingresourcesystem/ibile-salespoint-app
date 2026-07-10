// pages/api/till/open.js
import { mongooseConnect } from "@/src/lib/mongoose";
import Till from "@/src/models/Till";
import Store from "@/src/models/Store";
import { sanitizeBody } from '@/src/lib/apiValidation';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  req.body = sanitizeBody(req.body);

  try {
    await mongooseConnect();

    const { staffId, staffName, storeId, locationId, openingBalance } = req.body;

    // Validate required fields
    if (!staffId || !locationId || openingBalance === undefined) {
      return res.status(400).json({ 
        message: "Missing required fields: staffId, locationId, openingBalance" 
      });
    }

    // Get store - if storeId is not provided, fetch the default store
    let resolvedStoreId = storeId;
    
    if (!resolvedStoreId || resolvedStoreId === "default-store") {
      console.log("📦 Fetching default store...");
      const store = await Store.findOne().lean();
      if (store) {
        resolvedStoreId = store._id;
        console.log("✅ Found store:", store._id);
      } else {
        return res.status(400).json({ 
          message: "No store found in database" 
        });
      }
    }

    console.log("📋 Till opening - StoreID:", resolvedStoreId, "LocationID:", locationId);

    // Check if there's already an open till for this location
    const existingOpenTill = await Till.findOne({
      locationId,
      status: "OPEN",
    });

    if (existingOpenTill) {
      return res.status(400).json({
        message: "A till is already open for this location",
        existingTill: existingOpenTill,
      });
    }

    // Create new till session
    const newTill = new Till({
      storeId: resolvedStoreId,
      locationId,
      staffId,
      staffName: staffName || "Unknown",
      openingBalance: parseFloat(openingBalance),
      status: "OPEN",
      date: new Date().setHours(0, 0, 0, 0),
      transactionCount: 0, // Start at 0 - no transactions yet
    });

    await newTill.save();

    console.log(`✅ Till opened by ${staffName} - Balance: ${openingBalance}`);

    return res.status(201).json({
      message: "Till opened successfully",
      till: newTill,
    });
  } catch (error) {
    console.error("❌ Error opening till:", error);
    return res.status(500).json({
      message: "Failed to open till",
      error: error.message,
      details: error.stack,
    });
  }
}
