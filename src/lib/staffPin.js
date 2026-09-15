import bcrypt from "bcryptjs";

export const BCRYPT_HASH_PATTERN = /^\$2[abxy]\$\d{2}\$/;

export const verifyPin = async (staffMember, pin) => {
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

/**
 * Staff records sent to a desktop installation must never carry a plaintext passcode, even for
 * legacy accounts whose passcode is still stored unhashed in the cloud.
 */
export const hashIfPlaintext = async (value) => {
  if (typeof value !== "string" || value === "") return value;
  if (BCRYPT_HASH_PATTERN.test(value)) return value;
  return bcrypt.hash(value, 10);
};
