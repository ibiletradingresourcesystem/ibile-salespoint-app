// pages/api/till/diagnose.js
// Diagnostic endpoint to check till database state
import { mongooseConnect } from "@/src/lib/mongoose";
import Till from "@/src/models/Till";

export default async function handler(req, res) {
  try {
    await mongooseConnect();

    console.log("🔍 DIAGNOSTIC: Checking tills in database...");

    // Get all tills
    const allTills = await Till.find()
      .select("_id status staffName locationId storeId openedAt closedAt transactionCount totalSales")
      .sort({ openedAt: -1 })
      .limit(200)
      .lean();
    
    console.log(`📊 Total tills fetched: ${allTills.length}`);
    
    const tillSummary = allTills.map(t => ({
      _id: String(t._id),
      status: t.status,
      staffName: t.staffName,
      locationId: t.locationId ? String(t.locationId) : undefined,
      storeId: t.storeId ? String(t.storeId) : undefined,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      transactionCount: t.transactionCount,
      totalSales: t.totalSales,
    }));

    // Get open tills only
    const openTills = allTills.filter(t => t.status === "OPEN");
    console.log(`✅ Open tills: ${openTills.length}`);
    openTills.forEach(t => {
      console.log(`   - ${t.staffName} (${t._id}): $${t.totalSales}`);
    });

    return res.status(200).json({
      message: "Diagnostic complete",
      totalTills: allTills.length,
      openTills: openTills.length,
      tills: tillSummary,
    });
  } catch (error) {
    console.error("❌ Diagnostic error:", error);
    return res.status(500).json({
      message: "Diagnostic failed",
      error: error.message,
    });
  }
}
