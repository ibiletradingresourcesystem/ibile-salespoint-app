// models/Store.js
import mongoose from "mongoose";

const LocationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },        
    address: { type: String },                    
    phone: { type: String },                       
    email: { type: String },                       
    code: { type: String },                        
    isActive: { type: Boolean, default: true },
    // Tenders and Categories specific to this location
    tenders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tender" }],
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
  },
  { _id: true } 
);

const StoreSchema = new mongoose.Schema(
  {
    companyName: String,
    email: String,
    logo: String,
    currency: String,
    timezone: String,

    devices: [String],
    orderFooter: String,

    openingHours: [{ day: String, open: String, close: String }],
    tenderTypes: [String],
    taxRates: [{ name: String, percentage: Number }],
    pettyCashReasons: [String],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    storeName: { type: String, required: true },
    storePhone: { type: String, required: true },
    country: { type: String, required: true },

    // 🔥 UPGRADED LOCATIONS
    locations: [LocationSchema],

    // 📋 Receipt Settings
    companyDisplayName: { type: String, default: "" },
    taxNumber: { type: String, default: "" },
    website: { type: String, default: "" },
    refundDays: { type: Number, default: 0 },
    receiptMessage: { type: String, default: "" },
    fontSize: { type: String, default: "8.0" },
    barcodeType: { type: String, default: "Default - Code 39" },
    qrUrl: { type: String, default: "" },
    qrDescription: { type: String, default: "" },
    qrDataUrl: { type: String, default: "" },
    paymentStatus: { type: String, default: "paid" },

    // UI Settings (per store)
    uiSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.models.Store ||
  mongoose.model("Store", StoreSchema);
