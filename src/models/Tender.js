import mongoose from "mongoose";

const TenderSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: "" },
  buttonColor: { type: String, default: "#9dccebff" },
  tillOrder: { type: Number, default: 1 },
  classification: { 
    type: String, 
    enum: ["Cash", "Card", "Transfer", "Cheque", "Other"], 
    default: "Other" 
  },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Avoid re-registering the model in development
const Tender = mongoose.models.Tender || mongoose.model("Tender", TenderSchema);

export default Tender;
