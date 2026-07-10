/**
 * API Endpoint: GET /api/receipt-settings
 * 
 * Fetches receipt configuration settings from the Store document
 * Used by receipt printing system to generate branded receipts
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import Store from "@/src/models/Store";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const { locationId } = req.query;

    // Fetch the store document which contains receipt settings
    const store = await Store.findOne({});

    // Default settings (always return 200 with defaults if no store)
    const defaultSettings = {
      companyDisplayName: store?.storeName || "Store",
      companyLogo: "/images/placeholder.jpg",
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
    };

    if (!store) {
      return res.status(200).json({
        success: true,
        settings: defaultSettings,
      });
    }

    // Extract receipt settings from store, falling back to defaults
    // Use per-location QR if locationId is provided and location has its own QR
    let locationQrUrl = "";
    let locationQrDataUrl = "";
    if (locationId) {
      const loc = store.locations?.find((l) => l._id?.toString() === locationId);
      if (loc?.qrUrl) locationQrUrl = loc.qrUrl;
      if (loc?.qrDataUrl) locationQrDataUrl = loc.qrDataUrl;
    }

    const settings = {
      companyDisplayName: store.companyDisplayName || defaultSettings.companyDisplayName,
      companyLogo: store.logo || defaultSettings.companyLogo,
      storePhone: store.storePhone || defaultSettings.storePhone,
      email: store.email || defaultSettings.email,
      website: store.website || defaultSettings.website,
      businessAddress:
        store.address ||
        store.locations?.find((loc) => loc?.isActive !== false)?.address ||
        store.locations?.[0]?.address ||
        defaultSettings.businessAddress,
      taxNumber: store.taxNumber || defaultSettings.taxNumber,
      refundDays: store.refundDays || defaultSettings.refundDays,
      receiptMessage: store.receiptMessage || defaultSettings.receiptMessage,
      qrUrl: locationQrUrl || store.qrUrl || defaultSettings.qrUrl,
      qrDataUrl: locationQrDataUrl || store.qrDataUrl || defaultSettings.qrDataUrl,
      qrDescription: store.qrDescription || defaultSettings.qrDescription,
      paymentStatus: store.paymentStatus || defaultSettings.paymentStatus,
      fontSize: store.fontSize || defaultSettings.fontSize,
      fontFamily: store.fontFamily || defaultSettings.fontFamily,
    };

    return res.status(200).json({
      success: true,
      settings,
      store: {
        name: store.storeName,
        locations: store.locations,
      },
    });
  } catch (error) {
    console.error("Error fetching receipt settings:", error);
    // Return 200 with default settings even on error (graceful fallback)
    return res.status(200).json({
      success: true,
      settings: {
        companyDisplayName: "Store",
        companyLogo: "/images/placeholder.jpg",
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
      },
      error: error.message,
    });
  }
}
