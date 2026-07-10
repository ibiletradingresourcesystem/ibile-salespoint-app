import mongoose from "mongoose";

const CustomerSnapshotSchema = new mongoose.Schema(
  {
    name: String,
    email: String,
    phone: String,
    address: String,
    city: String,
    type: String,
  },
  { _id: false }
);

const ShippingDetailsSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
  },
  { _id: false }
);

const OrderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: false },
    name: { type: String, default: "" },
    price: { type: Number, default: 0 },
    quantity: { type: Number, default: 0 },
    category: String,
    description: String,
    images: [String],
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    siteKey: {
      type: String,
      enum: ["store", "hotel"],
      default: "store",
    },
    customerSnapshot: CustomerSnapshotSchema,
    shippingDetails: ShippingDetailsSchema,
    items: [OrderItemSchema],
    cartProducts: [OrderItemSchema],
    subtotal: { type: Number, default: 0 },
    shippingCost: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
      default: null,
    },
    locationName: {
      type: String,
      default: "",
      index: true,
    },
    paymentReference: { type: String, default: "" },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
      default: "Pending",
    },
    paymentChannel: {
      type: String,
      default: "manual-entry",
    },
    status: {
      type: String,
      enum: [
        "Pending",
        "Processing",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Pending Payment",
        "Inventory Reserved",
        "Reservation Expired",
      ],
      default: "Pending",
    },
    deliveryPerson: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
    },
    completedByStaffId: {
      type: String,
      default: "",
    },
    completedByStaffName: {
      type: String,
      default: "",
    },
    paid: { type: Boolean, default: false },
    reservationStatus: {
      type: String,
      enum: ["active", "releasing", "released", "finalizing", "finalized", null],
      default: "active",
    },
    reservationExpiresAt: Date,
    reservationReleasedAt: Date,
    finalizedAt: Date,
    cancellationReason: String,
    inventoryFinalizedBy: {
      type: String,
      enum: ["paystack", "admin", "pos", null],
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.models.Order || mongoose.model("Order", OrderSchema);
