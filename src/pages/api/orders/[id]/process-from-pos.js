import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import Customer from '@/src/models/Customer';
import Order from '@/src/models/Order';
import { sanitizeBody } from '@/src/lib/apiValidation';
import { sendOrderProcessingEmail } from '@/src/lib/orderStatusEmail';

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
    console.warn('Unable to hydrate order customer in process-from-pos:', error?.message || error);
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
    await mongooseConnect();

    const { id } = req.query;
    const { locationId, locationName } = req.body || {};

    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, error: 'Invalid order id' });
    }

    const baseOrder = await Order.findById(id).lean();
    const order = await hydrateOrderCustomer(baseOrder);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (order.status === 'Delivered') {
      return res.status(400).json({ success: false, error: 'Delivered orders cannot be processed again' });
    }

    const normalizedLocationName = String(locationName || order.locationName || '').trim();
    const resolvedLocationId = mongoose.Types.ObjectId.isValid(String(locationId || ''))
      ? new mongoose.Types.ObjectId(String(locationId))
      : order.locationId || null;

    const updatePayload = {
      locationId: resolvedLocationId,
      locationName: normalizedLocationName,
    };

    const shouldSendProcessingEmail = order.status !== 'Processing';
    if (shouldSendProcessingEmail) {
      updatePayload.status = 'Processing';
    }

    const updatedOrderRaw = await Order.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true, runValidators: true }
    ).lean();

    const updatedOrder = await hydrateOrderCustomer(updatedOrderRaw);

    const emailState = shouldSendProcessingEmail
      ? await sendOrderProcessingEmail(updatedOrder)
      : 'skipped';

    return res.status(200).json({
      success: true,
      alreadyProcessing: !shouldSendProcessingEmail,
      emailState,
      order: updatedOrder,
    });
  } catch (error) {
    console.error('Failed to move order into POS processing:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to move order into POS processing',
    });
  }
}