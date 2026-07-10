/**
 * API Endpoint: POST /api/transactions
 * 
 * Handles transaction syncing from offline clients
 * Receives individual offline transactions and stores them in the database
 */

import { mongooseConnect } from '@/src/lib/mongoose';
import { Transaction } from '@/src/models/Transactions';
import Customer from '@/src/models/Customer';
import Till from '@/src/models/Till';
import mongoose from 'mongoose';
import { updateInventoryForSale, reverseInventoryForRefund } from '@/src/lib/syncPackQty';
import crypto from 'crypto';
import { sanitizeBody } from '@/src/lib/apiValidation';
import { ROOM_STATUSES } from '@/src/lib/roomReservations';
import { markRoomsFromTransaction, releaseRoomsFromTransaction } from '@/src/lib/roomAvailability';

const normalizeLocationName = (location) => {
  if (typeof location === 'string' && location.trim()) return location.trim();
  if (location && typeof location === 'object') {
    if (typeof location.name === 'string' && location.name.trim()) return location.name.trim();
    if (typeof location.code === 'string' && location.code.trim()) return location.code.trim();
  }
  return 'Main Store';
};

const toItemQtyMap = (items = []) => {
  const map = new Map();
  for (const item of items) {
    const productId = String(item.productId || item.id || '');
    const qty = Number(item.qty || item.quantity || 0);
    if (!productId || !qty) continue;
    map.set(productId, (map.get(productId) || 0) + qty);
  }
  return map;
};

const getTenderEntries = ({ tenderType, tenderPayments, total }) => {
  if (Array.isArray(tenderPayments) && tenderPayments.length > 0) {
    return tenderPayments.map((payment) => ({
      name: payment?.tenderName || 'CASH',
      amount: Number(payment?.amount || 0),
    }));
  }
  return [{ name: tenderType || 'CASH', amount: Number(total || 0) }];
};

const applyTenderEntries = (till, entries = [], sign = 1) => {
  if (!(till.tenderBreakdown instanceof Map)) {
    till.tenderBreakdown = new Map(Object.entries(till.tenderBreakdown || {}));
  }
  entries.forEach((entry) => {
    const key = entry.name || 'CASH';
    const currentAmount = Number(till.tenderBreakdown.get(key) || 0);
    const next = Math.max(0, currentAmount + (sign * Number(entry.amount || 0)));
    till.tenderBreakdown.set(key, next);
  });
  till.markModified('tenderBreakdown');
};

const getCreditPaidTotal = (transaction = {}) => {
  const payments = Array.isArray(transaction.creditPayments) ? transaction.creditPayments : [];
  if (payments.length > 0) {
    return payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  }
  return Number(transaction.creditPaidAmount || 0);
};

const getCreditBalance = (transaction = {}) => {
  const total = Number(transaction.creditOriginalTotal || transaction.total || 0);
  return Math.max(0, total - getCreditPaidTotal(transaction));
};

const recalculateCustomerCreditBalance = async (customerId) => {
  if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) return;

  const openCredits = await Transaction.find({
    status: 'credit',
    creditCustomerId: new mongoose.Types.ObjectId(String(customerId)),
    creditStatus: { $nin: ['paid', 'written_off'] },
  }).select('creditBalance total creditOriginalTotal creditPaidAmount creditPayments');

  const creditBalance = openCredits.reduce((sum, transaction) => sum + getCreditBalance(transaction), 0);
  await Customer.findByIdAndUpdate(customerId, {
    type: 'CREDIT',
    isCreditCustomer: true,
    creditBalance,
    updatedAt: new Date(),
  });
};

export default async function handler(req, res) {
  // Support GET for health check and POST for creating transactions
  if (req.method === 'GET') {
    return res.status(200).json({ 
      success: true, 
      message: 'Transactions endpoint is ready' 
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  req.body = sanitizeBody(req.body);

  try {
    console.log('ðŸ“¤ Transaction received:', req.body);
    
    await mongooseConnect();

    const { 
      items, 
      total, 
      tax = 0, 
      subtotal = 0, 
      tenderType,           // Legacy: single tender
      tenderPayments,       // New: array of split payments [{tenderId, tenderName, amount}]
      amountPaid,
      change,
      staffName: rawStaffName = 'Unknown',
      staffId,
      discount = 0,
      location = 'Default Location',
      locationId,
      device,
      tableName,
      customerName,
      customerId,
      createdAt,
      status = 'completed',
      tillId, // Till session ID
      externalId,
      editTransactionId,
      subStatus,
      heldByStaffName,
      heldByStaffId,
      incrementAmount,
      promotionValueType,
      customerType,
      creditDueDate,
      creditNotes,
      salesChannel,
      sourceOrderId,
      sourceOrderType,
      sourceSiteKey,
    } = req.body;
    
    // Normalize staff name and location for legacy/offline payloads
    const staffName = rawStaffName && rawStaffName !== 'Unknown' ? rawStaffName : 'POS Staff';
    const normalizedLocation = normalizeLocationName(location);
    
    // Determine which payment method is being used
    const hasMultiplePayments = tenderPayments && Array.isArray(tenderPayments) && tenderPayments.length > 0;
    const hasSingleTender = tenderType && !hasMultiplePayments;
    const rawStatus = String(status || 'completed').trim().toLowerCase();
    const requestedNormalizedStatus = rawStatus === 'complete' ? 'completed' : rawStatus;
    const normalizedStatus = ['completed', 'held', 'refunded', 'credit'].includes(requestedNormalizedStatus)
      ? requestedNormalizedStatus
      : 'completed';
    const isHeldTransaction = normalizedStatus === 'held'; // Held transactions don't require payment info
    const isCompletedTransaction = normalizedStatus === 'completed';
    const isCreditTransaction = normalizedStatus === 'credit';
    const isStockAffectingTransaction = isCompletedTransaction || isCreditTransaction;
    
    console.log(`ðŸ“¦ Processing transaction - till: ${tillId}, amount: ${total}, status: ${status}`);
    if (hasMultiplePayments) {
      console.log(`   Multiple payments: ${tenderPayments.map(tp => `${tp.tenderName}:${tp.amount}`).join(', ')}`);
    } else if (hasSingleTender) {
      console.log(`   Single tender: ${tenderType}`);
    } else if (isHeldTransaction) {
      console.log(`   Held transaction - no payment yet`);
    }

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error('âŒ Invalid transaction: items array required');
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction: items array required',
      });
    }

    // For held transactions, payment info is not required. For other statuses, it is.
    if (total === undefined || (!isHeldTransaction && !isCreditTransaction && !hasSingleTender && !hasMultiplePayments)) {
      console.error('âŒ Invalid transaction: total and (tenderType or tenderPayments) required');
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction: total and (tenderType or tenderPayments) required',
      });
    }

    // EDIT FLOW: update existing transaction (recall to cart) instead of creating a new one
    if (editTransactionId) {
      const existingTransaction = mongoose.Types.ObjectId.isValid(editTransactionId)
        ? await Transaction.findById(editTransactionId)
        : await Transaction.findOne({ externalId: String(editTransactionId) });
      if (!existingTransaction) {
        return res.status(404).json({
          success: false,
          message: 'Original transaction not found for edit',
        });
      }

      const mappedItems = items.map(item => ({
        ...item,
        productId: item.productId || item.id,
        name: item.name,
        salePriceIncTax: item.price || item.salePriceIncTax || 0,
        qty: item.quantity || item.qty || 0,
      }));

      const oldWasCompleted = existingTransaction.status === 'completed';
      const oldAffectedStock = existingTransaction.status === 'completed' || existingTransaction.status === 'credit';
      const newIsCompleted = normalizedStatus === 'completed';
      const newAffectsStock = normalizedStatus === 'completed' || normalizedStatus === 'credit';
      const previousRoomItems = existingTransaction.items || [];

      if (existingTransaction.inventoryUpdated && oldAffectedStock) {
        await reverseInventoryForRefund(existingTransaction.items || []);
      }

      const oldTillId = existingTransaction.tillId ? String(existingTransaction.tillId) : null;
      const newTillId = tillId ? String(tillId) : oldTillId;
      const oldTotal = Number(existingTransaction.total || 0);
      const newTotal = Number(total || 0);
      const oldTenderEntries = getTenderEntries({
        tenderType: existingTransaction.tenderType,
        tenderPayments: existingTransaction.tenderPayments,
        total: oldTotal,
      });
      const newTenderEntries = getTenderEntries({
        tenderType: hasSingleTender ? tenderType : null,
        tenderPayments: hasMultiplePayments ? tenderPayments : [],
        total: newTotal,
      });

      if (oldTillId) {
        const oldTill = await Till.findById(oldTillId);
        if (oldTill) {
          if (oldWasCompleted && (!newIsCompleted || oldTillId !== newTillId)) {
            oldTill.transactions = (oldTill.transactions || []).filter(
              (txId) => String(txId) !== String(existingTransaction._id)
            );
            oldTill.totalSales = Math.max(0, Number(oldTill.totalSales || 0) - oldTotal);
            applyTenderEntries(oldTill, oldTenderEntries, -1);
          } else if (oldWasCompleted && newIsCompleted && oldTillId === newTillId) {
            oldTill.totalSales = Math.max(0, Number(oldTill.totalSales || 0) + (newTotal - oldTotal));
            applyTenderEntries(oldTill, oldTenderEntries, -1);
            applyTenderEntries(oldTill, newTenderEntries, 1);
          }
          oldTill.transactionCount = (oldTill.transactions || []).length;
          await oldTill.save();
        }
      }

      if (newTillId && newTillId !== oldTillId && newIsCompleted) {
        const newTill = await Till.findById(newTillId);
        if (newTill) {
          if (!(newTill.transactions || []).some((txId) => String(txId) === String(existingTransaction._id))) {
            newTill.transactions.push(existingTransaction._id);
          }
          newTill.totalSales = Number(newTill.totalSales || 0) + newTotal;
          applyTenderEntries(newTill, newTenderEntries, 1);
          newTill.transactionCount = (newTill.transactions || []).length;
          await newTill.save();
        }
      }

      existingTransaction.items = mappedItems;
      existingTransaction.total = newTotal;
      existingTransaction.subtotal = subtotal || (newTotal - Number(tax || 0));
      existingTransaction.tax = Number(tax || 0);
      existingTransaction.discount = Number(discount || 0);
      existingTransaction.amountPaid = amountPaid || newTotal;
      existingTransaction.change = Number(change || 0);
      existingTransaction.staff = staffId || existingTransaction.staff || null;
      existingTransaction.staffName = staffName || existingTransaction.staffName || 'POS Staff';
      existingTransaction.location = normalizedLocation;
      existingTransaction.locationId = mongoose.Types.ObjectId.isValid(String(locationId || ''))
        ? new mongoose.Types.ObjectId(String(locationId))
        : existingTransaction.locationId || null;
      existingTransaction.device = device || existingTransaction.device;
      existingTransaction.tableName = tableName || existingTransaction.tableName;
      existingTransaction.customerName = customerName || existingTransaction.customerName;
      existingTransaction.customerId = mongoose.Types.ObjectId.isValid(String(customerId || ''))
        ? new mongoose.Types.ObjectId(String(customerId))
        : existingTransaction.customerId || null;
      existingTransaction.status = normalizedStatus;
      existingTransaction.creditStatus = isCreditTransaction
        ? existingTransaction.creditStatus === 'paid' ? 'paid' : 'open'
        : existingTransaction.creditStatus || 'none';
      existingTransaction.creditCustomerId = mongoose.Types.ObjectId.isValid(String(customerId || ''))
        ? new mongoose.Types.ObjectId(String(customerId))
        : existingTransaction.creditCustomerId || null;
      existingTransaction.creditCustomerName = customerName || existingTransaction.creditCustomerName || '';
      existingTransaction.creditOriginalTotal = isCreditTransaction ? newTotal : existingTransaction.creditOriginalTotal || 0;
      existingTransaction.creditPaidAmount = isCreditTransaction ? Number(amountPaid || 0) : existingTransaction.creditPaidAmount || 0;
      existingTransaction.creditBalance = isCreditTransaction ? Math.max(0, newTotal - Number(amountPaid || 0)) : existingTransaction.creditBalance || 0;
      existingTransaction.creditDueDate = creditDueDate ? new Date(creditDueDate) : existingTransaction.creditDueDate || null;
      existingTransaction.creditNotes = creditNotes || existingTransaction.creditNotes || '';
      existingTransaction.subStatus = subStatus || 'edited';
      existingTransaction.tillId = newTillId ? new mongoose.Types.ObjectId(newTillId) : existingTransaction.tillId;
      existingTransaction.incrementAmount = Number(incrementAmount || 0);
      existingTransaction.promotionValueType = promotionValueType || null;
      existingTransaction.customerType = customerType || null;
      existingTransaction.salesChannel = salesChannel || existingTransaction.salesChannel || 'POS';
      existingTransaction.sourceOrderId = sourceOrderId || existingTransaction.sourceOrderId || '';
      existingTransaction.sourceOrderType = sourceOrderType || existingTransaction.sourceOrderType || '';
      existingTransaction.sourceSiteKey = sourceSiteKey || existingTransaction.sourceSiteKey || '';
      existingTransaction.updatedAt = new Date();
      // Preserve held-by info (keep original if not provided)
      if (heldByStaffName) existingTransaction.heldByStaffName = heldByStaffName;
      if (heldByStaffId) existingTransaction.heldByStaffId = heldByStaffId;
      existingTransaction.inventoryUpdated = false;

      if (hasMultiplePayments) {
        existingTransaction.tenderPayments = tenderPayments;
        existingTransaction.tenderType = null;
      } else {
        existingTransaction.tenderType = tenderType || null;
        existingTransaction.tenderPayments = [];
      }

      await existingTransaction.save();

      if (oldWasCompleted) {
        try {
          await releaseRoomsFromTransaction(previousRoomItems, existingTransaction);
        } catch (roomReleaseErr) {
          console.warn('⚠️ Failed to release existing room booking state:', roomReleaseErr.message);
        }
      }

      if (newAffectsStock) {
        await updateInventoryForSale(mappedItems);
        existingTransaction.inventoryUpdated = true;
        await existingTransaction.save();

        if (newIsCompleted) {
          try {
            await markRoomsFromTransaction(mappedItems, existingTransaction, ROOM_STATUSES.RESERVED);
          } catch (roomOccupancyErr) {
            console.warn('⚠️ Failed to update room occupancy for edited transaction:', roomOccupancyErr.message);
          }
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Transaction edited successfully',
        edited: true,
        transactionId: existingTransaction._id,
        transaction: {
          id: existingTransaction._id,
          status: existingTransaction.status,
          subStatus: existingTransaction.subStatus,
          total: existingTransaction.total,
        },
      });
    }

    // Map items to schema format (qty, salePriceIncTax) before duplicate checks so missed inventory retries can reuse them.
    const mappedItems = items.map(item => ({
      ...item,
      productId: item.productId || item.id,
      name: item.name,
      salePriceIncTax: item.price || item.salePriceIncTax || 0,
      qty: item.quantity || item.qty || 0,
    }));

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

    // DUPLICATE PREVENTION: Check if this transaction already exists
    if (externalId) {
      const existingTransaction = await Transaction.findOne({ externalId });
      if (existingTransaction) {
        console.log(`⚠️ Duplicate transaction detected - externalId ${externalId}`);
        // Retry inventory update if it was missed on original save
        if (!existingTransaction.inventoryUpdated && (existingTransaction.status === 'completed' || existingTransaction.status === 'credit')) {
          try {
            await updateInventoryForSale(mappedItems);
            existingTransaction.inventoryUpdated = true;
            await existingTransaction.save();
            console.log('✅ Retried inventory update on duplicate detection');
          } catch (retryErr) {
            console.warn('⚠️ Retry inventory update failed:', retryErr.message);
          }
        }
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
        console.log(`⚠️ Duplicate transaction detected - dedupeKey ${dedupeKey}`);
        // Retry inventory update if it was missed on original save
        if (!existingByKey.inventoryUpdated && (existingByKey.status === 'completed' || existingByKey.status === 'credit')) {
          try {
            await updateInventoryForSale(mappedItems);
            existingByKey.inventoryUpdated = true;
            await existingByKey.save();
            console.log('✅ Retried inventory update on duplicate detection');
          } catch (retryErr) {
            console.warn('⚠️ Retry inventory update failed:', retryErr.message);
          }
        }
        return res.status(200).json({
          success: true,
          message: 'Transaction already exists (duplicate prevented)',
          transactionId: existingByKey._id,
          duplicate: true
        });
      }
    }

    if (!externalId && createdAt && tillId) {
      const existingTransaction = await Transaction.findOne({
        createdAt: new Date(createdAt),
        total: total,
        tillId: new mongoose.Types.ObjectId(tillId),
        location: normalizedLocation
      });
      
      if (existingTransaction) {
        console.log(`âš ï¸ Duplicate transaction detected - already exists as ${existingTransaction._id}`);
        return res.status(200).json({
          success: true,
          message: 'Transaction already exists (duplicate prevented)',
          transactionId: existingTransaction._id,
          duplicate: true
        });
      }
    }

    // Create transaction record in database
    const transaction = new Transaction({
      ...(externalId && { externalId }),
      dedupeKey,
      // Payment method: can be single (legacy) or multiple (split)
      ...(hasSingleTender && { tenderType }),
      ...(hasMultiplePayments && { tenderPayments }),
      
      amountPaid: amountPaid || total,
      subtotal: subtotal || total - tax,
      tax: tax || 0,
      total: total,
      staff: staffId || null,
      staffName: staffName || 'Unknown', // Store staff name for quick lookup
      location: normalizedLocation,
      ...(mongoose.Types.ObjectId.isValid(String(locationId || '')) && {
        locationId: new mongoose.Types.ObjectId(String(locationId)),
      }),
      device: device,
      tableName: tableName,
      discount: discount || 0,
      customerId: mongoose.Types.ObjectId.isValid(String(customerId || ''))
        ? new mongoose.Types.ObjectId(String(customerId))
        : null,
      customerName: customerName,
      creditStatus: isCreditTransaction ? 'open' : 'none',
      creditCustomerId: mongoose.Types.ObjectId.isValid(String(customerId || ''))
        ? new mongoose.Types.ObjectId(String(customerId))
        : null,
      creditCustomerName: customerName || '',
      creditOriginalTotal: isCreditTransaction ? Number(total || 0) : 0,
      creditPaidAmount: isCreditTransaction ? Number(amountPaid || 0) : 0,
      creditBalance: isCreditTransaction ? Math.max(0, Number(total || 0) - Number(amountPaid || 0)) : 0,
      creditDueDate: creditDueDate ? new Date(creditDueDate) : null,
      creditNotes: creditNotes || '',
      status: normalizedStatus,
      subStatus: subStatus || null,
      change: change || 0,
      items: mappedItems,
      transactionType: 'pos',
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      tillId: tillId ? new mongoose.Types.ObjectId(tillId) : null,
      ...(heldByStaffName && { heldByStaffName }),
      ...(heldByStaffId && { heldByStaffId }),
      ...(incrementAmount && { incrementAmount }),
      ...(promotionValueType && { promotionValueType }),
      ...(customerType && { customerType }),
      ...(salesChannel && { salesChannel }),
      ...(sourceOrderId && { sourceOrderId }),
      ...(sourceOrderType && { sourceOrderType }),
      ...(sourceSiteKey && { sourceSiteKey }),
    });

    // Save to database
    const savedTransaction = await transaction.save();
    
    console.log('âœ… Transaction saved:', savedTransaction._id);

    // Link transaction to till only for completed sales
    if (tillId && isCompletedTransaction) {
      try {
        console.log(`ðŸ” Looking for till: ${tillId}`);
        const till = await Till.findById(tillId);
        
        if (till) {
          console.log(`ðŸ’³ Found till! Linking transaction ${savedTransaction._id} to till ${tillId}`);
          console.log(`   Till Status: ${till.status}`);
          console.log(`   Till Current Sales: ${till.totalSales}`);
          console.log(`   Transaction amount: ${total}`);
          
          if (!till.transactions.some((txId) => String(txId) === String(savedTransaction._id))) {
            till.transactions.push(savedTransaction._id);
          }
          till.totalSales = (till.totalSales || 0) + Number(total || 0);
          // DO NOT manually increment transactionCount - it should always equal transactions.length
          till.transactionCount = till.transactions.length;
          
          // Ensure tenderBreakdown is initialized
          if (!(till.tenderBreakdown instanceof Map)) {
            console.log(`   Initializing tenderBreakdown as Map`);
            till.tenderBreakdown = new Map(Object.entries(till.tenderBreakdown || {}));
          }
          
          // Update tender breakdown based on payment method
          if (hasMultiplePayments) {
            // Handle split payments - add amount to each tender
            console.log(`   Processing ${tenderPayments.length} split payments:`);
            tenderPayments.forEach(payment => {
              const currentAmount = till.tenderBreakdown.get(payment.tenderName) || 0;
              console.log(`      ${payment.tenderName}: +${payment.amount} (was ${currentAmount})`);
              till.tenderBreakdown.set(payment.tenderName, currentAmount + Number(payment.amount || 0));
            });
          } else {
            // Handle single tender (legacy)
            const tenderKey = tenderType || 'CASH';
            const currentAmount = till.tenderBreakdown.get(tenderKey) || 0;
            console.log(`   Setting ${tenderKey} from ${currentAmount} to ${currentAmount + Number(total || 0)}`);
            till.tenderBreakdown.set(tenderKey, currentAmount + Number(total || 0));
          }
          
          // Mark the field as modified so Mongoose knows to save it
          till.markModified('tenderBreakdown');
          
          const savedTill = await till.save();
          console.log(`   âœ… Till saved successfully!`);
          console.log(`   âœ… Till updated - Total sales now: ${savedTill.totalSales}`);
        } else {
          console.warn(`âš ï¸ Till ${tillId} not found in database!`);
        }
      } catch (tillErr) {
        console.warn('âš ï¸ Failed to link transaction to till:', tillErr.message);
        console.error('   Error details:', tillErr);
        // Don't fail the transaction if till link fails
      }
    } else if (tillId && !isCompletedTransaction) {
      console.log(`â„¹ï¸ Skipping till totals update for non-completed transaction status: ${normalizedStatus}`);
    } else {
      console.log('â„¹ï¸ No till ID provided, transaction not linked to any till');
    }
    // Update product quantities after successful transaction save (idempotent)
    if (!savedTransaction.inventoryUpdated && isStockAffectingTransaction) {
      try {
        console.log('📦 Updating inventory for items:', JSON.stringify(mappedItems.map(i => ({ productId: i.productId, qty: i.qty, name: i.name }))));
        await updateInventoryForSale(mappedItems);
        savedTransaction.inventoryUpdated = true;
        await savedTransaction.save();
        console.log('✅ Inventory updated successfully');
      } catch (updateErr) {
        console.error('❌ Failed to update product quantities:', updateErr.message, updateErr.stack);
      }

      if (isCompletedTransaction) {
        try {
          await markRoomsFromTransaction(mappedItems, savedTransaction, ROOM_STATUSES.RESERVED);
        } catch (roomOccupancyErr) {
          console.warn('⚠️ Failed to update room occupancy:', roomOccupancyErr.message);
        }
      }
    }

    if (isCreditTransaction && savedTransaction.creditCustomerId) {
      await recalculateCustomerCreditBalance(savedTransaction.creditCustomerId);
    }

    return res.status(201).json({
      success: true,
      message: 'Transaction saved successfully',
      data: {
        id: savedTransaction._id,
        total: savedTransaction.total
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
    console.error('âŒ Error saving transaction:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to save transaction',
      message: error.message
    });
  }
}




