/**
 * API Endpoint: POST /api/transactions/refund
 * 
 * Processes refund requests for completed transactions
 * - Allows admin, manager, senior staff to refund transactions
 * - Marks transaction as refunded (subStatus: void) in database
 * - Optionally updates product quantities back (reverses the sale)
 */

import { mongooseConnect } from '@/src/lib/mongoose';
import { Transaction } from '@/src/models/Transactions';
import Till from '@/src/models/Till';
import { reverseInventoryForRefund } from '@/src/lib/syncPackQty';
import { sanitizeBody } from '@/src/lib/apiValidation';
import { releaseRoomsFromTransaction } from '@/src/lib/roomAvailability';
import { requirePosPermission } from '@/src/lib/staffAccess';
import { runAtomically } from '@/src/lib/transactionEffects';
import { webTillScope } from '@/src/lib/runtime';

const getTenderEntries = (transaction) => {
  if (Array.isArray(transaction?.tenderPayments) && transaction.tenderPayments.length > 0) {
    return transaction.tenderPayments.map((payment) => ({
      name: payment?.tenderName || 'CASH',
      amount: Number(payment?.amount || 0),
    }));
  }

  return [{
    name: transaction?.tenderType || 'CASH',
    amount: Number(transaction?.total || 0),
  }];
};

const ensureTenderBreakdownMap = (value) =>
  value instanceof Map ? value : new Map(Object.entries(value || {}));

const applyTenderDelta = (map, entries = [], sign = -1) => {
  entries.forEach((entry) => {
    const key = entry?.name || 'CASH';
    const current = Number(map.get(key) || 0);
    const next = Math.max(0, current + (sign * Number(entry?.amount || 0)));
    map.set(key, next);
  });
};

export default async function handler(req, res) {
  // Only support POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  req.body = sanitizeBody(req.body);

  try {
    await mongooseConnect();

    const {
      transactionId,
      action, // 'recall' or 'process'
      refundReason,
      staffId,
    } = req.body;

    // Validate required fields
    if (!transactionId || !action) {
      return res.status(400).json({
        success: false,
        error: 'transactionId and action required'
      });
    }

    // Only 'process' action saves to database (marks as deleted)
    // 'recall' just returns the transaction data to the client
    if (action === 'process') {
      const staffMember = await requirePosPermission(req, res, 'refundAccess');
      if (!staffMember) return;

      // A string only: an object here would be run as a database query
      if (typeof transactionId !== 'string') {
        return res.status(400).json({ success: false, error: 'transactionId and action required' });
      }

      // Find transaction
      const transaction = await Transaction.findById(transactionId);

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Transaction not found'
        });
      }

      const alreadyRefunded = () => res.status(200).json({
        success: true,
        message: 'Transaction already refunded',
        transactionId: transaction._id,
        refundStatus: 'already_refunded',
        alreadyRefunded: true,
      });

      if (transaction.status === 'refunded') return alreadyRefunded();

      const previousStatus = transaction.status;
      const restock = previousStatus === 'completed' && transaction.inventoryUpdated && !transaction.inventoryRestockedAt;
      const refundedAt = new Date();

      // The refund and its restock are one change: if the stock cannot be put back nothing is
      // refunded and it can be tried again, and two refunds at once can only restock once
      const refunded = await runAtomically(async (session) => {
        const claimed = await Transaction.updateOne(
          { _id: transaction._id, status: { $ne: 'refunded' } },
          {
            $set: {
              status: 'refunded',
              subStatus: 'void',
              refundReason: refundReason || 'Refunded by staff',
              refundBy: staffMember._id,
              refundedAt,
              updatedAt: refundedAt,
              ...(restock ? { inventoryRestockedAt: refundedAt } : {}),
            },
          },
          { session }
        );
        if (claimed.modifiedCount === 0) return false;

        if (restock) {
          const mappedItems = (transaction.items || []).map((item) => ({
            productId: item.productId || item.id,
            qty: item.qty || item.quantity || 0,
          }));
          await reverseInventoryForRefund(mappedItems, { session });
        }
        return true;
      });

      if (!refunded) return alreadyRefunded();

      console.log(`✅ Transaction ${transactionId} marked as refunded`);

      let tillAdjusted = false;

      // Only a transaction that counted as a completed sale has takings to reverse
      if (previousStatus === 'completed') {
        if (transaction.tillId) {
          try {
            const till = await Till.findById(transaction.tillId);
            if (till?.status === 'OPEN') {
              // Still open: the sale simply no longer counts towards this till's takings
              till.transactions = (till.transactions || []).filter(
                (txId) => String(txId) !== String(transaction._id)
              );
              till.transactionCount = till.transactions.length;
              till.totalSales = Math.max(
                0,
                Number(till.totalSales || 0) - Number(transaction.total || 0)
              );

              till.tenderBreakdown = ensureTenderBreakdownMap(till.tenderBreakdown);
              applyTenderDelta(till.tenderBreakdown, getTenderEntries(transaction), -1);

              till.markModified('tenderBreakdown');
              await till.save();
              tillAdjusted = true;
            } else if (till) {
              // Closed: that day's count was right and stands. The money comes out of the drawer
              // open now, so that till is expected to hold this much less when it closes.
              const openTill = await Till.findOne({
                locationId: till.locationId,
                status: 'OPEN',
                ...webTillScope(),
              })
                .sort({ openedAt: -1 })
                .select('_id')
                .lean();

              if (openTill) {
                await Till.updateOne(
                  { _id: openTill._id, 'refundsPaid.transactionId': { $ne: transaction._id } },
                  {
                    $push: {
                      refundsPaid: {
                        transactionId: transaction._id,
                        total: Number(transaction.total || 0),
                        tenders: getTenderEntries(transaction),
                        refundedAt,
                        staffName: staffMember.name || '',
                      },
                    },
                  }
                );
                tillAdjusted = true;
              }
            }
          } catch (tillErr) {
            console.warn('⚠️ Failed to adjust till on refund:', tillErr.message);
          }
        }

        try {
          await releaseRoomsFromTransaction(transaction.items || [], transaction);
        } catch (roomReleaseErr) {
          console.warn('⚠️ Failed to release room availability on refund:', roomReleaseErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Transaction refunded successfully',
        transactionId: transaction._id,
        refundStatus: 'refund',
        subStatus: 'void',
        inventoryRestocked: Boolean(restock),
        tillAdjusted,
        transaction: {
          id: transaction._id,
          status: 'refunded',
          subStatus: 'void',
          refundedAt,
        }
      });
    } else if (action === 'recall') {
      // Just fetch and return transaction data (for recalling to cart)
      const transaction = await Transaction.findById(transactionId);

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Transaction not found'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Transaction recalled to cart',
        action: 'recall',
        transaction: {
          id: transaction._id,
          items: transaction.items,
          total: transaction.total,
          subtotal: transaction.subtotal,
          tax: transaction.tax,
          discount: transaction.discount,
          tenderType: transaction.tenderType,
          tenderPayments: transaction.tenderPayments,
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be "recall" or "process"'
      });
    }
  } catch (error) {
    console.error('❌ Error processing refund:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process refund'
    });
  }
}
