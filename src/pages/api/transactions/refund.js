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
import Product from '@/src/models/Product';
import { reverseInventoryForRefund } from '@/src/lib/syncPackQty';
import EndOfDayReport from '@/src/models/EndOfDayReport';
import { sanitizeBody } from '@/src/lib/apiValidation';

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

const syncClosedTillReport = async (till) => {
  const report = await EndOfDayReport.findOne({ tillId: till._id });
  if (!report) return false;

  const tenderBreakdownMap = ensureTenderBreakdownMap(till.tenderBreakdown);
  const tenderBreakdownObj = Object.fromEntries(tenderBreakdownMap);
  const recalculatedTotalSales = Object.values(tenderBreakdownObj).reduce(
    (sum, amount) => sum + Number(amount || 0),
    0
  );
  const expectedClosingBalance = Number(till.openingBalance || 0) + recalculatedTotalSales;
  const physicalCount = Number(report.physicalCount || till.physicalCount || 0);
  const variance = physicalCount - expectedClosingBalance;
  const variancePercentage = expectedClosingBalance > 0
    ? (variance / expectedClosingBalance) * 100
    : 0;

  report.totalSales = recalculatedTotalSales;
  report.transactionCount = Number(till.transactionCount || 0);
  report.tenderBreakdown = new Map(Object.entries(tenderBreakdownObj));
  report.expectedClosingBalance = expectedClosingBalance;
  report.variance = variance;
  report.variancePercentage = variancePercentage;
  report.status = Math.abs(variance) < 0.01 ? 'RECONCILED' : 'VARIANCE_NOTED';
  report.updatedAt = new Date();
  await report.save();

  return true;
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
      // Find transaction
      const transaction = await Transaction.findById(transactionId);

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Transaction not found'
        });
      }

      if (transaction.status === 'refunded') {
        return res.status(200).json({
          success: true,
          message: 'Transaction already refunded',
          transactionId: transaction._id,
          refundStatus: 'already_refunded',
          alreadyRefunded: true,
        });
      }

      const previousStatus = transaction.status;

	      // Update transaction status to refunded/void
	      transaction.status = 'refunded';
	      transaction.subStatus = 'void';
	      transaction.refundReason = refundReason || 'Refunded by staff';
      transaction.refundBy = staffId;
      transaction.refundedAt = new Date();
      transaction.updatedAt = new Date();

      await transaction.save();

      console.log(`✅ Transaction ${transactionId} marked as refunded`);

      let inventoryRestocked = false;
      let tillAdjusted = false;
      let reportAdjusted = false;

      // Only reverse inventory/till impact if the transaction previously counted as a completed sale
      if (previousStatus === 'completed') {
        // Restock inventory once (idempotent)
        if (transaction.inventoryUpdated && !transaction.inventoryRestockedAt) {
          try {
            const mappedItems = (transaction.items || []).map((item) => ({
              productId: item.productId || item.id,
              qty: item.qty || item.quantity || 0,
            }));

            await reverseInventoryForRefund(mappedItems);

            transaction.inventoryRestockedAt = new Date();
            await transaction.save();
            inventoryRestocked = true;
          } catch (stockErr) {
            console.warn('⚠️ Failed to restock inventory for refund:', stockErr.message);
          }
        }

        // Reverse till totals if till is still open
        if (transaction.tillId) {
          try {
            const till = await Till.findById(transaction.tillId);
            if (till) {
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

              if (till.status !== 'OPEN') {
                reportAdjusted = await syncClosedTillReport(till);
              }
            }
          } catch (tillErr) {
            console.warn('⚠️ Failed to adjust till on refund:', tillErr.message);
          }
        }
      }

	      return res.status(200).json({
	        success: true,
	        message: 'Transaction refunded successfully',
	        transactionId: transaction._id,
		        refundStatus: 'refund',
		        subStatus: 'void',
		        inventoryRestocked,
		        tillAdjusted,
		        reportAdjusted,
		        transaction: {
		          id: transaction._id,
		          status: 'refunded',
		          subStatus: 'void',
		          refundedAt: transaction.refundedAt,
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
