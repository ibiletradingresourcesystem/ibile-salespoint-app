/**
 * API Endpoint: GET /api/receipt-settings?locationId=
 *
 * Receipt content and styling saved in the management app's Receipt Settings page.
 * With a locationId, that location's address and QR code are used when it has them.
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import Store from "@/src/models/Store";

const DEFAULT_SETTINGS = {
  companyDisplayName: "Store",
  companyLogo: "",
  storePhone: "",
  email: "",
  website: "",
  businessAddress: "",
  taxNumber: "",
  refundDays: 0,
  receiptMessage: "",
  qrUrl: "",
  qrDataUrl: "",
  qrDescription: "",
  paymentStatus: "paid",
  fontSize: "8.0",
  fontFamily: "Arial",
  fontWeight: "normal",
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    // lean(): read exactly what the management app saved, including fields this app's model doesn't list
    const store = await Store.findOne({}).lean();
    if (!store) {
      return res.status(200).json({ success: true, settings: DEFAULT_SETTINGS });
    }

    const locations = Array.isArray(store.locations) ? store.locations : [];
    const { locationId } = req.query;
    const location = locationId ? locations.find((loc) => String(loc._id) === String(locationId)) : null;
    const fallbackLocation = locations.find((loc) => loc?.isActive !== false) || locations[0];

    const settings = {
      companyDisplayName: store.companyDisplayName || store.companyName || store.storeName || DEFAULT_SETTINGS.companyDisplayName,
      companyLogo: store.logo || DEFAULT_SETTINGS.companyLogo,
      storePhone: store.storePhone || DEFAULT_SETTINGS.storePhone,
      email: store.email || DEFAULT_SETTINGS.email,
      website: store.website || DEFAULT_SETTINGS.website,
      businessAddress: location?.address || fallbackLocation?.address || DEFAULT_SETTINGS.businessAddress,
      taxNumber: store.taxNumber || DEFAULT_SETTINGS.taxNumber,
      refundDays: Number(store.refundDays) || DEFAULT_SETTINGS.refundDays,
      receiptMessage: store.receiptMessage || DEFAULT_SETTINGS.receiptMessage,
      qrUrl: location?.qrUrl || store.qrUrl || DEFAULT_SETTINGS.qrUrl,
      qrDataUrl: location?.qrDataUrl || store.qrDataUrl || DEFAULT_SETTINGS.qrDataUrl,
      qrDescription: store.qrDescription || DEFAULT_SETTINGS.qrDescription,
      paymentStatus: store.paymentStatus || DEFAULT_SETTINGS.paymentStatus,
      fontSize: store.fontSize || DEFAULT_SETTINGS.fontSize,
      fontFamily: store.fontFamily || DEFAULT_SETTINGS.fontFamily,
      fontWeight: store.fontWeight || DEFAULT_SETTINGS.fontWeight,
    };

    return res.status(200).json({ success: true, settings });
  } catch (error) {
    console.error("Error fetching receipt settings:", error);
    // The till prints with its saved copy or defaults when this fails
    return res.status(500).json({ success: false, message: "Failed to load receipt settings" });
  }
}
