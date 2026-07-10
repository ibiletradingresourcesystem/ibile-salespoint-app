import mongooseConnect from "@/src/lib/mongoose";
import EndOfDayReport from "@/src/models/EndOfDayReport";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();
    const { reportId } = req.query;

    if (!reportId) {
      return res.status(400).json({ message: "Report ID is required" });
    }

    console.log("📊 Fetching EndOfDay report:", reportId);

    const report = await EndOfDayReport.findById(reportId)
      .populate({
        path: "storeId",
        select: "storeName"
      })
      .populate({
        path: "locationId",
        select: "name"
      })
      .populate({
        path: "staffId",
        select: "name email"
      })
      .populate({
        path: "tillId",
        select: "openedAt openingBalance closedAt totalSales transactionCount tenderBreakdown tenderVariances"
      })
      .populate({
        path: "closedBy",
        select: "name email"
      });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    console.log("✅ Report fetched successfully");

    return res.status(200).json({
      success: true,
      report,
    });
  } catch (error) {
    console.error("❌ Error fetching EndOfDay report:", error.message);
    return res.status(500).json({
      message: "Failed to fetch EndOfDay report",
      error: error.message,
    });
  }
}
