/**
 * Transaction Sync Endpoint
 * 
 * Receives offline transactions from client and stores them in database
 * Called during auto-sync when client comes back online
 */

import { mongooseConnect } from '@/src/lib/mongoose';
import { Transaction } from '@/src/models/Transactions';
import { sanitizeBody } from '@/src/lib/apiValidation';
import {
  applyCompletedTransactionEffects,
  linkCompletedTransactionToTill,
} from '@/src/lib/transactionEffects';

const normalizeLocationName = (location) => {
  if (typeof location === 'string' && location.trim()) return location.trim();
  if (location && typeof location === 'object') {
    if (typeof location.name === 'string' && location.name.trim()) return location.name.trim();
    if (typeof location.code === 'string' && location.code.trim()) return location.code.trim();
  }
  return 'Main Store';
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  req.body = sanitizeBody(req.body);

  try {
    await mongooseConnect();
    console.log('ðŸ“¤ Transaction sync request received:', req.body);

    const { 
      id, 
      items, 
      total, 
      tax, 
      subtotal, 
      tenderType,           // Legacy: single tender
      tenderPayments,       // New: split payments [{tenderId, tenderName, amount}]
      discount = 0,
      discountName = '',
      discountReason = '',
      shippingCost = 0,
      deliveryFee = 0,
      deliveryFeeName = '',
      serviceCharge = 0,
      handlingFee = 0,
      additionalCharges = [],
      fees = [],
      adjustments = [],
      incrementAmount = 0,
      incrementName = '',
      promotionValueType = null,
      amountPaid,
      change,
      staffName, 
      staffId,
      location = 'Default Location',
      status = 'completed',
      createdAt, 
      completedAt,
      tillId,               // Till ID to link transaction
      externalId
    } = req.body;

    // Determine which payment method is being used
    const hasMultiplePayments = tenderPayments && Array.isArray(tenderPayments) && tenderPayments.length > 0;
    const hasSingleTender = tenderType && !hasMultiplePayments;
    const rawStatus = String(status || 'completed').trim().toLowerCase();
    const normalizedStatus = rawStatus === 'complete' ? 'completed' : rawStatus;
    const isHeldTransaction = normalizedStatus === 'held';
    const isCompletedTransaction = normalizedStatus === 'completed';
    const normalizedLocation = normalizeLocationName(location);

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction: items array required',
      });
    }

    if (total === undefined || (!isHeldTransaction && !hasSingleTender && !hasMultiplePayments)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction: total and (tenderType or tenderPayments) required',
      });
    }

    const mappedItems = (items || []).map(item => ({
      ...item,
      productId: item.productId || item.id,
      name: item.name,
      salePriceIncTax: item.price || item.salePriceIncTax || 0,
      qty: item.quantity || item.qty || 0,
    }));

    // DUPLICATE PREVENTION: Check if this transaction already exists
    // Based on createdAt timestamp, total, tillId, and staffName
    if (externalId) {
      const existingTransaction = await Transaction.findOne({ externalId });
      if (existingTransaction) {
        console.log(`Ã¢Å¡Â Ã¯Â¸Â Duplicate sync transaction detected - externalId ${externalId}`);
        await applyCompletedTransactionEffects(existingTransaction, mappedItems, isCompletedTransaction);
        await linkCompletedTransactionToTill({
          transaction: existingTransaction,
          tillId,
          total,
          tenderType,
          tenderPayments,
          hasMultiplePayments,
          isCompletedTransaction,
        });
        return res.status(200).json({
          success: true,
          message: 'Transaction already exists (duplicate prevented)',
          transactionId: existingTransaction._id,
          duplicate: true
        });
      }
    } else if (createdAt && tillId) {
      const mongoose = require('mongoose');
      const existingTransaction = await Transaction.findOne({
        createdAt: new Date(createdAt),
        total: total,
        tillId: new mongoose.Types.ObjectId(tillId),
        staffName: staffName || 'Unknown'
      });
      
      if (existingTransaction) {
        console.log(`âš ï¸ Duplicate sync transaction detected - already exists as ${existingTransaction._id}`);
        await applyCompletedTransactionEffects(existingTransaction, mappedItems, isCompletedTransaction);
        await linkCompletedTransactionToTill({
          transaction: existingTransaction,
          tillId,
          total,
          tenderType,
          tenderPayments,
          hasMultiplePayments,
          isCompletedTransaction,
        });
        return res.status(200).json({
          success: true,
          message: 'Transaction already exists (duplicate prevented)',
          transactionId: existingTransaction._id,
          duplicate: true
        });
      }
    }

    // Create transaction record - support both payment methods
    const transaction = new Transaction({
      externalId: externalId || id,
      items: mappedItems,
      subtotal: subtotal || 0,
      tax: tax || 0,
      discount: discount || 0,
      discountName,
      discountReason,
      shippingCost: Number(shippingCost || 0),
      deliveryFee: Number(deliveryFee || 0),
      deliveryFeeName,
      serviceCharge: Number(serviceCharge || 0),
      handlingFee: Number(handlingFee || 0),
      additionalCharges: Array.isArray(additionalCharges) ? additionalCharges : [],
      fees: Array.isArray(fees) ? fees : [],
      adjustments: Array.isArray(adjustments) ? adjustments : [],
      incrementAmount: Number(incrementAmount || 0),
      incrementName,
      promotionValueType,
      total,
      ...(hasSingleTender && { tenderType }),
      ...(hasMultiplePayments && { tenderPayments }),
      amountPaid: amountPaid || total,
      change: Number(change || 0),
      ...(staffId && { staff: staffId }),
      staffName: staffName && staffName !== 'Unknown' ? staffName : 'POS Staff',
      location: normalizedLocation,
      status: normalizedStatus,
      ...(tillId && { tillId }),
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      completedAt: completedAt ? new Date(completedAt) : new Date(),
      syncedFrom: 'offline',
      syncedAt: new Date(),
    });

    await transaction.save();
    console.log('âœ… Transaction synced successfully:', transaction._id);

    if (isCompletedTransaction) {
      await applyCompletedTransactionEffects(transaction, mappedItems, true);
      await linkCompletedTransactionToTill({
        transaction,
        tillId,
        total,
        tenderType,
        tenderPayments,
        hasMultiplePayments,
        isCompletedTransaction,
      });
    } else if (tillId) {
      console.log(`â„¹ï¸ Skipping till totals update for non-completed transaction status: ${normalizedStatus}`);
    }
    return res.status(200).json({
      success: true,
      message: 'Transaction synced successfully',
      transactionId: transaction._id,
      externalId: externalId || id,
    });
  } catch (err) {
    if (err?.code === 11000 && (err?.keyPattern?.externalId || err?.keyPattern?.dedupeKey)) {
      console.warn('âš ï¸ Duplicate sync insert blocked by unique index:', err.keyValue?.externalId || err.keyValue?.dedupeKey);
      return res.status(200).json({
        success: true,
        message: 'Transaction already exists (duplicate prevented)',
        duplicate: true,
      });
    }
    console.error('âŒ Transaction sync error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync transaction',
      error: err.message,
    });
  }
}




