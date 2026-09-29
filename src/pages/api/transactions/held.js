/**
 * API Endpoint: GET /api/transactions/held
 *
 * Held sales for a location, from the database.
 *
 * The Held tab used to show only the carts held in this browser's own storage, so a hold made
 * before a restart, on another till, or after the browser's data was cleared disappeared from the
 * POS while the management app still listed it. Holds are saved as transactions with status
 * "held", so they are read back from here and shown alongside the local ones.
 */

import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import { Transaction } from '@/src/models/Transactions';

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await mongooseConnect();

    const { location, locationId, limit = 100 } = req.query;
    const filters = { status: { $in: ['held', 'HELD', 'Held'] } };

    const locationClauses = [];
    if (locationId && mongoose.Types.ObjectId.isValid(String(locationId))) {
      locationClauses.push({ locationId: new mongoose.Types.ObjectId(String(locationId)) });
    }
    if (location) {
      locationClauses.push({ location: { $regex: `^${escapeRegex(location)}$`, $options: 'i' } });
    }
    if (locationClauses.length === 1) Object.assign(filters, locationClauses[0]);
    else if (locationClauses.length > 1) filters.$or = locationClauses;

    const transactions = await Transaction.find(filters)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 200))
      .lean();

    const data = transactions.map((tx) => ({
      id: tx._id?.toString() || tx.id,
      externalId: tx.externalId || tx.clientId || null,
      createdAt: tx.createdAt,
      total: tx.total || 0,
      subtotal: tx.subtotal || 0,
      tax: tx.tax || 0,
      discount: tx.discount || 0,
      customerName: tx.customerName || null,
      staffName: tx.staffName || 'Unknown',
      heldByStaffName: tx.heldByStaffName || tx.staffName || null,
      location: tx.location || null,
      locationId: tx.locationId?.toString() || null,
      tableName: tx.tableName || null,
      items: tx.items || [],
      status: 'HELD',
    }));

    return res.status(200).json({ success: true, data, count: data.length });
  } catch (error) {
    console.error('Error fetching held transactions:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch held sales' });
  }
}
