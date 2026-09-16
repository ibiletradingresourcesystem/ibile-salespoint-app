import mongoose from 'mongoose';
import { cloudDataModels } from '@/src/lib/dataModels';
import { sanitizeBody } from '@/src/lib/apiValidation';
import { sendOrderDeliveredEmail } from '@/src/lib/orderStatusEmail';

const hydrateOrderCustomer = async (order, Customer) => {
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
    console.warn('Unable to hydrate order customer in mark-delivered:', error?.message || error);
    return {
      ...order,
      customer: null,
    };
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  req.body = sanitizeBody(req.body);

  try {
    const { Order, Customer, Transaction } = await cloudDataModels();

    const { id } = req.query;
    const { locationId, locationName } = req.body || {};

    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, error: 'Invalid order id' });
    }

    const baseOrder = await Order.findById(id).lean();
    const order = await hydrateOrderCustomer(baseOrder, Customer);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (order.status === 'Delivered') {
      return res.status(200).json({
        success: true,
        alreadyDelivered: true,
        emailState: 'skipped',
        order,
      });
    }

    const externalId = `order:${String(order._id)}`;
    const transaction = await Transaction.findOne({
      $or: [
        { externalId },
        { sourceOrderId: String(order._id) },
      ],
    }).lean();

    // Delivery needs the sale to exist: recorded at a till, or the order already processed in the
    // management app (status moved past Pending there)
    const processedElsewhere = ['Processing', 'Shipped'].includes(order.status);
    if (!transaction && !processedElsewhere) {
      return res.status(400).json({
        success: false,
        error: 'Process the order first: record the sale in the POS, or process it in the management app',
      });
    }

    const normalizedLocationName = String(locationName || order.locationName || transaction?.location || '').trim();
    const resolvedLocationId = mongoose.Types.ObjectId.isValid(String(locationId || ''))
      ? new mongoose.Types.ObjectId(String(locationId))
      : order.locationId || null;
    const completedByStaffId = String(
      transaction?.staff?._id || transaction?.staff || order.completedByStaffId || ''
    ).trim();
    const completedByStaffName = String(
      transaction?.staff?.name || transaction?.staffName || order.completedByStaffName || 'POS Staff'
    ).trim();

    const updatedOrderRaw = await Order.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'Delivered',
          locationId: resolvedLocationId,
          locationName: normalizedLocationName,
          completedByStaffId,
          completedByStaffName,
          paid: Boolean(order.paid || order.paymentStatus === 'Paid'),
          paymentStatus: order.paymentStatus || 'Paid',
          reservationStatus: 'finalized',
          reservationReleasedAt: order.reservationReleasedAt || new Date(),
          finalizedAt: order.finalizedAt || new Date(),
          inventoryFinalizedBy: order.inventoryFinalizedBy || 'pos',
        },
      },
      { new: true, runValidators: true }
    ).lean();

    if (transaction) {
      await Transaction.findOneAndUpdate(
        {
          $or: [
            { externalId },
            { sourceOrderId: String(order._id) },
          ],
        },
        {
          $set: {
            location: normalizedLocationName || transaction.location || 'online',
            locationId: resolvedLocationId || transaction.locationId || null,
          },
        }
      );
    }

    const updatedOrder = await hydrateOrderCustomer(updatedOrderRaw, Customer);

    const emailState = await sendOrderDeliveredEmail(updatedOrder);

    return res.status(200).json({
      success: true,
      emailState,
      order: updatedOrder,
    });
  } catch (error) {
    console.error('Failed to mark order delivered from POS:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to mark order delivered from POS',
    });
  }
}