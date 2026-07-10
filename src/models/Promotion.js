import mongoose from "mongoose";

const PromotionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: String,
  
  // Target customer types
  targetCustomerTypes: [{
    type: String,
    enum: ["REGULAR", "VIP", "NEW", "INACTIVE", "BULK_BUYER", "ONLINE"],
  }],
  
  // Value details (can be discount or INCREMENT)
  valueType: {
    type: String,
    enum: ["DISCOUNT", "INCREMENT"],
    default: "DISCOUNT", // DISCOUNT = reduce price, INCREMENT = increase price
  },
  discountType: {
    type: String,
    enum: ["PERCENTAGE", "FIXED"],
    default: "PERCENTAGE",
  },
  discountValue: {
    type: Number,
    required: true,
  },
  // For FIXED discount: apply to each product or to the cart total
  fixedAmountApplyMode: {
    type: String,
    enum: ["PER_ITEM", "TOTAL"],
    default: "PER_ITEM",
  },
  
  // Application scope
  applicationType: {
    type: String,
    enum: ["ONE_PRODUCT", "ALL_PRODUCTS", "CATEGORY"],
    required: true,
  },
  
  // Applied to which products/categories
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], // For ONE_PRODUCT
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }], // For CATEGORY type
  
  // Date range
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  indefinite: {
    type: Boolean,
    default: false, // If true, promotion never expires (endDate is ignored)
  },
  
  // Status
  active: {
    type: Boolean,
    default: true,
  },
  
  // Display settings
  displayAbovePrice: {
    type: Boolean,
    default: true, // Show promotion above product price
  },
  priority: {
    type: Number,
    default: 0, // Higher priority promotions show first
  },
  
  // Usage tracking
  timesUsed: {
    type: Number,
    default: 0,
  },
  maxUses: Number, // Optional limit on number of uses
  
  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Pre-save middleware: auto-fill dates if indefinite is checked
PromotionSchema.pre("save", function(next) {
  if (this.indefinite) {
    // Set start date to today if not already set
    if (!this.startDate) {
      this.startDate = new Date();
    }
    // Set end date to 1 year from start date
    const oneYearLater = new Date(this.startDate);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    this.endDate = oneYearLater;
  }
  next();
});

// Index for quick lookups
PromotionSchema.index({ active: 1, startDate: 1, endDate: 1 });
PromotionSchema.index({ "targetCustomerTypes": 1 });
PromotionSchema.index({ products: 1 });
PromotionSchema.index({ categories: 1 });

const Promotion = mongoose.models.Promotion || mongoose.model("Promotion", PromotionSchema);

export default Promotion;
