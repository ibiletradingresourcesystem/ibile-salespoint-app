// models/Staff.js
import mongoose, { Schema, models } from "mongoose";
import { getDefaultPosPermissions } from "@/src/lib/posPermissions";

const StaffSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      default: "staff",
    },

    posPermissions: {
      type: Object,
      default: function defaultPosPermissions() {
        return getDefaultPosPermissions(this.role);
      },
    },

    location: {
      type: String,
      default: "",
    },

    accountName: {
      type: String,
      default: "",
    },

    accountNumber: {
      type: String,
      default: "",
    },

    bankName: {
      type: String,
      default: "",
    },

    salary: {
      type: Number,
      default: 0,
    },

    penalty: [
      {
        reason: String,
        amount: Number,
        date: { type: Date, default: Date.now },
      },
    ],

       locationId: { type: Schema.Types.ObjectId },
    locationName: String,


    isActive: {
      type: Boolean,
      default: true,
    },

    // Clock in/out records
    clockRecords: [
      {
        type: { type: String, enum: ['in', 'out'], required: true },
        timestamp: { type: Date, default: Date.now },
        locationId: { type: Schema.Types.ObjectId },
        locationName: String,
        notes: String,
      },
    ],
  },
  { timestamps: true }
);

const StaffModel = models.Staff || mongoose.model("Staff", StaffSchema);

export default StaffModel;
export const Staff = StaffModel;
