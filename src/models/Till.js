// models/Till.js - Merged from inventory & current app
import mongoose from "mongoose";
import { syncTracking } from "@/src/lib/desktop/syncTracking";

// A terminal that sent its sales to the cloud so another terminal at the location can close the till
const HandoverSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    deviceName: { type: String, default: "" },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
    staffName: { type: String, default: "" },
    transactionCount: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    tenderBreakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
    sentAt: { type: Date, default: Date.now },
    // pending: waiting for the till to close · merged: included when the till closed · resumed: the terminal went back to selling
    status: { type: String, enum: ["pending", "merged", "resumed"], default: "pending" },
    mergedAt: { type: Date, default: null },
    mergedByDeviceName: { type: String, default: "" },
    mergedByStaffName: { type: String, default: "" },
  },
  { _id: true }
);

const TillSchema = new mongoose.Schema(
  {
    // Reference to store location
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    
    // Staff who opened the till
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },
    staffName: {
      type: String,
      required: true,
    },
    
    // Till session dates
    openedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    
    // Till balances - MERGED VERSION
    openingBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    expectedClosingBalance: {
      type: Number,
    },
    physicalCount: {
      type: Number,
    },
    variance: {
      type: Number,
    },
    closingBalance: {
      type: Number,
      default: null,
    },
    
    // Sales totals for the till session
    totalSales: {
      type: Number,
      default: 0,
    },
    transactionCount: {
      type: Number,
      default: 0,
    },
    transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Transaction" }],
    
    // Breakdown by tender type (Map to support dynamic tender names)
    tenderBreakdown: {
      type: Map,
      of: Number,
      default: {},
    },

    // Tender reconciliation data (processed vs physical count per tender)
    tenderVariances: {
      type: Map,
      of: {
        processed: Number,
        counted: Number,
        variance: Number,
      },
      default: {},
    },
    
    // Till status - Support SUSPENDED for system downtime
    status: {
      type: String,
      enum: ["OPEN", "CLOSED", "SUSPENDED"],
      default: "OPEN",
    },
    
    // Device info & notes
    device: {
      type: String,
      default: "POS Terminal",
    },
    closingNotes: {
      type: String,
      default: "",
    },

    // Terminals sharing this till
    handovers: { type: [HandoverSchema], default: [] },
    closedByDeviceId: { type: String, default: "" },
    closedByDeviceName: { type: String, default: "" },
    closedByStaffName: { type: String, default: "" },
    notes: {
      type: String,
      default: "",
    },

    // Desktop sync: tills opened on a desktop installation are owned by it (see webTillScope)
    installationId: { type: String, default: null },
    syncRev: { type: Number },
    syncedFrom: { type: String },
    syncedAt: { type: Date },

    // Daily summary
    date: {
      type: Date,
      default: () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
      },
    },
  },
  { timestamps: true }
);

// Index for efficient querying
TillSchema.index({ storeId: 1, locationId: 1, status: 1, openedAt: -1 });
TillSchema.index({ staffId: 1, status: 1 });
TillSchema.index({ openedAt: -1 });
TillSchema.index({ date: 1, locationId: 1 });
TillSchema.index({ installationId: 1, status: 1 });

// Desktop runtime: queue till changes for cloud sync (no-op on the cloud deployment)
TillSchema.plugin(syncTracking, { entity: "tills" });

export default mongoose.models.Till || mongoose.model("Till", TillSchema);
