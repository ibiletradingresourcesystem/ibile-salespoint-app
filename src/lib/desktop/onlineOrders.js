/**
 * Desktop only: a web-shop order completed at this till is recorded in the cloud database (by the
 * existing complete-from-pos logic over the direct connection). This keeps a copy of that sale on
 * the till so Close Till and sales history include it. Stock was already reduced in the cloud and
 * arrives with the next product pull.
 */

import { Transaction } from '@/src/models/Transactions';
import SyncOutbox from '@/src/models/SyncOutbox';
import { linkCompletedTransactionToTill } from '@/src/lib/transactionEffects';
import { toObjectId } from '@/src/lib/sync/ejson';

export async function mirrorOnlineOrderSale(req, sale) {
  const saleId = toObjectId(sale?._id || sale?.id);
  const tillId = toObjectId(req.body?.tillId);
  if (!saleId || !tillId) return;

  const collection = Transaction.collection;
  if (await collection.findOne({ _id: saleId }, { projection: { _id: 1 } })) return;

  const orderId = String(req.query.id);
  const tenderPayments = (Array.isArray(sale.tenderPayments) ? sale.tenderPayments : []).map((payment) => ({
    tenderId: toObjectId(payment.tenderId),
    tenderName: payment.tenderName,
    amount: Number(payment.amount || 0),
  }));

  try {
    await collection.insertOne({
      _id: saleId,
      externalId: `order:${orderId}`,
      dedupeKey: `order:${orderId}`,
      items: (sale.items || []).map((item) => ({ ...item, productId: toObjectId(item.productId) || item.productId })),
      subtotal: Number(sale.subtotal || 0),
      tax: Number(sale.tax || 0),
      total: Number(sale.total || 0),
      discount: Number(sale.discount || 0),
      discountName: sale.discountName || '',
      shippingCost: Number(sale.shippingCost || 0),
      deliveryFee: Number(sale.deliveryFee || 0),
      deliveryFeeName: sale.deliveryFeeName || '',
      amountPaid: Number(sale.amountPaid || 0),
      change: Number(sale.change || 0),
      tenderType: sale.tenderType || null,
      tenderPayments,
      customerName: sale.customerName || '',
      staff: toObjectId(req.headers['x-auth-staff-id']),
      staffName: sale.staffName || 'POS Staff',
      location: sale.location || req.body?.locationName || '',
      locationId: toObjectId(req.body?.locationId),
      status: sale.status || 'completed',
      salesChannel: sale.salesChannel || 'ONLINE_STORE',
      sourceOrderId: orderId,
      sourceOrderType: 'online-order',
      transactionType: 'pos',
      device: 'POS',
      tillId,
      inventoryUpdated: true,
      inventoryRestockedAt: null,
      createdAt: sale.createdAt ? new Date(sale.createdAt) : new Date(),
      updatedAt: new Date(),
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return;
  }

  // Already in the cloud: mark as sent so the safety sweep does not queue it again
  await SyncOutbox.collection.insertOne({
    entity: 'transactions',
    entityId: String(saleId),
    operation: 'upsert',
    status: 'synced',
    priority: 30,
    rev: 0,
    fields: [],
    attempts: 0,
    syncedAt: new Date(),
    cloudId: String(saleId),
    error: 'Created in the cloud (online order)',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await linkCompletedTransactionToTill({
    transaction: { _id: saleId },
    tillId,
    total: Number(sale.total || 0),
    tenderType: sale.tenderType,
    tenderPayments,
    hasMultiplePayments: tenderPayments.length > 0,
    isCompletedTransaction: true,
  });
}
