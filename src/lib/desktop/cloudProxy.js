/**
 * Desktop only: cloud-only POS features (web shop orders, petty cash, support email).
 *
 * These workflows are shared with the management app and payment providers, so they stay in the
 * cloud. When the internet is available the local server forwards them to the cloud deployment
 * using the staff member's own cloud session, captured when they logged in at this till. The cloud
 * therefore applies exactly the same authentication and permissions as for web terminals.
 */

import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import { Transaction } from '@/src/models/Transactions';
import SyncOutbox from '@/src/models/SyncOutbox';
import { linkCompletedTransactionToTill } from '@/src/lib/transactionEffects';
import { getDesktopConfig, isDesktopServer } from '@/src/lib/runtime';
import { toObjectId } from '@/src/lib/sync/ejson';
import { flushRecord } from '@/src/lib/desktop/syncEngine';

const OFFLINE_MESSAGE = 'This feature needs an internet connection. Sales and tills keep working offline.';
const SESSION_MESSAGE = 'Log out and log in again while connected to the internet to use this feature.';

const sessions = () => mongoose.connection.collection('desktop_cloud_sessions');

const unavailable = (res, code, message) =>
  res.status(503).json({ success: false, code, error: message, message });

function readSessionCookie(headers) {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const match = /(?:^|[\s,])pos-session=([^;]+)/.exec(value);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Signs the staff member in to the cloud with the passcode they just used locally. */
export async function captureCloudSession({ staffId, pin, location }) {
  const { cloudUrl } = getDesktopConfig();
  if (!isDesktopServer() || !cloudUrl || !staffId) return false;

  try {
    const response = await fetch(`${cloudUrl}/api/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId, pin, location }),
      signal: AbortSignal.timeout(8000),
    });

    await mongooseConnect();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) await sessions().deleteOne({ _id: staffId });
      return false;
    }

    const cookie = readSessionCookie(response.headers);
    if (!cookie) return false;
    await sessions().updateOne(
      { _id: staffId },
      { $set: { cookie, capturedAt: new Date() } },
      { upsert: true }
    );
    return true;
  } catch {
    return false;
  }
}

export async function proxyToCloud(req, res, { onSuccess } = {}) {
  const { cloudUrl } = getDesktopConfig();
  if (!cloudUrl) return unavailable(res, 'CLOUD_NOT_CONFIGURED', OFFLINE_MESSAGE);

  const staffId = String(req.headers['x-auth-staff-id'] || '');
  await mongooseConnect();
  const session = staffId ? await sessions().findOne({ _id: staffId }) : null;
  if (!session?.cookie) return unavailable(res, 'CLOUD_SESSION_REQUIRED', SESSION_MESSAGE);

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let response;
  try {
    response = await fetch(`${cloudUrl}${req.url}`, {
      method: req.method,
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        Cookie: `pos-session=${session.cookie}`,
      },
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return unavailable(res, 'CLOUD_UNAVAILABLE', OFFLINE_MESSAGE);
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { success: false, error: 'Unexpected response from the cloud', message: 'Unexpected response from the cloud' };
  }

  if (response.status === 401) {
    await sessions().deleteOne({ _id: staffId });
    return unavailable(res, 'CLOUD_SESSION_REQUIRED', SESSION_MESSAGE);
  }

  if (response.ok && onSuccess) {
    try {
      await onSuccess(data);
    } catch (error) {
      console.error('[desktop] Cloud action succeeded but the local copy could not be updated:', error);
    }
  }

  return res.status(response.status).json(data);
}

/**
 * Records the cloud-created online-order sale on this till too, so Close Till and sales history
 * include it. Stock was already reduced in the cloud and arrives with the next product pull.
 */
async function mirrorOnlineOrderSale(req, data) {
  const sale = data?.transaction;
  const saleId = toObjectId(sale?._id || sale?.id);
  const tillId = toObjectId(req.body?.tillId);
  if (!saleId || !tillId) return;

  const collection = Transaction.collection;
  if (await collection.findOne({ _id: saleId }, { projection: { _id: 1 } })) return;

  const orderId = String(req.query.id);
  const tenderPayments = (Array.isArray(sale.tenderPayments) ? sale.tenderPayments : []).map((payment) => ({
    ...payment,
    tenderId: toObjectId(payment.tenderId),
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

export async function completeOnlineOrderThroughCloud(req, res) {
  // The cloud records the sale against this till, so the till must be in the cloud first
  const flushed = await flushRecord('tills', req.body?.tillId);
  if (!flushed.ok) {
    return unavailable(
      res,
      'TILL_NOT_SYNCED',
      'This till has not reached the cloud yet. Check the internet connection and try again.'
    );
  }
  return proxyToCloud(req, res, { onSuccess: (data) => mirrorOnlineOrderSale(req, data) });
}
