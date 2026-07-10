/**
 * API Endpoint: POST /api/transactions/save
 * 
 * Direct transaction save endpoint for online clients
 * Receives transaction data and saves directly to MongoDB
 * Falls back to sync if response fails on client side
 */

import { mongooseConnect } from '@/src/lib/mongoose';
import { Transaction } from '@/src/models/Transactions';
import mongoose from 'mongoose';
import crypto from 'crypto';
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
  // Only POST method allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  req.body = sanitizeBody(req.body);

  try {
    console.log('ðŸ’¾ Direct transaction save request received');
    
    await mongooseConnect();

    const { 
      items, 
      total, 
      tax = 0, 
      subtotal = 0, 
      tenderType,
      tenderPayments,
      amountPaid,
      change,
      staffName = 'Unknown',
      staffId,
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
      location = 'Default Location',
      locationId,
      device,
      tableName,
      customerName,
      createdAt,
      status = 'completed',
      tillId,
      sessionId,
      externalId
    } = req.body;
    
    // Normalize staff name and location for legacy/offline payloads
    const finalStaffName = staffName && staffName !== 'Unknown' ? staffName : 'POS Staff';
    const normalizedLocation = normalizeLocationName(location);
    
    console.log(`ðŸ’° Processing direct transaction - amount: ${total}, till: ${tillId}`);

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error('âŒ Validation error: items array required');
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction: items array required',
      });
    }

    if (total === undefined) {
      console.error('âŒ Validation error: total required');
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction: total required',
      });
    }

    // Validate payment method
    const hasMultiplePayments = tenderPayments && Array.isArray(tenderPayments) && tenderPayments.length > 0;
    const hasSingleTender = tenderType && !hasMultiplePayments;
    const rawStatus = String(status || 'completed').trim().toLowerCase();
    const normalizedStatus = rawStatus === 'complete' ? 'completed' : rawStatus;
    const isHeldTransaction = normalizedStatus === 'held';
    const isCompletedTransaction = normalizedStatus === 'completed';

    if (!isHeldTransaction && !hasSingleTender && !hasMultiplePayments) {
      console.error('âŒ Validation error: payment method required');
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction: tenderType or tenderPayments required',
      });
    }

    const buildDedupeKey = () => {
      const createdAtStamp = createdAt ? new Date(createdAt) : new Date();
      const roundedCreatedAt = new Date(Math.floor(createdAtStamp.getTime() / 1000) * 1000).toISOString();
      const normalizedItems = (items || []).map((item) => ({
        productId: String(item.productId || item.id || ''),
        name: item.name || '',
        qty: Number(item.quantity || item.qty || 0),
        price: Number(item.price || item.salePriceIncTax || 0),
      }));
      const normalizedPayments = (tenderPayments || [])
        .map((p) => ({
          tenderId: String(p.tenderId || ''),
          tenderName: p.tenderName || '',
          amount: Number(p.amount || 0),
        }))
        .sort((a, b) => (a.tenderName + a.tenderId).localeCompare(b.tenderName + b.tenderId));
      const base = {
        items: normalizedItems,
        total: Number(total || 0),
        amountPaid: Number(amountPaid || total || 0),
        change: Number(change || 0),
        tenderType: hasMultiplePayments ? null : (tenderType || null),
        tenderPayments: normalizedPayments,
        staffId: staffId ? String(staffId) : null,
        location: normalizedLocation || null,
        tillId: tillId ? String(tillId) : null,
        createdAt: roundedCreatedAt,
        status: normalizedStatus,
      };
      return crypto.createHash('sha1').update(JSON.stringify(base)).digest('hex');
    };

    const dedupeKey = externalId || buildDedupeKey();

    // Map items to schema format before duplicate checks so retries can finish pending effects.
    const mappedItems = items.map(item => ({
      ...item,
      productId: item.productId || item.id,
      name: item.name,
      salePriceIncTax: item.price || item.salePriceIncTax,
      qty: item.quantity || item.qty,
    }));

    // DUPLICATE PREVENTION: Check if this transaction already exists
    if (externalId) {
      const existingTransaction = await Transaction.findOne({ externalId });
      if (existingTransaction) {
        console.log(`Ã¢Å¡Â Ã¯Â¸Â Duplicate transaction detected - externalId ${externalId}`);
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
    } else {
      const existingByKey = await Transaction.findOne({ dedupeKey });
      if (existingByKey) {
        console.log(`Ã¢Å¡Â Ã¯Â¸Â Duplicate transaction detected - dedupeKey ${dedupeKey}`);
        await applyCompletedTransactionEffects(existingByKey, mappedItems, isCompletedTransaction);
        await linkCompletedTransactionToTill({
          transaction: existingByKey,
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
          transactionId: existingByKey._id,
          duplicate: true
        });
      }
    }

    if (!externalId && createdAt && tillId) {
      const mongoose = require('mongoose');
      const existingTransaction = await Transaction.findOne({
        createdAt: new Date(createdAt),
        total: total,
        tillId: new mongoose.Types.ObjectId(tillId),
        location: normalizedLocation
      });
      
      if (existingTransaction) {
        console.log(`âš ï¸ Duplicate transaction detected - already exists as ${existingTransaction._id}`);
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

    // Create transaction record
    const transaction = new Transaction({
      ...(externalId && { externalId }),
      dedupeKey,
      ...(hasSingleTender && { tenderType }),
      ...(hasMultiplePayments && { tenderPayments }),
      
      amountPaid: amountPaid || total,
      total: total,
      subtotal: subtotal || total - tax,
      tax: tax,
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
      
      items: mappedItems,
      
      staff: staffId || null,
      staffName: finalStaffName, // Use normalized staff name
      location: normalizedLocation,
      ...(mongoose.Types.ObjectId.isValid(String(locationId || '')) && {
        locationId: new mongoose.Types.ObjectId(String(locationId)),
      }),
      device: device || 'web',
      status: normalizedStatus,
      
      ...(tableName && { tableName }),
      ...(customerName && { customerName }),
      ...(tillId && { tillId }),
      ...(sessionId && { sessionId }),
      
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      syncedAt: new Date(),
      source: 'direct-online-save', // Track that this came from direct send
    });

    // Save to database
    const savedTransaction = await transaction.save();
    
    console.log(`âœ… Transaction saved successfully - ID: ${savedTransaction._id}, Amount: ${total}`);

    if (isCompletedTransaction) {
      await applyCompletedTransactionEffects(savedTransaction, mappedItems, true);
      await linkCompletedTransactionToTill({
        transaction: savedTransaction,
        tillId,
        total,
        tenderType,
        tenderPayments,
        hasMultiplePayments,
        isCompletedTransaction,
      });
    } else if (tillId) {
      console.log(`â„¹ï¸ Skipping till totals update for non-completed transaction status: ${normalizedStatus}`);
    } else {
      console.warn(`âš ï¸ No tillId provided - transaction will not be linked to till`);
    }
    return res.status(200).json({
      success: true,
      transactionId: savedTransaction._id,
      message: 'Transaction saved successfully',
      transaction: {
        id: savedTransaction._id,
        total: savedTransaction.total,
        status: savedTransaction.status,
        createdAt: savedTransaction.createdAt,
      }
    });

  } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.externalId || error?.keyPattern?.dedupeKey)) {
      console.warn('âš ï¸ Duplicate transaction insert blocked by unique index:', error.keyValue?.externalId || error.keyValue?.dedupeKey);
      return res.status(200).json({
        success: true,
        message: 'Transaction already exists (duplicate prevented)',
        duplicate: true,
      });
    }
    console.error('âŒ Direct save error:', error);

    // Return 500 so client knows to fallback to offline queue
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to save transaction',
      message: 'Server error - transaction will be queued for sync',
      fallbackToQueue: true // Signal to client to queue this transaction
    });
  }
}




