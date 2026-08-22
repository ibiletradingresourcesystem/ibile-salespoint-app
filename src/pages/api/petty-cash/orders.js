/**
 * API Endpoint: GET/POST/PUT /api/petty-cash/orders
 * 
 * GET: Fetch active petty cash orders for the current location
 * POST: Create a petty cash vendor order with product entries
 * PUT: Update an existing order's product entries
 */
import { mongooseConnect } from "@/src/lib/mongoose";
import mongoose from "mongoose";

const PettyCashTransactionSchema = new mongoose.Schema({}, { strict: false, collection: "pettycashtransactions" });
const PettyCashTransaction = mongoose.models.PettyCashTransaction || mongoose.model("PettyCashTransaction", PettyCashTransactionSchema);

const VendorSchema = new mongoose.Schema({}, { strict: false, collection: "vendors" });
const Vendor = mongoose.models.Vendor || mongoose.model("Vendor", VendorSchema);

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
        // Include Received status so users can mark payment after items are received
        filter.status = { $in: ["Ordered", "Pending Approval", "Approved", "Received"] };
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
      const { vendorId, vendorName, purpose, description, products, amount, location, staffName } = req.body;

      if (!vendorId || !location) {
        return res.status(400).json({ error: "Vendor and location are required" });
      }

      // Calculate total from product entries if provided
      const productEntries = Array.isArray(products) ? products.filter((p) => (p.productId || p.productName) && p.quantity > 0).map(p => ({
        productId: (p.productId && p.productId !== "undefined" && p.productId !== "null") ? p.productId : "",
        productName: p.productName || "",
        costPrice: Number(p.costPrice) || 0,
        quantity: Number(p.quantity) || 0,
      })) : [];
      const totalAmount = productEntries.length > 0
        ? productEntries.reduce((sum, p) => sum + (p.costPrice || 0) * p.quantity, 0)
        : Number(amount) || 0;

      if (totalAmount <= 0 && productEntries.length === 0) {
        return res.status(400).json({ error: "At least one product entry or amount is required" });
      }

      const transaction = await PettyCashTransaction.create({
        vendor: vendorId,
        vendorName: vendorName || "",
        purpose: purpose || vendorName || "Petty Cash Order",
        description: description || "",
        products: productEntries,
        quantity: productEntries.length || 1,
        unitPrice: totalAmount,
        amount: totalAmount,
        location,
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
          amount: totalAmount,
        }],
      });

      return res.status(201).json({ success: true, transaction: { _id: transaction._id, vendorName, amount: totalAmount, status: "Ordered" } });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PUT") {
    try {
      const { orderId, products, description, action, staffName } = req.body;

      if (!orderId) {
        return res.status(400).json({ error: "Order ID is required" });
      }

      const transaction = await PettyCashTransaction.findById(orderId);
      if (!transaction) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Handle mark-paid action
      if (action === "mark-paid") {
        if (transaction.status !== "Received") {
          return res.status(400).json({ error: "Only received orders can be marked as paid" });
        }

        const paidHistoryEntry = {
          action: "marked-paid",
          fromStatus: "Received",
          toStatus: "Paid",
          note: "Payment completed for received items",
          actedAt: new Date(),
          actedBy: { name: staffName || "POS Staff" },
          amount: transaction.amount,
        };

        await PettyCashTransaction.findByIdAndUpdate(orderId, {
          $set: {
            status: "Paid",
            paidAt: new Date(),
            paidBy: { name: staffName || "POS Staff" },
          },
          $push: { approvalHistory: paidHistoryEntry },
        });

        return res.status(200).json({
          success: true,
          transaction: { _id: transaction._id, status: "Paid" },
        });
      }

      // Handle update-details (edit order)
      if (transaction.status !== "Ordered" && transaction.status !== "Approved") {
        return res.status(400).json({ error: "Only active orders can be edited" });
      }

      const productEntries = Array.isArray(products) ? products.filter((p) => p.productId && p.quantity > 0) : [];
      const totalAmount = productEntries.length > 0
        ? productEntries.reduce((sum, p) => sum + (p.costPrice || 0) * p.quantity, 0)
        : transaction.amount;

      const editHistoryEntry = {
        action: "edited",
        fromStatus: transaction.status,
        toStatus: transaction.status,
        note: "Order products updated from POS",
        actedAt: new Date(),
        actedBy: { name: staffName || "POS Staff" },
        amount: totalAmount,
      };

      const updateFields = {
        products: productEntries,
        amount: totalAmount,
        unitPrice: totalAmount,
        quantity: productEntries.length || 1,
      };
      if (description !== undefined) updateFields.description = description;

      await PettyCashTransaction.findByIdAndUpdate(orderId, {
        $set: updateFields,
        $push: { approvalHistory: editHistoryEntry },
      });

      return res.status(200).json({ success: true, transaction: { _id: transaction._id, amount: totalAmount, products: productEntries, status: transaction.status } });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
