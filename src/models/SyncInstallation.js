// models/SyncInstallation.js - Cloud record of each enrolled desktop POS installation
import mongoose from "mongoose";

const SyncInstallationSchema = new mongoose.Schema(
  {
    installationId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, default: "" },
    // sha256 of the installation's secret token; the token itself is only shown to the installation
    tokenHash: { type: String, required: true },

    locationId: { type: mongoose.Schema.Types.ObjectId, default: null },
    locationName: { type: String, default: "" },

    enrolledByStaffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
    enrolledByStaffName: { type: String, default: "" },
    enrolledAt: { type: Date, default: Date.now },

    appVersion: { type: String, default: "" },
    platform: { type: String, default: "" },

    lastSeenAt: { type: Date, default: null },
    lastPushAt: { type: Date, default: null },
    lastPullAt: { type: Date, default: null },

    revokedAt: { type: Date, default: null },
    revokedByStaffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
  },
  { timestamps: true }
);

export default mongoose.models.SyncInstallation ||
  mongoose.model("SyncInstallation", SyncInstallationSchema);
