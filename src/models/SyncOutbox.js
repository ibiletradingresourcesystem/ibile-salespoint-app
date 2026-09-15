// models/SyncOutbox.js - Desktop only: local changes waiting to reach the cloud
import mongoose from "mongoose";

const SyncOutboxSchema = new mongoose.Schema(
  {
    installationId: { type: String, default: "" },
    // Entity type from src/lib/sync/entities.js PUSH_ENTITIES
    entity: { type: String, required: true },
    entityId: { type: String, required: true },
    operation: { type: String, enum: ["upsert", "payload"], default: "upsert" },

    // pending -> processing -> synced | pending (retry) | failed (rejected) | conflict
    status: {
      type: String,
      enum: ["pending", "processing", "synced", "failed", "conflict"],
      default: "pending",
    },
    priority: { type: Number, default: 100 },

    // Monotonic revision: the cloud ignores anything older than what it already holds
    rev: { type: Number, default: 0 },
    // Top-level fields changed locally ("*" = whole document, e.g. created offline)
    fields: { type: [String], default: [] },
    // For payload operations (clock records, UI settings)
    payload: { type: mongoose.Schema.Types.Mixed, default: null },

    attempts: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: () => new Date(0) },
    lastAttemptAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null },
    syncedAt: { type: Date, default: null },
    error: { type: String, default: "" },
    cloudId: { type: String, default: "" },
  },
  { timestamps: true, collection: "sync_outbox" }
);

// One open (pending) entry per record; changes made while it is being sent open a new one
SyncOutboxSchema.index(
  { entity: 1, entityId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" }, name: "one_pending_per_entity" }
);
SyncOutboxSchema.index({ status: 1, nextRetryAt: 1, priority: 1, createdAt: 1 });
SyncOutboxSchema.index({ entityId: 1 });
// Synced entries are kept 30 days for troubleshooting, then removed
SyncOutboxSchema.index({ syncedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.models.SyncOutbox || mongoose.model("SyncOutbox", SyncOutboxSchema);
