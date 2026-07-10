// pages/api/till/current.js
import { mongooseConnect } from "@/src/lib/mongoose";
import Till from "@/src/models/Till";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const { locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({ message: "Location ID is required" });
    }

    // Find the current open till for this location
    const currentTill = await Till.findOne({
      locationId,
      status: "OPEN",
    })
      .sort({ openedAt: -1 })
      .populate({
        path: "transactions",
        select: "tenderType total amountPaid createdAt items transactionType"
      });

    if (!currentTill) {
      return res.status(404).json({ message: "No open till found for this location" });
    }

    console.log(`📊 Current till for location ${locationId}:`);
    console.log(`   Till ID: ${currentTill._id}`);
    console.log(`   Status: ${currentTill.status}`);
    console.log(`   Opening Balance: ${currentTill.openingBalance}`);
    console.log(`   Total Sales: ${currentTill.totalSales}`);
    console.log(`   Transaction Count: ${currentTill.transactionCount}`);
    console.log(`   Linked transactions: ${currentTill.transactions.length}`);

    return res.status(200).json({
      message: "Current till found",
      till: currentTill,
    });
  } catch (error) {
    console.error("❌ Error fetching current till:", error);
    return res.status(500).json({
      message: "Failed to fetch current till",
      error: error.message,
    });
  }
}
