// Stub — room functionality removed
export const ROOM_PRODUCT_TYPE = "room";
export const ROOM_STATUSES = {
  AVAILABLE: "available",
  RESERVED: "reserved",
  OCCUPIED: "occupied",
};

export function isRoomProduct() { return false; }
export function isRoomUnavailable() { return false; }
export function getRoomStatusLabel() { return ""; }
export function getRoomReservationDetails() { return null; }
export function getRoomReservationDateRange() { return ""; }
export function normalizeRoomStatus() { return "available"; }
