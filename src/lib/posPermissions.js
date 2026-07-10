export const POS_PERMISSION_KEYS = [
  "sidebarAccess",
  "settingsAccess",
  "printerSettingsAccess",
  "refundAccess",
  "applyDiscount",
  "adjustFloat",
  "closeTill",
  "viewAdvancedOrders",
  "openTillCashEntry",
];

export function normalizeStaffRole(role) {
  const value = String(role || "staff").trim().toLowerCase();

  if (value === "senior staff") return "manager";
  if (value === "junior staff") return "junior staff";
  if (value === "manager") return "manager";
  if (value === "admin") return "admin";
  return "staff";
}

export function getDefaultPosPermissions(role) {
  const normalizedRole = normalizeStaffRole(role);

  if (normalizedRole === "admin" || normalizedRole === "manager") {
    return {
      sidebarAccess: true,
      settingsAccess: true,
      printerSettingsAccess: true,
      refundAccess: true,
      applyDiscount: true,
      adjustFloat: true,
      closeTill: true,
      viewAdvancedOrders: true,
      openTillCashEntry: true,
    };
  }

  if (normalizedRole === "junior staff") {
    return {
      sidebarAccess: false,
      settingsAccess: true,
      printerSettingsAccess: false,
      refundAccess: false,
      applyDiscount: false,
      adjustFloat: false,
      closeTill: false,
      viewAdvancedOrders: false,
      openTillCashEntry: false,
    };
  }

  return {
    sidebarAccess: false,
    settingsAccess: true,
    printerSettingsAccess: false,
    refundAccess: false,
    applyDiscount: true,
    adjustFloat: false,
    closeTill: false,
    viewAdvancedOrders: false,
    openTillCashEntry: true,
  };
}

export function normalizePosPermissions(role, permissions = {}) {
  const defaults = getDefaultPosPermissions(role);

  return POS_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = typeof permissions?.[key] === "boolean" ? permissions[key] : defaults[key];
    return acc;
  }, {});
}

export function normalizeStaffMember(member) {
  if (!member) return member;
  const role = normalizeStaffRole(member.role);

  return {
    ...member,
    role,
    posPermissions: normalizePosPermissions(role, member.posPermissions),
  };
}

export function normalizeStaffList(list = []) {
  return Array.isArray(list) ? list.map(normalizeStaffMember) : [];
}

export function hasPosPermission(staffMember, key) {
  return Boolean(normalizePosPermissions(staffMember?.role, staffMember?.posPermissions)?.[key]);
}