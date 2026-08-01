import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import Customer from '@/src/models/Customer';
import Order from '@/src/models/Order';
import { Staff } from '@/src/models/Staff';
import { Transaction } from '@/src/models/Transactions';
import Till from '@/src/models/Till';
import Product from '@/src/models/Product';
import { sanitizeBody } from '@/src/lib/apiValidation';
import { updateInventoryForSale } from '@/src/lib/syncPackQty';
import { markRoomsFromTransaction } from '@/src/lib/roomAvailability';
import { ROOM_STATUSES } from '@/src/lib/roomReservations';
import { sendOrderDeliveredEmail, sendOrderProcessingEmail } from '@/src/lib/orderStatusEmail';

const ONLINE_TENDER_NAME = 'ONLINE';
const MANUAL_ENTRY_TENDER_NAME = 'MANUAL ENTRY';
const ONLINE_SALES_CHANNEL = 'ONLINE_STORE';
const VALID_FINAL_STATUSES = new Set(['Processing', 'Delivered']);

const ONLINE_PAYMENT_CHANNELS = new Set(['paystack', 'paystack-webhook', 'online']);

const normalizePaymentChannel = (value) => String(value || '').trim().toLowerCase();

const getRecordedTenderName = (order) =>
  ONLINE_PAYMENT_CHANNELS.has(normalizePaymentChannel(order?.paymentChannel))
    ? ONLINE_TENDER_NAME
    : MANUAL_ENTRY_TENDER_NAME;

const normalizeTenderName = (value) => String(value || MANUAL_ENTRY_TENDER_NAME).trim() || MANUAL_ENTRY_TENDER_NAME;

const isOrderConsideredPaid = (order) => Boolean(order?.paid || order?.paymentStatus === 'Paid');

const ensureTenderBreakdownMap = (value) =>
  value instanceof Map ? value : new Map(Object.entries(value || {}));

const applyTenderEntries = (map, entries = [], sign = 1) => {
  entries.forEach((entry) => {
    const key = normalizeTenderName(entry?.name);
    const current = Number(map.get(key) || 0);
    const next = Math.max(0, current + (sign * Number(entry?.amount || 0)));
    map.set(key, next);
  });
};

const getOrderContactDetails = (order) => {
  const shippingDetails = order?.shippingDetails || {};
  const customerSnapshot = order?.customerSnapshot || {};
  const customer = order?.customer || {};

  return {
    name: shippingDetails.name || customerSnapshot.name || customer.name || '',
    email: shippingDetails.email || customerSnapshot.email || customer.email || '',
    phone: shippingDetails.phone || customerSnapshot.phone || customer.phone || '',
    address: shippingDetails.address || customerSnapshot.address || customer.address || '',
    city: shippingDetails.city || customerSnapshot.city || customer.city || '',
  };
};

const hydrateOrderCustomer = async (order) => {
  if (!order) return null;

  const customerRef = order.customer;
  if (!customerRef) return order;

  if (typeof customerRef === 'object' && customerRef !== null && customerRef.email) {
    return order;
  }

  try {
    const customer = await Customer.findById(customerRef).lean();
    return {
      ...order,
      customer: customer || null,
    };
  } catch (error) {
    console.warn('Unable to hydrate order customer in complete-from-pos:', error?.message || error);
    return {
      ...order,
      customer: null,
    };
  }
};

const getOrderItems = (order) => {
  if (Array.isArray(order?.cartProducts) && order.cartProducts.length > 0) {
    return order.cartProducts;
  }
  return Array.isArray(order?.items) ? order.items : [];
};

const buildTransactionItems = (items = []) =>
  items
    .map((item) => ({
      productId: item.productId?._id || item.productId || item.id || null,
      name: item.name || 'Unnamed item',
      quantity: Number(item.quantity || item.qty || 0),
      qty: Number(item.quantity || item.qty || 0),
      price: Number(item.price || item.salePriceIncTax || 0),
      salePriceIncTax: Number(item.price || item.salePriceIncTax || 0),
      category: item.category || '',
      description: item.description || '',
      images: Array.isArray(item.images) ? item.images : [],
    }))
    .filter((item) => item.productId && item.quantity > 0);

const getTenderEntries = ({ tenderType, tenderPayments, total }) => {
  if (Array.isArray(tenderPayments) && tenderPayments.length > 0) {
    return tenderPayments.map((payment) => ({
      name: normalizeTenderName(payment?.tenderName),
      amount: Number(payment?.amount || 0),
    }));
  }

  return [{
    name: normalizeTenderName(tenderType),
    amount: Number(total || 0),
  }];
};

const normalizePaymentDetails = ({ order, paymentDetails }) => {
  const total = Number(order?.total || 0);
  const isAlreadyPaid = isOrderConsideredPaid(order);

  if (isAlreadyPaid) {
    const tenderName = getRecordedTenderName(order);
    return {
      tenderType: tenderName,
      tenderPayments: [
        {
          tenderId: null,
          tenderName,
          amount: total,
        },
      ],
      amountPaid: total,
      change: 0,
      paymentChannel: order?.paymentChannel || (tenderName === ONLINE_TENDER_NAME ? 'paystack' : 'manual-entry'),
    };
  }

  const tenderPayments = Array.isArray(paymentDetails?.tenderPayments)
    ? paymentDetails.tenderPayments
        .map((payment) => ({
          tenderId: payment?.tenderId || null,
          tenderName: normalizeTenderName(payment?.tenderName),
          amount: Number(payment?.amount || 0),
        }))
        .filter((payment) => payment.tenderName && payment.amount > 0)
    : [];

  const tenderLineTotal = tenderPayments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0);
  const amountPaidRaw = Number(paymentDetails?.amountPaid || 0);
  const amountPaid = amountPaidRaw > 0 ? amountPaidRaw : tenderLineTotal;

  return {
    tenderType: normalizeTenderName(paymentDetails?.tenderType || tenderPayments[0]?.tenderName),
    tenderPayments,
    amountPaid,
    change: Number(paymentDetails?.change || 0),
    paymentChannel: 'pos',
  };
};

const clearReservedInventory = async (items = []) => {
  for (const item of items) {
    const productId = item.productId?._id || item.productId || item.id;
    const quantity = Number(item.quantity || item.qty || 0);

    if (!productId || quantity <= 0) {
      continue;
    }

    try {
      await Product.updateOne(
        { _id: productId },
        [{
          $set: {
            reservedQuantity: {
              $max: [0, { $subtract: ['$reservedQuantity', quantity] }],
            },
          },
        }]
      );
    } catch (error) {
      console.warn('Failed to clear reserved quantity for product:', productId, error.message);
    }
  }
};

const formatTransactionResponse = (transaction) => ({
  id: transaction?._id?.toString?.() || transaction?._id || null,
  _id: transaction?._id?.toString?.() || transaction?._id || null,
  createdAt: transaction?.createdAt || new Date().toISOString(),
  items: transaction?.items || [],
  subtotal: Number(transaction?.subtotal || 0),
  tax: Number(transaction?.tax || 0),
  total: Number(transaction?.total || 0),
  discount: Number(transaction?.discount || 0),
  discountName: transaction?.discountName || transaction?.discountReason || '',
  shippingCost: Number(transaction?.shippingCost || transaction?.deliveryFee || 0),
  deliveryFee: Number(transaction?.deliveryFee || 0),
  deliveryFeeName: transaction?.deliveryFeeName || 'Delivery Fee',
  amountPaid: Number(transaction?.amountPaid || 0),
  change: Number(transaction?.change || 0),
  tenderType: transaction?.tenderType || null,
  tenderPayments: transaction?.tenderPayments || [],
  customerName: transaction?.customerName || '',
  staffName: transaction?.staffName || 'POS Staff',
  location: transaction?.location || '',
  status: transaction?.status || 'completed',
  salesChannel: transaction?.salesChannel || ONLINE_SALES_CHANNEL,
  sourceOrderId: transaction?.sourceOrderId || null,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  req.body = sanitizeBody(req.body);

  try {
    await mongooseConnect();

    const { id } = req.query;
    const {
      tillId,
      locationId,
      locationName,
      finalStatus,
      paymentDetails = {},
    } = req.body || {};

    const authenticatedStaffId = String(req.headers['x-auth-staff-id'] || '').trim();
    if (!authenticatedStaffId || !mongoose.Types.ObjectId.isValid(authenticatedStaffId)) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated staff session is required',
      });
    }

    const authenticatedStaff = await Staff.findById(authenticatedStaffId)
      .select('_id name')
      .lean();

    if (!authenticatedStaff) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated staff was not found',
      });
    }

    const authenticatedStaffName = String(authenticatedStaff.name || 'POS Staff').trim() || 'POS Staff';

    const requestedFinalStatus = VALID_FINAL_STATUSES.has(String(finalStatus || '').trim())
      ? String(finalStatus).trim()
      : 'Processing';

    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order id',
      });
    }

    if (!tillId || !mongoose.Types.ObjectId.isValid(String(tillId))) {
      return res.status(400).json({
        success: false,
        error: 'Valid tillId is required',
      });
    }

    const baseOrder = await Order.findById(id).lean();
    const order = await hydrateOrderCustomer(baseOrder);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }

    const till = await Till.findById(tillId);
    if (!till) {
      return res.status(404).json({
        success: false,
        error: 'Till not found',
      });
    }

    const orderItems = getOrderItems(order);
    if (orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Order has no items to process',
      });
    }

    const mappedItems = buildTransactionItems(orderItems);
    if (mappedItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Order items could not be mapped to POS products',
      });
    }

    const normalizedPayment = normalizePaymentDetails({ order, paymentDetails });
    const isAlreadyPaid = isOrderConsideredPaid(order);
    const needsInventoryUpdate = !order.inventoryFinalizedBy;
    if (!isAlreadyPaid) {
      const hasTender = Boolean(
        normalizedPayment.tenderType ||
        (Array.isArray(normalizedPayment.tenderPayments) && normalizedPayment.tenderPayments.length > 0)
      );

      const orderTotal = Number(order.total || 0);
      const meetsAmount = normalizedPayment.amountPaid + 0.0001 >= orderTotal;

      if (!hasTender || !meetsAmount) {
        return res.status(400).json({
          success: false,
          error: 'A complete POS payment is required before recording this sale',
        });
      }
    }

    const resolvedLocationName = String(locationName || order.locationName || till.locationName || '').trim() || 'Online';
    const resolvedLocationId = mongoose.Types.ObjectId.isValid(String(locationId || ''))
      ? new mongoose.Types.ObjectId(String(locationId))
      : (mongoose.Types.ObjectId.isValid(String(order.locationId || ''))
        ? new mongoose.Types.ObjectId(String(order.locationId))
        : null);

    const externalId = `order:${String(order._id)}`;
    let transaction = await Transaction.findOne({ externalId });
    const transactionExisted = Boolean(transaction);
    const wasAlreadyRecorded = transactionExisted && isAlreadyPaid;

    if (transaction && order.status === 'Delivered') {
      return res.status(200).json({
        success: true,
        alreadyProcessed: true,
        emailState: 'skipped',
        order,
        transaction: formatTransactionResponse(transaction),
      });
    }

    if (!transaction) {
      transaction = new Transaction({
        externalId,
        dedupeKey: externalId,
        tenderType: normalizedPayment.tenderType || null,
        tenderPayments: Array.isArray(normalizedPayment.tenderPayments) ? normalizedPayment.tenderPayments : [],
        amountPaid: normalizedPayment.amountPaid || Number(order.total || 0),
        subtotal: Number(order.subtotal || order.total || 0),
        tax: 0,
        total: Number(order.total || 0),
        change: normalizedPayment.change || 0,
        discount: Number(order.discount || order.discountAmount || 0),
        discountName: order.discountName || order.discountReason || '',
        shippingCost: Number(order.shippingCost || order.deliveryFee || 0),
        deliveryFeeName: order.deliveryFeeName || order.shippingName || 'Delivery Fee',
        staff: authenticatedStaff._id,
        staffName: authenticatedStaffName,
        location: resolvedLocationName,
        locationId: resolvedLocationId,
        device: 'POS',
        customerName: getOrderContactDetails(order)?.name || 'Online Customer',
        status: 'completed',
        items: mappedItems,
        transactionType: 'pos',
        tillId: new mongoose.Types.ObjectId(String(tillId)),
        createdAt: new Date(),
        inventoryUpdated: !needsInventoryUpdate,
        salesChannel: ONLINE_SALES_CHANNEL,
        sourceOrderId: String(order._id),
        sourceOrderType: 'online-order',
        sourceSiteKey: order.siteKey || 'store',
      });

      await transaction.save();
    }

    till.transactions = Array.isArray(till.transactions) ? till.transactions : [];

    if (!till.transactions.some((transactionId) => String(transactionId) === String(transaction._id))) {
      till.transactions.push(transaction._id);
      till.totalSales = Number(till.totalSales || 0) + Number(order.total || 0);
      till.transactionCount = till.transactions.length;
      till.tenderBreakdown = ensureTenderBreakdownMap(till.tenderBreakdown);
      applyTenderEntries(
        till.tenderBreakdown,
        getTenderEntries({
          tenderType: normalizedPayment.tenderType,
          tenderPayments: normalizedPayment.tenderPayments,
          total: order.total,
        }),
        1
      );
      till.markModified('tenderBreakdown');
      await till.save();
    }

    if (needsInventoryUpdate && transaction.inventoryUpdated !== true) {
      await updateInventoryForSale(mappedItems);
      await clearReservedInventory(orderItems);
      transaction.inventoryUpdated = true;
      await transaction.save();
    }

    try {
      await markRoomsFromTransaction(mappedItems, transaction, ROOM_STATUSES.RESERVED);
    } catch (error) {
      console.warn('Failed to update room occupancy for online POS order:', error.message);
    }

    const updatePayload = {
      status: requestedFinalStatus,
      paid: true,
      paymentStatus: 'Paid',
      paymentChannel: isAlreadyPaid ? (order.paymentChannel || 'paystack') : 'pos',
      completedByStaffId: String(authenticatedStaff._id),
      completedByStaffName: authenticatedStaffName,
      locationId: resolvedLocationId,
      locationName: resolvedLocationName,
      reservationStatus: 'finalized',
      reservationReleasedAt: order.reservationReleasedAt || new Date(),
      finalizedAt: order.finalizedAt || new Date(),
      inventoryFinalizedBy: order.inventoryFinalizedBy || 'pos',
    };

    if (!order.paymentReference) {
      updatePayload.paymentReference = String(transaction._id);
    }

    const updatedOrderRaw = await Order.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true, runValidators: true }
    ).lean();

    const updatedOrder = await hydrateOrderCustomer(updatedOrderRaw);

    const shouldSendProcessingEmail =
      requestedFinalStatus === 'Processing' &&
      order.status !== 'Processing' &&
      updatedOrder?.status === 'Processing';

    const shouldSendDeliveredEmail =
      requestedFinalStatus === 'Delivered' &&
      order.status !== 'Delivered' &&
      updatedOrder?.status === 'Delivered';

    const emailState = shouldSendDeliveredEmail
      ? await sendOrderDeliveredEmail(updatedOrder)
      : shouldSendProcessingEmail
      ? await sendOrderProcessingEmail(updatedOrder)
      : 'skipped';

    return res.status(200).json({
      success: true,
      alreadyProcessed: wasAlreadyRecorded,
      emailState,
      order: updatedOrder,
      transaction: formatTransactionResponse(transaction),
    });
  } catch (error) {
    console.error('Failed to complete online order from POS:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to complete online order from POS',
    });
  }
}