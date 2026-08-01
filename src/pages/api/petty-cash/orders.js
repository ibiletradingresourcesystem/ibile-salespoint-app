/**
 * API Endpoint: GET/POST /api/petty-cash/orders
 * 
 * GET: Fetch active petty cash orders for the current location
 * POST: Create a direct petty cash entry (no prior order) and mark as received+paid
 */
import { mongooseConnect } from "@/src/lib/mongoose";
import mongoose from "mongoose";

// Use the shared PettyCashTransaction model from the inventory app's DB
const PettyCashTransactionSchema = new mongoose.Schema({}, { strict: false, collection: "pettycashtransactions" });
const PettyCashTransaction = mongoose.models.PettyCashTransaction || mongoose.model("PettyCashTransaction", PettyCashTransactionSchema);

const VendorSchema = new mongoose.Schema({}, { strict: false, collection: "vendors" });
const Vendor = mongoose.models.Vendor || mongoose.model("Vendor", VendorSchema);

const ExpenseSchema = new mongoose.Schema({}, { strict: false, collection: "expenses" });
const Expense = mongoose.models.Expense || mongoose.model("Expense", ExpenseSchema);

export default async function handler(req, res) {
  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { location, status } = req.query;
      const filter = {};
      if (location) filter.location = location;
      if (status) {
        filter.status = status;
      } else {
        filter.status = { $in: ["Ordered", "Approved"] };
      }

      const orders = await PettyCashTransaction.find(filter)
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      return res.status(200).json({ success: true, orders });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { vendorId, vendorName, purpose, description, amount, location, staffName } = req.body;

      if (!vendorId || !amount || !location) {
        return res.status(400).json({ error: "Vendor, amount, and location are required" });
      }

      // Create a petty cash vendor order (status: Ordered) — same as inventory
      const transaction = await PettyCashTransaction.create({
        vendor: vendorId,
        vendorName: vendorName || "",
        purpose: purpose || vendorName || "Petty Cash Order",
        description: description || "",
        quantity: 1,
        unitPrice: Number(amount),
        amount: Number(amount),
        location: location,
        requestDate: new Date(),
        status: "Ordered",
        requestedBy: { name: staffName || "POS Staff" },
        approvalHistory: [{
          action: "ordered",
          fromStatus: "",
          toStatus: "Ordered",
          note: "Vendor order created from POS",
          actedAt: new Date(),
          actedBy: { name: staffName || "POS Staff" },
          amount: Number(amount),
        }],
      });

      return res.status(201).json({ success: true, transaction: { _id: transaction._id, vendorName, amount: Number(amount), status: "Ordered" } });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
