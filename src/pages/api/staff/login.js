import { mongooseConnect } from "@/src/lib/mongoose";
import { Staff } from "@/src/models/Staff";
import Store from "@/src/models/Store";
import bcrypt from "bcryptjs";
import { normalizePosPermissions } from "@/src/lib/posPermissions";
import { setSessionCookie } from "@/src/lib/sessionAuth";
import { sanitizeString } from "@/src/lib/apiValidation";

const sendError = (res, status, code, message, details = {}) =>
  res.status(status).json({
    success: false,
    code,
    message,
    ...details,
  });

const normalizePin = (value) => String(value || "").trim();

const findLocation = (locations = [], requestedLocation) => {
  if (!requestedLocation || !Array.isArray(locations)) return null;
  const requested = String(requestedLocation).trim();
  const requestedLower = requested.toLowerCase();

  return locations.find((loc) => {
    const idMatch = loc?._id?.toString() === requested;
    const nameMatch = String(loc?.name || "").toLowerCase() === requestedLower;
    const codeMatch = String(loc?.code || "").toLowerCase() === requestedLower;
    return idMatch || nameMatch || codeMatch;
  });
};

const verifyPin = async (staffMember, pin) => {
  if (!staffMember) return false;

  let isPinCorrect = false;

  if (staffMember.password) {
    try {
      isPinCorrect = await bcrypt.compare(pin, staffMember.password);
    } catch (err) {
      // Legacy/plain values can throw in compare. Ignore and fallback.
    }
  }

  if (!isPinCorrect && staffMember.pin) {
    try {
      isPinCorrect = await bcrypt.compare(pin, staffMember.pin);
    } catch (err) {
      // Legacy/plain values can throw in compare. Ignore and fallback.
    }
  }

  if (!isPinCorrect) {
    isPinCorrect = pin === staffMember.pin || pin === staffMember.password;
  }

  return isPinCorrect;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const payload = req.body || {};
  const staffId = sanitizeString(payload.newStaffId || payload.staffId || payload.staff || "");
  const pin = normalizePin(payload.pin);
  const requestedLocation = sanitizeString(payload.location || "");

  if (!staffId || !pin) {
    return sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Staff and 4-digit passcode are required."
    );
  }

  if (!/^\d{4}$/.test(pin)) {
    return sendError(
      res,
      400,
      "INVALID_PIN_FORMAT",
      "Passcode must be exactly 4 digits."
    );
  }

  try {
    await mongooseConnect();

    const staffMember = await Staff.findById(staffId).lean();
    if (!staffMember) {
      return sendError(
        res,
        401,
        "STAFF_NOT_FOUND",
        "Selected staff account was not found."
      );
    }

    if (staffMember.isActive === false) {
      return sendError(
        res,
        403,
        "STAFF_INACTIVE",
        "This staff account is inactive. Contact an admin."
      );
    }

    const isPinCorrect = await verifyPin(staffMember, pin);
    if (!isPinCorrect) {
      return sendError(
        res,
        401,
        "INVALID_CREDENTIALS",
        "Incorrect passcode for selected staff."
      );
    }

    const storeData = await Store.findOne({});
    const storeObj = storeData ? (storeData.toObject ? storeData.toObject() : storeData) : null;
    const allLocations = Array.isArray(storeObj?.locations) ? storeObj.locations : [];
    const activeLocations = allLocations.filter((loc) => loc?.isActive !== false);

    let locationData = findLocation(allLocations, requestedLocation);

    if (requestedLocation && !locationData) {
      return sendError(
        res,
        404,
        "LOCATION_NOT_FOUND",
        "Selected location is not available. Refresh and try again.",
        {
          availableLocations: activeLocations.map((loc) => ({
            _id: loc?._id?.toString(),
            name: loc?.name,
          })),
        }
      );
    }

    if (!locationData) {
      locationData = activeLocations[0] || allLocations[0] || null;
    }

    if (locationData && locationData.isActive === false) {
      return sendError(
        res,
        403,
        "LOCATION_INACTIVE",
        "Selected location is inactive."
      );
    }

    const finalLocationData = locationData || {
      _id: requestedLocation || "default",
      name: "Main Store",
      address: "",
      phone: "",
      email: "",
    };

    const storeName = storeObj?.storeName || storeObj?.companyName || "Default Store";

    // Set session cookie for API auth
    setSessionCookie(res, String(staffMember._id));

    return res.status(200).json({
      success: true,
      message: "Login successful",
      staff: {
        _id: staffMember._id,
        name: staffMember.name,
        username: staffMember.username,
        role: staffMember.role,
        locationId: finalLocationData?._id,
        locationName: finalLocationData?.name || staffMember.locationName || "Main Store",
        storeId: storeObj?._id?.toString() || null,
      },
      store: {
        _id: storeObj?._id || null,
        name: storeName,
      },
      location: {
        _id: finalLocationData?._id,
        name: finalLocationData?.name,
        address: finalLocationData?.address || "",
        phone: finalLocationData?.phone || "",
        email: finalLocationData?.email || "",
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return sendError(
      res,
      500,
      "LOGIN_SERVER_ERROR",
      "Unable to complete login right now. Please try again."
    );
  }
}
