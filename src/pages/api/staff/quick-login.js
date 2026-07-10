import { mongooseConnect } from "@/src/lib/mongoose";
import { Staff } from "@/src/models/Staff";
import Store from "@/src/models/Store";
import { setSessionCookie } from "@/src/lib/sessionAuth";
import { sanitizeString } from "@/src/lib/apiValidation";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const payload = req.body || {};
  const staffId = sanitizeString(payload.staffId || "");

  if (!staffId) {
    return res.status(400).json({ success: false, message: "Staff ID is required." });
  }

  try {
    await mongooseConnect();

    const staffMember = await Staff.findById(staffId).lean();
    if (!staffMember) {
      return res.status(404).json({ success: false, message: "Staff not found." });
    }

    // Only allow quick login for "staff" role
    const role = String(staffMember.role || "").trim().toLowerCase();
    if (role !== "staff") {
      return res.status(403).json({ success: false, message: "Quick login is only available for staff role." });
    }

    if (staffMember.isActive === false) {
      return res.status(403).json({ success: false, message: "This staff account is inactive." });
    }

    const storeData = await Store.findOne({});
    const storeObj = storeData ? (storeData.toObject ? storeData.toObject() : storeData) : null;
    const allLocations = Array.isArray(storeObj?.locations) ? storeObj.locations : [];
    const activeLocations = allLocations.filter((loc) => loc?.isActive !== false);

    // Resolve staff's assigned location
    const requestedLocation = sanitizeString(payload.location || "");
    let locationData = null;
    if (requestedLocation) {
      const reqLower = requestedLocation.toLowerCase();
      locationData = allLocations.find((loc) => {
        return loc?._id?.toString() === requestedLocation ||
          String(loc?.name || "").toLowerCase() === reqLower;
      });
    }
    if (!locationData) {
      // Try staff's assigned location
      const staffLocId = staffMember.locationId?.toString() || staffMember.location?.toString() || "";
      if (staffLocId) {
        locationData = allLocations.find((loc) => loc?._id?.toString() === staffLocId);
      }
    }
    if (!locationData) {
      locationData = activeLocations[0] || allLocations[0] || null;
    }

    const finalLocation = locationData || {
      _id: "default",
      name: "Main Store",
      address: "",
      phone: "",
      email: "",
    };

    setSessionCookie(res, String(staffMember._id));

    const storeName = storeObj?.storeName || storeObj?.companyName || "Default Store";

    return res.status(200).json({
      success: true,
      message: "Quick login successful",
      staff: {
        _id: staffMember._id,
        name: staffMember.name,
        username: staffMember.username,
        role: staffMember.role,
        locationId: finalLocation?._id,
        locationName: finalLocation?.name || "Main Store",
        storeId: storeObj?._id?.toString() || null,
      },
      store: {
        _id: storeObj?._id?.toString() || null,
        name: storeName,
      },
      location: finalLocation,
    });
  } catch (error) {
    console.error("Quick login error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
