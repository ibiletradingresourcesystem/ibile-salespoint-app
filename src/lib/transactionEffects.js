import mongoose from 'mongoose';
import Till from '@/src/models/Till';
import { Transaction } from '@/src/models/Transactions';
import { ROOM_STATUSES } from '@/src/lib/roomReservations';
import { markRoomsFromTransaction } from '@/src/lib/roomAvailability';
import { updateInventoryForSale } from '@/src/lib/syncPackQty';
import { isDesktopServer } from '@/src/lib/runtime';

/**
 * Runs work as one all-or-nothing change in the cloud database. The desktop app's single local
 * database has no multi-document transactions, so there it just runs.
 */
export async function runAtomically(work) {
  if (isDesktopServer()) return work(null);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession().catch(() => {});
  }
}

/**
 * Takes a sale's items off stock exactly once. The flag and the stock change together, so a sale
 * sent again after a failure can never be taken off twice, even for the items that had gone through.
 * Throws if the stock could not be updated: the caller must not report the sale as finished.
 */
export async function applySaleStock(transaction, items) {
  if (transaction.inventoryUpdated) return;

  await runAtomically(async (session) => {
    if (session) {
      const claimed = await Transaction.updateOne(
        { _id: transaction._id, inventoryUpdated: { $ne: true } },
        { $set: { inventoryUpdated: true } },
        { session }
      );
      if (claimed.modifiedCount > 0) await updateInventoryForSale(items, { session });
    } else {
      await updateInventoryForSale(items);
      await Transaction.updateOne({ _id: transaction._id }, { $set: { inventoryUpdated: true } });
    }
  });

  transaction.inventoryUpdated = true;
}

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