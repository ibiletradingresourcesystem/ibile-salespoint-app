/**
 * Desktop only: writes data pulled from the cloud into the local MongoDB.
 *
 * Uses the raw driver so cloud timestamps are kept exactly and the writes are not recorded as
 * local changes. Local work that has not reached the cloud yet is never overwritten:
 *   customers  records with unsent changes are left alone until they sync
 *   staff      clock records not yet sent are kept on the staff record
 *   store      UI settings not yet sent are kept
 *   products   only pulled while no sales are waiting to sync (see syncEngine), and each write is
 *              conditional so a sale made during the pull is not overwritten
 */

import SyncOutbox from '@/src/models/SyncOutbox';
import Store from '@/src/models/Store';
import Staff from '@/src/models/Staff';
import Tender from '@/src/models/Tender';
import { Category } from '@/src/models/Category';
import Promotion from '@/src/models/Promotion';
import Customer from '@/src/models/Customer';
import SystemTheme from '@/src/models/SystemTheme';
import Product from '@/src/models/Product';
import { toObjectId } from '@/src/lib/sync/ejson';

const UNSENT_STATUSES = ['pending', 'processing', 'failed', 'conflict'];
const WRITE_CHUNK = 500;

const SNAPSHOT_COLLECTIONS = {
  store: () => Store.collection,
  systemthemes: () => SystemTheme.collection,
  tenders: () => Tender.collection,
  categories: () => Category.collection,
  promotions: () => Promotion.collection,
  staff: () => Staff.collection,
  customers: () => Customer.collection,
};

// Losing every staff member or the store would lock the till; never let a pull empty these
const NEVER_EMPTY = new Set(['store', 'staff', 'tenders']);

const isDuplicateOnly = (error) => {
  const writeErrors = error?.writeErrors || error?.result?.writeErrors || [];
  return writeErrors.length > 0 && writeErrors.every((item) => (item.code ?? item.err?.code) === 11000);
};

async function bulkWriteInChunks(collection, ops) {
  for (let index = 0; index < ops.length; index += WRITE_CHUNK) {
    try {
      await collection.bulkWrite(ops.slice(index, index + WRITE_CHUNK), { ordered: false });
    } catch (error) {
      if (!isDuplicateOnly(error)) throw error;
    }
  }
}

async function unsentEntries(entity) {
  return SyncOutbox.find({ entity, status: { $in: UNSENT_STATUSES } }).select('entityId payload').lean();
}

async function keepUnsentClockRecords(docs) {
  const entries = await unsentEntries('staff_clock');
  if (entries.length === 0) return docs;

  const byStaff = new Map();
  for (const { payload } of entries) {
    if (!payload?.staffId || !payload?.record) continue;
    const list = byStaff.get(String(payload.staffId)) || [];
    list.push(payload.record);
    byStaff.set(String(payload.staffId), list);
  }

  return docs.map((doc) => {
    const unsent = byStaff.get(String(doc._id));
    if (!unsent) return doc;
    const known = new Set((doc.clockRecords || []).map((record) => String(record._id)));
    const merged = [...(doc.clockRecords || []), ...unsent.filter((record) => !known.has(String(record._id)))];
    merged.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
    return { ...doc, clockRecords: merged };
  });
}

async function keepUnsentUiSettings(docs) {
  const entries = await unsentEntries('store_ui_settings');
  if (entries.length === 0) return docs;
  const byStore = new Map(entries.map(({ payload }) => [String(payload?.storeId), payload?.settings]));
  return docs.map((doc) => (byStore.get(String(doc._id)) ? { ...doc, uiSettings: byStore.get(String(doc._id)) } : doc));
}

export async function applySnapshot(entity, docs) {
  const collection = SNAPSHOT_COLLECTIONS[entity]?.();
  if (!collection) throw new Error(`No local collection for ${entity}`);

  let protectedIds = [];
  let toWrite = docs;

  if (entity === 'customers') {
    protectedIds = (await unsentEntries('customers')).map((entry) => entry.entityId);
    const skip = new Set(protectedIds);
    toWrite = docs.filter((doc) => !skip.has(String(doc._id)));
  } else if (entity === 'staff') {
    toWrite = await keepUnsentClockRecords(docs);
  } else if (entity === 'store') {
    toWrite = await keepUnsentUiSettings(docs);
  }

  await bulkWriteInChunks(
    collection,
    toWrite.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }))
  );

  let removed = 0;
  if (docs.length > 0 || !NEVER_EMPTY.has(entity)) {
    const keep = [...docs.map((doc) => doc._id), ...protectedIds.map(toObjectId).filter(Boolean)];
    const result = await collection.deleteMany({ _id: { $nin: keep } });
    removed = result.deletedCount || 0;
  } else {
    console.warn(`[sync] Cloud returned no ${entity}; keeping the local copy`);
  }

  return { written: toWrite.length, removed };
}

/**
 * Writes a page of products. A product changed locally between reading its version and writing
 * (a sale in progress) is skipped; it comes back on a later pull once that sale has synced.
 */
export async function applyProductPage(docs, { force = false } = {}) {
  if (!docs.length) return { written: 0 };
  const { collection } = Product;

  const locals = await collection
    .find({ _id: { $in: docs.map((doc) => doc._id) } }, { projection: { updatedAt: 1 } })
    .toArray();
  const localVersions = new Map(locals.map((doc) => [String(doc._id), doc.updatedAt ?? null]));

  const ops = docs.map((doc) => {
    if (!localVersions.has(String(doc._id))) return { insertOne: { document: doc } };
    const filter = force ? { _id: doc._id } : { _id: doc._id, updatedAt: localVersions.get(String(doc._id)) };
    return { replaceOne: { filter, replacement: doc } };
  });

  await bulkWriteInChunks(collection, ops);
  return { written: docs.length };
}

export async function localProductVersions() {
  return Product.collection.find({}, { projection: { updatedAt: 1 } }).toArray();
}

export async function deleteLocalProducts(ids) {
  if (!ids.length) return 0;
  const result = await Product.collection.deleteMany({ _id: { $in: ids } });
  return result.deletedCount || 0;
}
