import { model, Schema, models } from "mongoose";

const ProductSchema = new Schema(
  {
    /* =====================
       BASIC INFO
    ===================== */
    name: { type: String, required: true },
    description: { type: String, required: true },

    costPrice: { type: Number, required: true },
    taxRate: { type: Number, default: 0 },
    salePriceIncTax: { type: Number, required: true },
    margin: { type: Number, default: 0 },

    barcode: { type: String },
    category: { type: String, default: "Top Level" },
      productType: {
         type: String,
         enum: ["standard", "room"],
         default: "standard",
         index: true,
      },
      roomStatus: {
         type: String,
         enum: ["available", "reserved", "occupied"],
         default: "available",
         index: true,
      },
      currentBooking: {
         guestName: { type: String, default: "" },
         guestPhone: { type: String, default: "" },
         checkInAt: { type: Date, default: null },
         checkOutAt: { type: Date, default: null },
         notes: { type: String, default: "" },
         sourceTransactionId: { type: String, default: "" },
         sourceTransactionStatus: { type: String, default: "" },
         updatedAt: { type: Date, default: null },
      },

    images: [
      {
        full: { type: String, required: true },
        thumb: { type: String, required: true },
      },
    ],

    properties: [{ type: Object }],

    /* =====================
       STOCK CONTROL
    ===================== */
    quantity: { type: Number, default: 0 },
    minStock: { type: Number, default: 0 },
    maxStock: { type: Number, default: 0 },

    /* =====================
       EXPIRY MANAGEMENT
    ===================== */
    expiryDate: { type: Date }, // optional
    isExpired: { type: Boolean, default: false },

    /* =====================
       PROMOTIONS
    ===================== */
    isPromotion: { type: Boolean, default: false },
    promoPrice: { type: Number },
    promoStart: { type: Date },
    promoEnd: { type: Date },

    /* =====================
       PROMOTION PERFORMANCE
    ===================== */
    promoStats: {
      views: { type: Number, default: 0 },
      salesQty: { type: Number, default: 0 },
      salesValue: { type: Number, default: 0 },
    },

    /* =====================
       SALES METRICS
    ===================== */
    totalUnitsSold: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    lastSoldAt: { type: Date },

    salesHistory: [
      {
        orderId: { type: Schema.Types.ObjectId, ref: "Order" },
        quantity: { type: Number, required: true },
        salePrice: { type: Number, required: true },
        soldAt: { type: Date, default: Date.now },
      },
    ],

    /* =====================
       LOCATION ASSIGNMENT
    ===================== */
    locations: [{ type: String }],

    /* =====================
       PACK / CHILD PRODUCT
    ===================== */
    isChildProduct: { type: Boolean, default: false },
    parentProduct: { type: Schema.Types.ObjectId, ref: "Product" },
    childSalePrice: { type: Number },
    packType: { type: String, enum: ["unit", "pack"], default: "unit" },
    qtyPerPack: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default models.Product || model("Product", ProductSchema);
