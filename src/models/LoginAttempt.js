import mongoose from "mongoose";

/** Failed PIN sign-ins, shared with the management app (src/lib/loginAttempts.js). Removed by MongoDB when they expire. */
const LoginAttemptSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

LoginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.LoginAttempt || mongoose.model("LoginAttempt", LoginAttemptSchema);
