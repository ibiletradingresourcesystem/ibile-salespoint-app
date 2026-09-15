import mongoose from "mongoose";
import { syncTracking } from "@/src/lib/desktop/syncTracking";

const EndOfDayReportSchema = new mongoose.Schema({
  // References
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  locationName: { type: String, default: "Unknown" },
  tillId: { type: mongoose.Schema.Types.ObjectId, ref: "Till", required: true },

  // Staff Info
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  staffName: String,

  // Till Opening Info
  openedAt: Date,
  openingBalance: Number,

  // Till Closing Info
  closedAt: { type: Date, default: Date.now },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" }, // Manager who closed

  // Cash Reconciliation
  physicalCount: Number,
  expectedClosingBalance: Number,
  variance: Number,
  variancePercentage: Number,

  // Sales Summary
  totalSales: Number,
  transactionCount: Number,

  // Tender Breakdown (expected/processed amounts per tender)
  tenderBreakdown: {
    type: Map,
    of: Number,
    default: {},
  },

  // Tender Actual (physical counted amounts per tender)
  tenderActual: {
    type: Map,
    of: Number,
    default: {},
  },

  // Tender Variances (per-tender reconciliation: processed vs counted)
  tenderVariances: {
    type: Map,
    of: {
      processed: Number,
      counted: Number,
      variance: Number,
    },
    default: {},
  },

  // Additional Info
  closingNotes: String,
  status: {
    type: String,
    enum: ["RECONCILED", "VARIANCE_NOTED"],
    default: "RECONCILED"
  },

  // Desktop sync
  installationId: { type: String, default: null },
  syncRev: { type: Number },
  syncedFrom: { type: String },
  syncedAt: { type: Date },

  // Metadata
  date: {
    type: Date,
    default: () => new Date().setHours(0, 0, 0, 0) // Start of day
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Prevent duplicate reports per till
EndOfDayReportSchema.index({ tillId: 1 }, { unique: true });

// Desktop runtime: queue reports for cloud sync (no-op on the cloud deployment)
EndOfDayReportSchema.plugin(syncTracking, { entity: "endofdayreports" });

// Avoid re-registering the model in development
const EndOfDayReport = mongoose.models.EndOfDayReport ||
  mongoose.model("EndOfDayReport", EndOfDayReportSchema);

export default EndOfDayReport;
