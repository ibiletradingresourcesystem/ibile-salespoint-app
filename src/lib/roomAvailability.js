import Product from '@/src/models/Product';
import {
  ROOM_PRODUCT_TYPE,
  ROOM_STATUSES,
  getRoomReservationDetails,
  isRoomProduct,
} from '@/src/lib/roomReservations';

function getRoomProductId(item = {}) {
  return String(item?.productId || item?.id || '').trim();
}

function toDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function markRoomsFromTransaction(items = [], transaction = {}, nextStatus = ROOM_STATUSES.RESERVED) {
  const roomItems = (Array.isArray(items) ? items : []).filter((item) => isRoomProduct(item));
  if (roomItems.length === 0) return;

  await Promise.all(roomItems.map(async (item) => {
    const productId = getRoomProductId(item);
    if (!productId) return;

    const reservation = getRoomReservationDetails(item);
    await Product.findByIdAndUpdate(productId, {
      $set: {
        productType: ROOM_PRODUCT_TYPE,
        roomStatus: nextStatus,
        quantity: 0,
        currentBooking: {
          guestName: reservation.guestName,
          guestPhone: reservation.guestPhone,
          checkInAt: toDateOrNull(reservation.checkInAt),
          checkOutAt: toDateOrNull(reservation.checkOutAt),
          notes: reservation.notes,
          sourceTransactionId: String(transaction?._id || transaction?.externalId || ''),
          sourceTransactionStatus: String(transaction?.status || ''),
          updatedAt: new Date(),
        },
      },
    });
  }));
}

export async function releaseRoomsFromTransaction(items = [], transaction = {}) {
  const roomIds = [...new Set(
    (Array.isArray(items) ? items : [])
      .filter((item) => isRoomProduct(item))
      .map((item) => getRoomProductId(item))
      .filter(Boolean)
  )];

  if (roomIds.length === 0) return;

  const sourceTransactionId = String(transaction?._id || transaction?.externalId || '').trim();
  const roomProducts = await Product.find({ _id: { $in: roomIds } })
    .select('_id currentBooking')
    .lean();

  await Promise.all(roomProducts.map(async (product) => {
    const currentSourceId = String(product?.currentBooking?.sourceTransactionId || '').trim();
    if (sourceTransactionId && currentSourceId && currentSourceId !== sourceTransactionId) {
      return;
    }

    await Product.findByIdAndUpdate(product._id, {
      $set: {
        productType: ROOM_PRODUCT_TYPE,
        roomStatus: ROOM_STATUSES.AVAILABLE,
        quantity: 0,
        currentBooking: null,
      },
    });
  }));
}

export async function releaseExpiredRoomBookings(now = new Date()) {
  const currentTime = toDateOrNull(now) || new Date();

  const result = await Product.updateMany(
    {
      productType: ROOM_PRODUCT_TYPE,
      roomStatus: { $in: [ROOM_STATUSES.RESERVED, ROOM_STATUSES.OCCUPIED] },
      'currentBooking.checkOutAt': { $lte: currentTime },
    },
    {
      $set: {
        roomStatus: ROOM_STATUSES.AVAILABLE,
        quantity: 0,
        currentBooking: null,
      },
    }
  );

  return result?.modifiedCount || 0;
}