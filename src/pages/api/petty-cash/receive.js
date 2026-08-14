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
    const { orderId, products: incomingProducts, staffName, paymentMethod, location } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Order ID is required" });
    }

    const transaction = await PettyCashTransaction.findById(orderId);
    if (!transaction) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (transaction.status === "Paid" || transaction.status === "Received") {
      return res.status(400).json({ error: "Order already received" });
    }

    const previousStatus = transaction.status;

    // Update product stock quantities
    const productEntries = incomingProducts && Array.isArray(incomingProducts) ? incomingProducts : (Array.isArray(transaction.products) ? transaction.products : []);
    const receivedProducts = [];

    // Batch load existing products to avoid N+1 queries
    const validEntries = productEntries.filter((e) => e.productId && e.quantity > 0);
    const existingProducts = validEntries.length > 0
      ? await Product.find({ _id: { $in: validEntries.map((e) => e.productId) } }).lean()
      : [];
    const productMap = new Map(existingProducts.map((p) => [String(p._id), p]));

    for (const entry of validEntries) {
      try {
        let product = productMap.get(String(entry.productId));

        if (!product) {
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
          entry.productId = String(product._id);
        } else {
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
      } catch (productErr) {
        console.error(`Failed to update product ${entry.productId}:`, productErr.message);
        receivedProducts.push({
          productId: entry.productId || "",
          productName: entry.productName,
          quantity: entry.quantity,
          costPrice: entry.costPrice || 0,
        });
      }
    }

    // Build the update using findByIdAndUpdate (strict:false schema doesn't track changes for save())
    const receiveUpdate = {
      status: "Received",
      receivedAt: new Date(),
      receivedBy: { name: staffName || "POS Staff" },
    };
    if (receivedProducts.length > 0) {
      receiveUpdate.products = receivedProducts;
    }

    const receiveHistoryEntry = {
      action: "received-from-pos",
      fromStatus: previousStatus,
      toStatus: "Received",
      note: `Received and paid via POS. ${receivedProducts.length} product(s) restocked.`,
      actedAt: new Date(),
      actedBy: { name: staffName || "POS Staff" },
      amount: transaction.amount,
      paymentMethod: paymentMethod || "cash",
    };

    await PettyCashTransaction.findByIdAndUpdate(orderId, {
      $set: receiveUpdate,
      $push: { approvalHistory: receiveHistoryEntry },
    });

    // Do NOT create expense here - only create when marked as Paid
    // Expense will be created when user clicks "Mark Paid"

    return res.status(200).json({
      success: true,
      transaction: { _id: transaction._id, purpose: transaction.purpose, amount: transaction.amount, status: "Received" },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
