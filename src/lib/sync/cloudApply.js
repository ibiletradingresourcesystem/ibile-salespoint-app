/**
 * Applies this desktop installation's local changes to the customer's cloud MongoDB, over the
 * direct connection (models from src/lib/dataModels.js bound to that connection).
 *
 * Every operation carries the record's latest local state and a monotonic revision. Applying is
 * idempotent: a revision the cloud already holds is acknowledged as a duplicate, so a change whose
 * confirmation was lost (connection dropped mid-write) can simply be applied again.
 *
 * Rules per record type (see docs/DESKTOP.md "Conflict rules"):
 *   transactions      owned by the installation that recorded them; stock changes are applied as the
 *                     difference between the cloud copy and the incoming copy, inside a MongoDB
 *                     transaction, so edits and refunds replay exactly once
 *   tills, reports    owned by the installation that opened the till; the installation's copy wins
 *   customers         created at the till are inserted; edits update only the fields the cashier
 *                     changed; credit balance is always recalculated from cloud transactions
 *   staff_clock       clock records are appended once (by record id)
 *   store_ui_settings last saved settings win
 */

import { updateInventoryForSale, reverseInventoryForRefund } from '@/src/lib/syncPackQty';
import { appliedStockItems, saleStateFingerprint, sameStockEffect } from '@/src/lib/sync/stockEffects';
import { recalculateCustomerCreditBalance } from '@/src/lib/creditBalance';
import { CUSTOMER_POS_FIELDS, PUSH_ENTITIES } from '@/src/lib/sync/entities';
import { assertSafeKeys, toObjectId } from '@/src/lib/sync/ejson';

const TRANSACTION_STATUSES = new Set(['held', 'completed', 'refunded', 'credit']);

const opError = (status, message) => Object.assign(new Error(message), { syncStatus: status });
const rejected = (message) => opError('rejected', message);
const conflict = (message) => opError('conflict', message);
const retryLater = (message) => opError('error', message);

const syncMeta = (installation, rev) => ({
  installationId: installation.installationId,
  syncRev: rev,
  syncedFrom: 'desktop',
  syncedAt: new Date(),
});

const isTransactionUnsupported = (error) =>
  error?.code === 20 || /Transaction numbers are only allowed|replica set member/i.test(error?.message || '');

/** Runs work inside a MongoDB transaction where the deployment supports it (Atlas always does). */
async function runAtomic(connection, work) {
  const session = await connection.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      console.warn('[sync] MongoDB transactions are not available; applying without one');
      return work(null);
    }
    throw error;
  } finally {
    await session.endSession().catch(() => {});
  }
}

function prepareDocument(op, label) {
  const doc = op.doc;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw rejected(`${label} data is missing`);
  assertSafeKeys(doc, label);

  const _id = toObjectId(doc._id);
  if (!_id || String(_id) !== String(op.entityId)) throw rejected(`${label} id does not match`);

  // Sync metadata is set here from the installation, never taken from the stored local copy
  const { _id: _ignoredId, __v, installationId, syncRev, syncedFrom, syncedAt, syncFingerprint, ...fields } = doc;
  return { _id, fields };
}

async function assertOwnsTransaction(existing, installation, models, session) {
  if (existing.installationId === installation.installationId) return;
  if (existing.installationId) throw conflict('This sale was recorded by another installation');

  // Online-order sales are created in the cloud against this installation's till
  if (existing.tillId) {
    const till = await models.Till.collection.findOne(
      { _id: existing.tillId },
      { session, projection: { installationId: 1 } }
    );
    if (till?.installationId === installation.installationId) return;
  }
  throw conflict('This sale was recorded in the cloud and cannot be changed by this installation');
}

async function applyTransaction(installation, op, models) {
  const { _id, fields } = prepareDocument(op, 'Sale');
  if (!Array.isArray(fields.items) || fields.items.length === 0) throw rejected('Sale has no items');
  if (typeof fields.total !== 'number' || !Number.isFinite(fields.total)) throw rejected('Sale total is not valid');
  if (!TRANSACTION_STATUSES.has(fields.status)) throw rejected(`Sale status "${fields.status}" is not valid`);

  const { collection } = models.Transaction;
  let outcome;

  try {
    outcome = await runAtomic(models.connection, async (session) => {
      let existing = await collection.findOne({ _id }, { session });
      if (!existing && fields.externalId) {
        existing = await collection.findOne({ externalId: fields.externalId }, { session });
      }

      if (existing) {
        if (existing.installationId === installation.installationId && Number(existing.syncRev || 0) >= op.rev) {
          return { status: 'duplicate', cloudId: existing._id };
        }
        await assertOwnsTransaction(existing, installation, models, session);
        if (existing.syncFingerprint && saleStateFingerprint(existing) !== existing.syncFingerprint) {
          throw conflict('This sale was changed in the cloud (for example a refund or credit payment in the management app) after this till sent it');
        }
      }

      // Bring cloud stock in line with what this version of the sale should have applied
      const before = appliedStockItems(existing);
      const after = appliedStockItems(fields);
      if (!sameStockEffect(before, after)) {
        if (before.length > 0) await reverseInventoryForRefund(before, { session, Product: models.Product });
        if (after.length > 0) await updateInventoryForSale(after, { session, Product: models.Product });
      }

      const set = { ...fields, ...syncMeta(installation, op.rev), syncFingerprint: saleStateFingerprint(fields) };
      if (existing) {
        await collection.updateOne({ _id: existing._id }, { $set: set }, { session });
      } else {
        await collection.insertOne({ _id, ...set }, { session });
      }

      return {
        status: 'applied',
        cloudId: existing?._id || _id,
        creditCustomerIds: existing?.status === 'credit' || fields.status === 'credit'
          ? [existing?.creditCustomerId, fields.creditCustomerId].filter(Boolean)
          : [],
      };
    });
  } catch (error) {
    // Same sale already stored under another id (matched by its client or dedupe key)
    if (error?.code === 11000) {
      const keys = [
        fields.externalId && { externalId: fields.externalId },
        fields.dedupeKey && { dedupeKey: fields.dedupeKey },
      ].filter(Boolean);
      const match = keys.length > 0
        ? await collection.findOne({ $or: keys }, { projection: { _id: 1 } })
        : null;
      if (match) return { status: 'duplicate', cloudId: match._id };
    }
    throw error;
  }

  for (const customerId of new Set((outcome.creditCustomerIds || []).map(String))) {
    await recalculateCustomerCreditBalance(customerId, models);
  }
  return outcome;
}

async function applyTill(installation, op, models) {
  const { _id, fields } = prepareDocument(op, 'Till');
  if (!toObjectId(fields.storeId) || !toObjectId(fields.locationId)) throw rejected('Till is missing its store or location');

  const { collection } = models.Till;
  const existing = await collection.findOne({ _id }, { projection: { installationId: 1, syncRev: 1 } });

  if (existing) {
    if (existing.installationId !== installation.installationId) throw conflict('This till belongs to another terminal');
    if (Number(existing.syncRev || 0) >= op.rev) return { status: 'duplicate', cloudId: _id };
    await collection.replaceOne(
      { _id, installationId: installation.installationId, syncRev: { $not: { $gte: op.rev } } },
      { ...fields, ...syncMeta(installation, op.rev) }
    );
  } else {
    await collection.insertOne({ _id, ...fields, ...syncMeta(installation, op.rev) });
  }

  return { status: 'applied', cloudId: _id };
}

async function applyEndOfDayReport(installation, op, models) {
  const { _id, fields } = prepareDocument(op, 'End of day report');
  const tillId = toObjectId(fields.tillId);
  if (!tillId) throw rejected('End of day report is missing its till');

  const till = await models.Till.collection.findOne({ _id: tillId }, { projection: { installationId: 1 } });
  if (!till) throw retryLater('The till for this report has not reached the cloud yet');
  if (till.installationId !== installation.installationId) throw conflict('This report belongs to another terminal');

  const { collection } = models.EndOfDayReport;
  const existing = await collection.findOne(
    { $or: [{ _id }, { tillId }] },
    { projection: { installationId: 1, syncRev: 1 } }
  );

  const doc = { ...fields, tillId, ...syncMeta(installation, op.rev) };
  if (existing) {
    if (existing.installationId === installation.installationId && Number(existing.syncRev || 0) >= op.rev) {
      return { status: 'duplicate', cloudId: existing._id };
    }
    await collection.replaceOne({ _id: existing._id }, doc);
    return { status: 'applied', cloudId: existing._id };
  }

  await collection.insertOne({ _id, ...doc });
  return { status: 'applied', cloudId: _id };
}

async function applyCustomer(installation, op, models) {
  const { _id, fields } = prepareDocument(op, 'Customer');
  const { collection } = models.Customer;
  const existing = await collection.findOne({ _id }, { projection: { isCreditCustomer: 1 } });
  const now = new Date();

  if (!existing) {
    const email = typeof fields.email === 'string' ? fields.email.trim() : '';
    if (email) {
      const sameEmail = await collection.findOne({ email }, { projection: { _id: 1 } });
      if (sameEmail) throw conflict(`A customer with the email ${email} already exists in the cloud`);
    }
    const doc = { ...fields, installationId: installation.installationId, syncedAt: now, updatedAt: now };
    if (!email) delete doc.email;
    await collection.insertOne({ _id, ...doc, createdAt: fields.createdAt || now });
  } else {
    const changed = Array.isArray(op.fields) && op.fields.length > 0 ? op.fields : ['*'];
    const allowed = changed.includes('*') ? CUSTOMER_POS_FIELDS : CUSTOMER_POS_FIELDS.filter((field) => changed.includes(field));
    const set = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, field)) set[field] = fields[field];
    }
    if (Object.keys(set).length > 0) {
      await collection.updateOne({ _id }, { $set: { ...set, updatedAt: now, syncedAt: now } });
    }
  }

  if (existing?.isCreditCustomer || fields.isCreditCustomer) {
    await recalculateCustomerCreditBalance(_id, models);
  }
  return { status: 'applied', cloudId: _id };
}

async function applyStaffClock(installation, op, models) {
  const payload = op.payload || {};
  const record = payload.record || {};
  const staffId = toObjectId(payload.staffId);
  const recordId = toObjectId(record._id);
  if (!staffId || !recordId || !['in', 'out'].includes(record.type)) throw rejected('Clock record is not valid');

  const timestamp = new Date(record.timestamp);
  if (Number.isNaN(timestamp.getTime())) throw rejected('Clock record time is not valid');

  const entry = { _id: recordId, type: record.type, timestamp };
  if (toObjectId(record.locationId)) entry.locationId = toObjectId(record.locationId);
  if (record.locationName) entry.locationName = String(record.locationName);
  if (record.notes) entry.notes = String(record.notes);

  const { collection } = models.Staff;
  const staff = await collection.findOne({ _id: staffId }, { projection: { _id: 1 } });
  if (!staff) throw rejected('This staff member no longer exists in the cloud');

  await collection.updateOne(
    { _id: staffId, 'clockRecords._id': { $ne: recordId } },
    { $push: { clockRecords: entry }, $set: { updatedAt: new Date() } }
  );
  return { status: 'applied', cloudId: recordId };
}

async function applyStoreUiSettings(installation, op, models) {
  const storeId = toObjectId(op.payload?.storeId);
  const settings = op.payload?.settings;
  if (!storeId || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw rejected('UI settings are not valid');
  }

  const result = await models.Store.collection.updateOne(
    { _id: storeId },
    { $set: { uiSettings: settings, updatedAt: new Date() } }
  );
  if (!result.matchedCount) throw rejected('Store was not found in the cloud');
  return { status: 'applied', cloudId: storeId };
}

const HANDLERS = {
  customers: applyCustomer,
  tills: applyTill,
  transactions: applyTransaction,
  endofdayreports: applyEndOfDayReport,
  staff_clock: applyStaffClock,
  store_ui_settings: applyStoreUiSettings,
};

function describeFailure(error) {
  if (error?.syncStatus) return { status: error.syncStatus, message: error.message };
  if (error?.name === 'ValidationError' || error?.name === 'CastError' || error?.name === 'BSONError') {
    return { status: 'rejected', message: error.message };
  }
  return { status: 'error', message: error?.message || 'Unexpected error while applying change', error };
}

/**
 * @param installation { installationId }
 * @param ops          [{ opId, entity, entityId, rev, fields, doc | payload }]
 * @param models       models bound to the cloud connection (modelsFor(connection))
 */
export async function applyPushOps(installation, ops, models) {
  const ordered = [...ops].sort(
    (left, right) => (PUSH_ENTITIES[left?.entity]?.priority ?? 999) - (PUSH_ENTITIES[right?.entity]?.priority ?? 999)
  );

  const results = [];
  for (const op of ordered) {
    const opId = String(op?.opId || '');
    try {
      const handler = HANDLERS[op?.entity];
      if (!handler) throw rejected(`Unknown record type "${op?.entity}"`);
      if (!Number.isInteger(op.rev) || op.rev < 1) throw rejected('Change revision is missing');

      const outcome = await handler(installation, op, models);
      results.push({ opId, status: outcome.status, cloudId: String(outcome.cloudId || '') });
    } catch (error) {
      if (!error?.syncStatus) console.error(`[sync] Failed to apply ${op?.entity} ${op?.entityId}:`, error?.message || error);
      results.push({ opId, ...describeFailure(error) });
    }
  }
  return results;
}
