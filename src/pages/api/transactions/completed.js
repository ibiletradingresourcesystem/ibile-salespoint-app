/**
 * API Endpoint: GET /api/transactions/completed
 * 
 * Fetches all completed transactions from the database
 * Used by the Orders/Complete screen to display transaction history
 * Supports both online and offline access (offline uses IndexedDB)
 */

import { mongooseConnect } from '@/src/lib/mongoose';
import { Transaction } from '@/src/models/Transactions';
import mongoose from 'mongoose';
import { isDesktopServer } from '@/src/lib/runtime';
import { cloudDataModels } from '@/src/lib/dataModels';

/**
 * Desktop: an earlier day is read from the cloud as well as from this till.
 *
 * A till's own database only holds the sales it recorded itself — sales are sent to the cloud and
 * never come back down. So an earlier day showed nothing from the other tills, and nothing at all on
 * a till whose database had been started again. The cloud has every till's sales; this till's own
 * copy still wins for anything it holds, since one of its sales may not have been sent yet.
 *
 * Only for past days, which someone asked for by choosing a date: today stays on this till, and the
 * Completed tab's refresh never reaches out to the cloud on its own.
 */
const CLOUD_TIMEOUT_MS = 12000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('The cloud database took too long to answer')), ms)),
  ]);

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

async function readCloudTransactions(filters, count) {
  const cloud = await withTimeout(cloudDataModels(), CLOUD_TIMEOUT_MS);
  return withTimeout(
    cloud.Transaction.find(filters).sort({ createdAt: -1 }).limit(count).lean(),
    CLOUD_TIMEOUT_MS
  );
}

/** This till's copy of a sale wins over the cloud's; the cloud fills in everything else. */
function mergeSales(local, remote) {
  const seen = new Set();
  const keyOf = (tx) => [String(tx._id || ''), tx.externalId ? `ext:${tx.externalId}` : ''].filter(Boolean);
  const merged = [];
  for (const tx of [...local, ...remote]) {
    const keys = keyOf(tx);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    merged.push(tx);
  }
  return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default async function handler(req, res) {
  // Only support GET
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    await mongooseConnect();

    // Get filter parameters from query
    const { 
      staffId,
      location,
      locationId,
      tillId,
      startDate,
      endDate,
      limit = 100,
      skip = 0
    } = req.query;

    // Build query filters
    const filters = {
      status: { $in: ['completed', 'COMPLETE', 'complete'] } // Legacy + normalized status support
    };

    // Optional filters
    if (staffId) {
      filters.staff = staffId;
    }
    const locationClauses = [];
    if (locationId && mongoose.Types.ObjectId.isValid(String(locationId))) {
      locationClauses.push({ locationId: new mongoose.Types.ObjectId(String(locationId)) });
    }
    if (location) {
      locationClauses.push({
        location: {
          $regex: `^${escapeRegex(location)}$`,
          $options: 'i',
        },
      });
    }
    if (locationClauses.length === 1) {
      Object.assign(filters, locationClauses[0]);
    } else if (locationClauses.length > 1) {
      filters.$or = locationClauses;
    }
    if (tillId && mongoose.Types.ObjectId.isValid(String(tillId))) {
      filters.tillId = tillId;
    }

    // Date range filter
    if (startDate || endDate) {
      filters.createdAt = {};
      if (startDate) {
        filters.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        if (!String(endDate).includes('T')) {
          endDateTime.setHours(23, 59, 59, 999); // Include entire date-only value
        }
        filters.createdAt.$lte = endDateTime;
      }
    }

    console.log('📋 Fetching completed transactions with filters:', filters);

    // Fetch completed transactions
    const take = parseInt(limit);
    const from = parseInt(skip);
    const local = await Transaction.find(filters)
      .sort({ createdAt: -1 }) // Most recent first
      .limit(take + from)
      .lean(); // Lean query for performance

    let transactions = local;
    let source = 'this-till';
    let note = '';

    const pastDay = filters.createdAt?.$lte && filters.createdAt.$lte <= startOfToday();
    if (isDesktopServer() && pastDay) {
      try {
        const remote = await readCloudTransactions(filters, take + from);
        transactions = mergeSales(local, remote);
        source = 'cloud';
      } catch (cloudError) {
        console.warn('Earlier sales could not be read from the cloud:', cloudError.message);
        note = 'Showing only the sales recorded on this till — the cloud database could not be reached, so sales from other tills (or from before this till was set up again) are not listed.';
      }
    }

    transactions = transactions.slice(from, from + take);

    // Format transactions for frontend
    const formattedTransactions = transactions.map(tx => ({
      id: tx._id?.toString() || tx.id,
      externalId: tx.externalId || null,
      createdAt: tx.createdAt,
      total: tx.total || 0,
      subtotal: tx.subtotal || 0,
      tax: tx.tax || 0,
      discount: tx.discount || 0,
      amountPaid: tx.amountPaid || tx.total || 0,
      change: tx.change || 0,
      customerName: tx.customerName || 'Walk-in',
      staffName: tx.staffName || 'Unknown',
      staffId: tx.staff?.toString() || tx.staffId,
      tillId: tx.tillId?.toString() || tx.tillId,
      locationId: tx.locationId?.toString() || tx.locationId || null,
      location: tx.location || 'Default Location',
      tenderType: tx.tenderType, // Legacy single tender
      tenderPayments: tx.tenderPayments, // New split payments
      items: tx.items || [],
      status: tx.status || 'completed',
      subStatus: tx.subStatus || null,
      device: tx.device || 'POS',
      transactionType: tx.transactionType || 'pos',
    }));

    console.log(`✅ Found ${formattedTransactions.length} completed transactions`);

    return res.status(200).json({
      success: true,
      data: formattedTransactions,
      count: formattedTransactions.length,
      // Where the list came from, so the till can say when it is only its own sales
      source,
      ...(note ? { note } : {}),
    });

  } catch (error) {
    console.error('❌ Error fetching completed transactions:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch completed transactions',
    });
  }
}
