import Till from '@/src/models/Till';
import { ROOM_STATUSES } from '@/src/lib/roomReservations';
import { markRoomsFromTransaction } from '@/src/lib/roomAvailability';
import { updateInventoryForSale } from '@/src/lib/syncPackQty';

export async function applyCompletedTransactionEffects(transaction, items, isCompletedTransaction) {
  if (!isCompletedTransaction) {
    return { applied: false };
  }

  await markRoomsFromTransaction(items, transaction, ROOM_STATUSES.RESERVED);

  if (transaction.inventoryUpdated) {
    return { applied: false, roomsApplied: true };
  }

  await updateInventoryForSale(items);

  transaction.inventoryUpdated = true;
  await transaction.save();

  return { applied: true };
}

export async function linkCompletedTransactionToTill({
  transaction,
  tillId,
  total,
  tenderType,
  tenderPayments,
  hasMultiplePayments,
  isCompletedTransaction,
}) {
  if (!tillId || !isCompletedTransaction) {
    return { linked: false };
  }

  const till = await Till.findById(tillId);
  if (!till) {
    throw new Error(`Till ${tillId} not found for completed transaction`);
  }

  const alreadyLinked = till.transactions.some((txId) => String(txId) === String(transaction._id));
  if (alreadyLinked) {
    return { linked: false, alreadyLinked: true };
  }

  till.transactions.push(transaction._id);
  till.totalSales = (till.totalSales || 0) + Number(total || 0);
  till.transactionCount = till.transactions.length;

  if (!(till.tenderBreakdown instanceof Map)) {
    till.tenderBreakdown = new Map(Object.entries(till.tenderBreakdown || {}));
  }

  if (hasMultiplePayments) {
    tenderPayments.forEach((payment) => {
      const tenderName = payment.tenderName || 'Unknown';
      const currentAmount = till.tenderBreakdown.get(tenderName) || 0;
      till.tenderBreakdown.set(tenderName, currentAmount + Number(payment.amount || 0));
    });
  } else {
    const tenderKey = tenderType || 'CASH';
    const currentAmount = till.tenderBreakdown.get(tenderKey) || 0;
    till.tenderBreakdown.set(tenderKey, currentAmount + Number(total || 0));
  }

  till.markModified('tenderBreakdown');
  await till.save();

  return { linked: true };
}