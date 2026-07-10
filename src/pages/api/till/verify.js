// pages/api/till/verify.js
// Verify a till exists before attempting to close it
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

    console.log(`🔍 Verifying till: ${tillId}`);

    // Try to find the till
    const till = await Till.findById(tillId).exec();

    if (!till) {
      console.error(`❌ Till not found: ${tillId}`);
      
      // Debug: Check what tills exist
      const allTills = await Till.find().select('_id status staffName').exec();
      console.error(`   Total tills in DB: ${allTills.length}`);
      
      return res.status(404).json({
        message: "Till not found",
        searched: tillId,
        totalTillsInDb: allTills.length,
        tills: allTills.map(t => ({
          id: t._id.toString(),
          status: t.status,
          staff: t.staffName
        }))
      });
    }

    console.log(`✅ Till verified: ${till._id} (Status: ${till.status})`);

    return res.status(200).json({
      message: "Till exists",
      till: {
        _id: till._id.toString(),
        status: till.status,
        staffName: till.staffName,
        totalSales: till.totalSales,
        transactionCount: till.transactionCount,
        transactions: till.transactions?.length || 0
      }
    });
  } catch (error) {
    console.error("❌ Error verifying till:", error.message);
    return res.status(500).json({
      message: "Verification failed",
      error: error.message
    });
  }
}
