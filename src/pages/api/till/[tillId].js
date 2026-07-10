// pages/api/till/[tillId].js
import { mongooseConnect } from "@/src/lib/mongoose";
import Till from "@/src/models/Till";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const { tillId } = req.query;

    if (!tillId) {
      return res.status(400).json({ message: "Till ID is required" });
    }

    const till = await Till.findById(tillId);

    if (!till) {
      return res.status(404).json({ message: "Till not found" });
    }

    // Convert to plain object for response
    const tillResponse = till.toObject();

    // Ensure tenderBreakdown is a plain object (Mongoose Map → Object)
    // Use multiple strategies because Mongoose Map may not always pass instanceof Map
    let tenderBreakdownObj = {};
    const rawBreakdown = till.tenderBreakdown;
    
    if (rawBreakdown) {
      // Strategy 1: Use .toJSON() if available (most reliable for Mongoose Maps)
      if (typeof rawBreakdown.toJSON === 'function') {
        try {
          const json = rawBreakdown.toJSON();
          if (json && typeof json === 'object' && !Array.isArray(json)) {
            Object.entries(json).forEach(([key, value]) => {
              if (typeof value === 'number') {
                tenderBreakdownObj[key] = value;
              }
            });
          }
        } catch (e) {
          console.warn('⚠️ toJSON() failed for tenderBreakdown:', e.message);
        }
      }
      
      // Strategy 2: If toJSON gave nothing, try forEach (native Map / Mongoose Map)
      if (Object.keys(tenderBreakdownObj).length === 0 && typeof rawBreakdown.forEach === 'function') {
        try {
          rawBreakdown.forEach((value, key) => {
            if (typeof value === 'number') {
              tenderBreakdownObj[key] = value;
            }
          });
        } catch (e) {
          console.warn('⚠️ forEach failed for tenderBreakdown:', e.message);
        }
      }
      
      // Strategy 3: If still nothing, try Object.entries on toObject result
      if (Object.keys(tenderBreakdownObj).length === 0 && tillResponse.tenderBreakdown) {
        try {
          const objVersion = tillResponse.tenderBreakdown;
          if (objVersion && typeof objVersion === 'object' && !Array.isArray(objVersion)) {
            Object.entries(objVersion).forEach(([key, value]) => {
              // Skip Mongoose internal properties
              if (key.startsWith('$') || key.startsWith('_')) return;
              if (typeof value === 'number') {
                tenderBreakdownObj[key] = value;
              }
            });
          }
        } catch (e) {
          console.warn('⚠️ Object.entries fallback failed:', e.message);
        }
      }
    }

    tillResponse.tenderBreakdown = tenderBreakdownObj;

    // Use stored values — these are maintained in real-time by /api/transactions
    tillResponse.totalSales = till.totalSales || 0;
    tillResponse.transactionCount = till.transactions?.length || till.transactionCount || 0;

    console.log(`📊 Till ${tillId}: sales=₦${tillResponse.totalSales}, txCount=${tillResponse.transactionCount}, tenders=${JSON.stringify(tenderBreakdownObj)}`);

    return res.status(200).json({
      message: "Till found",
      till: tillResponse,
    });
  } catch (error) {
    console.error("❌ Error fetching till:", error);
    return res.status(500).json({
      message: "Failed to fetch till",
      error: error.message,
    });
  }
}
