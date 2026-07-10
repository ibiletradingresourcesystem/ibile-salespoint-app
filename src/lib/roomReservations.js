export const ROOM_PRODUCT_TYPE = "room";
export const ROOM_STATUSES = {
  AVAILABLE: "available",
  RESERVED: "reserved",
  OCCUPIED: "occupied",
};

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toIsoString(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function normalizeRoomStatus(value) {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === ROOM_STATUSES.RESERVED) return ROOM_STATUSES.RESERVED;
  if (normalized === ROOM_STATUSES.OCCUPIED) return ROOM_STATUSES.OCCUPIED;
  return ROOM_STATUSES.AVAILABLE;
}

export function isRoomProduct(entity = {}) {
  return asTrimmedString(entity?.productType || entity?.itemType).toLowerCase() === ROOM_PRODUCT_TYPE;
}

export function isRoomUnavailable(entity = {}) {
  return isRoomProduct(entity) && normalizeRoomStatus(entity?.roomStatus) !== ROOM_STATUSES.AVAILABLE;
}

export function getRoomReservationDetails(entity = {}) {
  const source = entity?.reservationDetails && typeof entity.reservationDetails === "object"
    ? entity.reservationDetails
    : entity?.currentBooking && typeof entity.currentBooking === "object"
      ? entity.currentBooking
      : {};

  return {
    guestName: asTrimmedString(source.guestName || source.customerName),
    guestPhone: asTrimmedString(source.guestPhone || source.phone),
    checkInAt: toIsoString(source.checkInAt || source.checkInDate),
    checkOutAt: toIsoString(source.checkOutAt || source.checkOutDate),
    notes: asTrimmedString(source.notes),
  };
}

export function hasCompleteRoomReservation(entity = {}) {
  const reservation = getRoomReservationDetails(entity);
  return Boolean(
    reservation.guestName &&
      reservation.checkInAt &&
      reservation.checkOutAt
  );
}

export function getRoomStatusLabel(status) {
  switch (normalizeRoomStatus(status)) {
    case ROOM_STATUSES.RESERVED:
      return "Reserved";
    case ROOM_STATUSES.OCCUPIED:
      return "Occupied";
    default:
      return "Available";
  }
}

export function getRoomReservationDateRange(entity = {}) {
  const reservation = getRoomReservationDetails(entity);
  if (!reservation.checkInAt || !reservation.checkOutAt) return "";

  const checkInDate = new Date(reservation.checkInAt);
  const checkOutDate = new Date(reservation.checkOutAt);
  if (Number.isNaN(checkInDate.getTime()) || Number.isNaN(checkOutDate.getTime())) {
    return "";
  }

  return `${checkInDate.toLocaleDateString()} - ${checkOutDate.toLocaleDateString()}`;
}