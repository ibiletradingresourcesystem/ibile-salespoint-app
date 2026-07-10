import mongoose, { Schema, models } from "mongoose";

const SystemThemeSchema = new Schema(
  {
    key: { type: String, default: "system-theme", unique: true },
    primaryColor: { type: String, default: "#0ea5e9" },
    secondaryColor: { type: String, default: "#06b6d4" },
    sidebarBg: { type: String, default: "#f9fafb" },
    sidebarActiveGradientFrom: { type: String, default: "#2563eb" },
    sidebarActiveGradientTo: { type: String, default: "#1d4ed8" },
    tableHeaderGradientFrom: { type: String, default: "#0284c7" },
    tableHeaderGradientTo: { type: String, default: "#0369a1" },
    buttonPrimaryBg: { type: String, default: "#0284c7" },
    buttonPrimaryHover: { type: String, default: "#0369a1" },
    pageBg: { type: String, default: "#f9fafb" },
    successColor: { type: String, default: "#10b981" },
    warningColor: { type: String, default: "#f59e0b" },
    errorColor: { type: String, default: "#ef4444" },
    infoColor: { type: String, default: "#3b82f6" },
    presetName: { type: String, default: "Default Blue" },
  },
  { timestamps: true }
);

export default models.SystemTheme || mongoose.model("SystemTheme", SystemThemeSchema);