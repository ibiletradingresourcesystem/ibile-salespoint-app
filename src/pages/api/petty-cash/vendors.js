/**
 * API Endpoint: GET /api/petty-cash/vendors
 * 
 * Fetch petty cash vendors for the POS system
 */
import { mongooseConnect } from "@/src/lib/mongoose";
import mongoose from "mongoose";

const VendorSchema = new mongoose.Schema({}, { strict: false, collection: "vendors" });
const Vendor = mongoose.models.Vendor || mongoose.model("Vendor", VendorSchema);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const vendors = await Vendor.find({ vendorType: "petty-cash", isActive: true })
      .sort({ companyName: 1 })
      .lean();

    return res.status(200).json({ success: true, vendors });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
