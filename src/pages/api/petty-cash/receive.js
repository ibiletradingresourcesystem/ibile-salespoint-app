/**
 * API Endpoint: PUT /api/petty-cash/receive
 * 
 * Mark a petty cash order as received from POS
 * Updates product stock quantities (like a Restock stock movement)
 * Creates expense entry
 */
import { mongooseConnect } from "@/src/lib/mongoose";
import mongoose from "mongoose";
import Product from "@/src/models/Product";

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

    const previousStatus = transaction.status;

    // Update product stock quantities
    const productEntries = Array.isArray(transaction.products) ? transaction.products : [];
    const receivedProducts = [];

    for (const entry of productEntries) {
      if (!entry.productId || !entry.quantity || entry.quantity <= 0) continue;

      // Check if product exists
      let product = await Product.findById(entry.productId);

      if (!product) {
        // Create the product if it doesn't exist (petty-cash vendor product)
        product = await Product.create({
          name: entry.productName || "Unnamed Product",
          description: `Auto-created from petty cash vendor order`,
          costPrice: entry.costPrice || 0,
          taxRate: 0,
          salePriceIncTax: entry.costPrice || 0,
          quantity: entry.quantity,
          isStockManaged: true,
          category: "Top Level",
          locations: transaction.location ? [transaction.location] : [],
        });
        // Update entry with new product ID
        entry.productId = String(product._id);
      } else {
        // Increment existing product quantity
        await Product.updateOne(
          { _id: product._id },
          { $inc: { quantity: entry.quantity } }
        );
      }

      receivedProducts.push({
        productId: String(product._id),
        productName: product.name || entry.productName,
        quantity: entry.quantity,
        costPrice: entry.costPrice || product.costPrice || 0,
      });
    }

    // Mark as received and paid
    transaction.status = "Paid";
    transaction.paidAt = new Date();
    transaction.paidBy = { name: staffName || "POS Staff" };
    transaction.paymentMethod = paymentMethod || "cash";
    transaction.receivedAt = new Date();
    transaction.receivedBy = { name: staffName || "POS Staff" };
    if (receivedProducts.length > 0) {
      transaction.products = receivedProducts;
    }

    // Add to approval history
    const history = transaction.approvalHistory || [];
    history.push({
      action: "received-from-pos",
      fromStatus: previousStatus,
      toStatus: "Paid",
      note: `Received and paid via POS. ${receivedProducts.length} product(s) restocked.`,
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
