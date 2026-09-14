// pages/api/till/[tillId]/transactions.js
// GET: every transaction on a till (all terminals, with void/refund status) plus the till's hand-overs.
// Close Till works its figures out from this list.
import mongoose from "mongoose";
import { mongooseConnect } from "@/src/lib/mongoose";
import Till from "@/src/models/Till";
import { Transaction } from "@/src/models/Transactions";

const TRANSACTION_FIELDS = [
  "externalId", "status", "subStatus", "total", "subtotal", "discount", "tenderType", "tenderPayments",
  "items.name", "items.quantity", "items.qty", "items.price", "items.salePriceIncTax",
  "createdAt", "staffName", "customerName", "tableName", "refundedAt", "refundReason", "deviceId", "deviceName",
].join(" ");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const { tillId } = req.query;
  if (!tillId || !mongoose.Types.ObjectId.isValid(String(tillId))) {
    return res.status(400).json({ success: false, message: "A valid till ID is required" });
  }

  try {
    await mongooseConnect();

    const till = await Till.findById(tillId)
      .select("status openingBalance openedAt closedAt staffName transactions handovers closedByDeviceId closedByDeviceName closedByStaffName")
      .lean();
    if (!till) {
      return res.status(404).json({ success: false, message: "Till not found" });
    }

    const transactions = await Transaction.find({
      $or: [{ tillId: till._id }, { _id: { $in: till.transactions || [] } }],
    })
      .select(TRANSACTION_FIELDS)
      .sort({ createdAt: 1 })
      .lean();

    const { transactions: _linkedIds, ...tillInfo } = till;
    return res.status(200).json({ success: true, till: tillInfo, transactions });
  } catch (error) {
    console.error("❌ Error loading till transactions:", error);
    return res.status(500).json({ success: false, message: "Failed to load till transactions" });
  }
}
