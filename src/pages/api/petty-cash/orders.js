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
        filter.status = { $in: ["Ordered", "Pending Approval", "Approved"] };
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
      const { vendorId, vendorName, purpose, items, amount, location, staffName, paymentMethod } = req.body;

      if (!vendorName || !purpose || !amount || !location) {
        return res.status(400).json({ error: "Vendor name, purpose, amount, and location are required" });
      }

      // Create a petty cash transaction marked as received and paid
      const transaction = await PettyCashTransaction.create({
        vendor: vendorId || null,
        vendorName: vendorName,
        purpose: purpose,
        description: items ? items.map(i => `${i.name} x${i.qty}`).join(", ") : "",
        quantity: 1,
        unitPrice: Number(amount),
        amount: Number(amount),
        location: location,
        requestDate: new Date(),
        status: "Paid",
        paidAt: new Date(),
        paidBy: { name: staffName || "POS Staff" },
        paymentMethod: paymentMethod || "cash",
        receivedAt: new Date(),
        receivedBy: { name: staffName || "POS Staff" },
        approvalHistory: [{
          action: "direct-entry",
          fromStatus: "",
          toStatus: "Paid",
          note: "Direct entry from POS",
          actedAt: new Date(),
          actedBy: { name: staffName || "POS Staff" },
          amount: Number(amount),
          paymentMethod: paymentMethod || "cash",
        }],
      });

      // Also create an expense entry for accounting
      try {
        await Expense.create({
          title: purpose,
          amount: Number(amount),
          categoryName: "Petty Cash",
          locationName: location,
          staffName: staffName || "POS Staff",
          description: `POS direct entry: ${purpose}`,
          sourceType: "petty-cash-transaction",
          sourceId: String(transaction._id),
          vendor: vendorId ? { _id: vendorId, companyName: vendorName } : undefined,
        });
      } catch (expErr) {
        console.error("Failed to create expense for petty cash:", expErr.message);
      }

      return res.status(201).json({ success: true, transaction: { _id: transaction._id, purpose, amount: Number(amount), status: "Paid" } });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
