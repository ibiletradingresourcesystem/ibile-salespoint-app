// pages/api/till/debug.js
// Debug endpoint to inspect till and transaction state
import { mongooseConnect } from "@/src/lib/mongoose";
import Till from "@/src/models/Till";
import { Transaction } from "@/src/models/Transactions";

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

    console.log(`🔍 DEBUG: Inspecting till ${tillId}`);

    // Get till
    const till = await Till.findById(tillId).exec();

    if (!till) {
      console.error(`❌ Till ${tillId} not found`);
      return res.status(404).json({
        message: "Till not found",
        tillId: tillId
      });
    }

    console.log(`✅ Till found: ${till._id}`);

    // Get till's transactions
    const transactions = await Transaction.find({
      _id: { $in: till.transactions }
    }).select('_id total tenderType createdAt').exec();

    console.log(`   Transactions: ${transactions.length}`);
    console.log(`   Total sales: ${till.totalSales}`);
    console.log(`   Tender breakdown:`, till.tenderBreakdown);

    // Calculate totals by tender
    const tenderTotals = {};
    transactions.forEach(tx => {
      const tender = tx.tenderType || 'CASH';
      tenderTotals[tender] = (tenderTotals[tender] || 0) + tx.total;
    });

    return res.status(200).json({
      message: "Till debug info",
      till: {
        _id: till._id.toString(),
        status: till.status,
        staffName: till.staffName,
        locationId: till.locationId.toString(),
        openingBalance: till.openingBalance,
        totalSales: till.totalSales,
        transactionCount: till.transactionCount,
        tenderBreakdown: Object.fromEntries(till.tenderBreakdown || new Map()),
        openedAt: till.openedAt,
        linkedTransactionCount: till.transactions.length
      },
      transactions: {
        count: transactions.length,
        total: transactions.reduce((sum, tx) => sum + tx.total, 0),
        byTender: tenderTotals,
        list: transactions.map(tx => ({
          _id: tx._id.toString(),
          amount: tx.total,
          tender: tx.tenderType,
          date: tx.createdAt
        }))
      }
    });
  } catch (error) {
    console.error("❌ Debug error:", error.message);
    return res.status(500).json({
      message: "Debug failed",
      error: error.message
    });
  }
}
