/**
 * API Endpoint: PUT /api/petty-cash/receive
 * 
 * Mark a petty cash order as received from POS
 * Updates the transaction status and creates expense entry
 */
import { mongooseConnect } from "@/src/lib/mongoose";
import mongoose from "mongoose";

const PettyCashTransactionSchema = new mongoose.Schema({}, { strict: false, collection: "pettycashtransactions" });
const PettyCashTransaction = mongoose.models.PettyCashTransaction || mongoose.model("PettyCashTransaction", PettyCashTransactionSchema);

const ExpenseSchema = new mongoose.Schema({}, { strict: false, collection: "expenses" });
const Expense = mongoose.models.Expense || mongoose.model("Expense", ExpenseSchema);

export default async function handler(req, res) {
  if (req.method !== "PUT") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const { orderId, staffName, paymentMethod, location } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Order ID is required" });
    }

    const transaction = await PettyCashTransaction.findById(orderId);
    if (!transaction) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (transaction.status === "Paid") {
      return res.status(400).json({ error: "Order already marked as paid" });
    }

    // Mark as received and paid
    transaction.status = "Paid";
    transaction.paidAt = new Date();
    transaction.paidBy = { name: staffName || "POS Staff" };
    transaction.paymentMethod = paymentMethod || "cash";
    transaction.receivedAt = new Date();
    transaction.receivedBy = { name: staffName || "POS Staff" };

    // Add to approval history
    const history = transaction.approvalHistory || [];
    history.push({
      action: "received-from-pos",
      fromStatus: transaction.status,
      toStatus: "Paid",
      note: "Received and paid via POS",
      actedAt: new Date(),
      actedBy: { name: staffName || "POS Staff" },
      amount: transaction.amount,
      paymentMethod: paymentMethod || "cash",
    });
    transaction.approvalHistory = history;

    await transaction.save();

    // Create expense entry for accounting
    try {
      const existingExpense = await Expense.findOne({ sourceType: "petty-cash-transaction", sourceId: String(transaction._id) });
      if (!existingExpense) {
        await Expense.create({
          title: transaction.purpose || "Petty Cash",
          amount: transaction.amount,
          categoryName: "Petty Cash",
          locationName: location || transaction.location,
          staffName: staffName || "POS Staff",
          description: `Received via POS: ${transaction.purpose}`,
          sourceType: "petty-cash-transaction",
          sourceId: String(transaction._id),
          vendor: transaction.vendor ? { _id: transaction.vendor, companyName: transaction.vendorName } : undefined,
        });
      }
    } catch (expErr) {
      console.error("Failed to create expense:", expErr.message);
    }

    return res.status(200).json({
      success: true,
      transaction: { _id: transaction._id, purpose: transaction.purpose, amount: transaction.amount, status: "Paid" },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
