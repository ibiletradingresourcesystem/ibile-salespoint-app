// models/Transactions.js - Merged from inventory & current app

import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: String,
    price: Number, // Price from POS (for backward compatibility)
    quantity: Number, // Quantity from POS
    salePriceIncTax: Number, // Standardized field for reports
    qty: Number, // Standardized field for reports
  },
  {
    _id: false,
    strict: false, // Allow additional fields from POS
  }
);

const TransactionSchema = new mongoose.Schema({
  // Client-generated id for de-duplication across offline/online sync
  externalId: { type: String, index: true },
  // Server-computed idempotency key for de-duplication when externalId is missing
  dedupeKey: { type: String },

  // Inventory update guard (prevents duplicate stock decrements)
  inventoryUpdated: { type: Boolean, default: false },
  // Refund restock guard (prevents duplicate stock increments on refund)
  inventoryRestockedAt: { type: Date, default: null },
  // PAYMENT HANDLING: Support both single tenderType (legacy) and split payments (new)
  // Single tender (legacy, for backwards compatibility)
  tenderType: { type: String, trim: true }, // Payment method: CASH, HYDROGEN POS, ACCESS POS, etc.
  
  // Split payments - array of tender amounts (new, takes precedence over tenderType)
  // Example: [{ tenderId: ObjectId, tenderName: "CASH", amount: 3000 }, { tenderId: ObjectId, tenderName: "TRANSFER", amount: 2000 }]
  tenderPayments: [{
    tenderId: mongoose.Schema.Types.ObjectId, // Reference to Tender
    tenderName: { type: String, trim: true },   // Tender name (CASH, HYDROGEN POS, etc.)
    amount: Number,                             // Amount paid with this tender
  }],
  
  // Transaction amounts
  amountPaid: Number, // Total amount paid (sum of all tenderPayments if split, or amount for single tender)
  subtotal: Number,
  tax: Number,
  total: Number,
  change: Number,
  discount: Number,
  discountName: String,
  discountReason: String,
  shippingCost: Number,
  deliveryFee: Number,
  deliveryFeeName: String,
  serviceCharge: Number,
  handlingFee: Number,
  additionalCharges: [{ name: String, label: String, amount: Number }],
  fees: [{ name: String, label: String, amount: Number }],
  adjustments: [{ name: String, label: String, amount: Number, type: String }],
  incrementAmount: Number, // Amount added by INCREMENT promotions (not a discount)
  incrementName: String,
  promotionValueType: String, // "DISCOUNT" or "INCREMENT" - tracks promotion type
  customerType: String, // Customer type / promotion name for display
  
  // References
  staff: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  staffName: String, // Staff name for quick lookup (denormalized)
  location: String, // Store location as string (location name or 'online')
  locationId: { type: mongoose.Schema.Types.ObjectId, default: null },
  
  // Held-by tracking (who originally held the transaction)
  heldByStaffName: String,
  heldByStaffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  
  // Device & Table info
  device: String,
  tableName: String,
  
  // Customer info
  customerName: String,
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
  creditStatus: {
    type: String,
    enum: ["none", "open", "partly_paid", "paid", "written_off"],
    default: "none",
  },
  creditCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
  creditCustomerName: { type: String, default: "" },
  creditOriginalTotal: { type: Number, default: 0 },
  creditPaidAmount: { type: Number, default: 0 },
  creditBalance: { type: Number, default: 0 },
  creditDueDate: { type: Date, default: null },
  creditPaidAt: { type: Date, default: null },
  creditNotes: { type: String, default: "" },
  creditPayments: [{
    amount: { type: Number, default: 0 },
    tenderType: { type: String, default: "CASH" },
    tenderName: { type: String, default: "CASH" },
    reference: { type: String, default: "" },
    notes: { type: String, default: "" },
    paidAt: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
    recordedByName: { type: String, default: "" },
    sequence: { type: Number, default: 1 },
  }],

  // Attribution for sales influenced by external channels such as the online store
  salesChannel: { type: String, trim: true, default: "POS" },
  sourceOrderId: { type: String, trim: true, default: "" },
  sourceOrderType: { type: String, trim: true, default: "" },
  sourceSiteKey: { type: String, trim: true, default: "" },
  
  // Transaction classification
  transactionType: { 
    type: String, 
    enum: ["pos"], 
    default: "pos" 
  }, // Only POS transactions
  
  status: { 
    type: String, 
    enum: ["held", "completed", "refunded", "credit"],
    default: "completed" 
  },
  subStatus: {
    type: String,
    enum: ["edited", "void", null],
    default: null,
  },
  
  // Items purchased
  items: {
    type: [itemSchema],
    default: [],
  },
  
  // Refund information
  refundReason: String,
  refundBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  refundedAt: Date,
  
  // Track which till this transaction belongs to
  tillId: { type: mongoose.Schema.Types.ObjectId, ref: "Till" },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes for faster lookups
// Index for single tender (legacy)
TransactionSchema.index({ tenderType: 1, status: 1 });
// Index for split payments
TransactionSchema.index({ "tenderPayments.tenderId": 1, status: 1 });
// Index for de-duplication
TransactionSchema.index({ externalId: 1 }, { unique: true, sparse: true });
TransactionSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
// Index for till reconciliation
TransactionSchema.index({ tillId: 1 });
// Index for location-based reporting
TransactionSchema.index({ location: 1, createdAt: -1 });
TransactionSchema.index({ locationId: 1, createdAt: -1 });
// Index for staff performance
TransactionSchema.index({ staff: 1, createdAt: -1 });
TransactionSchema.index({ salesChannel: 1, createdAt: -1 });
TransactionSchema.index({ sourceOrderId: 1 }, { sparse: true });
TransactionSchema.index({ status: 1, creditStatus: 1, createdAt: -1 });
TransactionSchema.index({ creditCustomerId: 1, creditStatus: 1 });

// Avoid re-registering the model in development
delete mongoose.models.Transaction;
const Transaction = mongoose.model("Transaction", TransactionSchema);

export default Transaction;
export { Transaction };
