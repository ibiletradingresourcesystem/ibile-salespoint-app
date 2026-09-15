/**
 * Reads what the desktop POS needs from the customer's cloud MongoDB, over the direct connection
 * (models from src/lib/dataModels.js bound to that connection).
 *
 * Only what the POS uses is read. Staff records are reduced to login and permission fields (no bank,
 * salary, guarantor or onboarding data) and passcodes are always stored locally as bcrypt hashes.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import { hashIfPlaintext } from '@/src/lib/staffPin';
import { toObjectId } from '@/src/lib/sync/ejson';

const { EJSON } = mongoose.mongo.BSON;

const STAFF_PROJECTION = {
  name: 1,
  username: 1,
  password: 1,
  pin: 1,
  role: 1,
  posPermissions: 1,
  location: 1,
  locationId: 1,
  locationName: 1,
  isActive: 1,
  showOnPos: 1,
  clockRecords: { $slice: -50 },
  createdAt: 1,
  updatedAt: 1,
};

const PRODUCT_PROJECTION = { salesHistory: 0, promoStats: 0 };

const SNAPSHOT_SOURCES = {
  store: { model: 'Store' },
  systemthemes: { model: 'SystemTheme' },
  tenders: { model: 'Tender' },
  categories: { model: 'Category' },
  promotions: { model: 'Promotion' },
  staff: { model: 'Staff', projection: STAFF_PROJECTION, prepare: prepareStaff },
  customers: { model: 'Customer' },
};

async function prepareStaff(doc) {
  const next = { ...doc };
  if (next.password !== undefined) next.password = await hashIfPlaintext(String(next.password));
  if (next.pin !== undefined && next.pin !== null && next.pin !== '') next.pin = await hashIfPlaintext(String(next.pin));
  return next;
}

export const isSnapshotEntity = (entity) => Object.prototype.hasOwnProperty.call(SNAPSHOT_SOURCES, entity);

/**
 * Whole collection, with a fingerprint of the cloud data. The caller skips writing when the
 * fingerprint matches the last one applied. prepare() returns the documents to store locally.
 */
export async function readSnapshot(entity, models) {
  const source = SNAPSHOT_SOURCES[entity];
  const docs = await models[source.model].collection
    .find({}, { projection: source.projection, sort: { _id: 1 } })
    .toArray();

  const hash = crypto.createHash('sha1');
  for (const doc of docs) hash.update(EJSON.stringify(doc, { relaxed: false }));

  return {
    docs,
    etag: `${docs.length}-${hash.digest('hex')}`,
    prepare: async () => (source.prepare ? Promise.all(docs.map(source.prepare)) : docs),
  };
}

/**
 * Product changes. Without `since` this pages the whole collection by _id (first sync); with it,
 * everything updated at or after `since`, ordered by (updatedAt, _id) so paging never skips a record.
 */
export async function readProductChanges(models, { since, afterId, limit = 500 } = {}) {
  const { collection } = models.Product;
  const serverTime = new Date();
  const after = afterId ? toObjectId(afterId) : null;

  let filter;
  let sort;
  if (!since) {
    filter = after ? { _id: { $gt: after } } : {};
    sort = { _id: 1 };
  } else {
    filter = after
      ? { $or: [{ updatedAt: { $gt: since } }, { updatedAt: since, _id: { $gt: after } }] }
      : { updatedAt: { $gte: since } };
    sort = { updatedAt: 1, _id: 1 };
  }

  const docs = await collection.find(filter, { projection: PRODUCT_PROJECTION, sort, limit }).toArray();
  const last = docs[docs.length - 1];
  const hasMore = docs.length === limit;

  return {
    serverTime,
    docs,
    hasMore,
    next: hasMore ? { since: since ? last.updatedAt : null, afterId: last._id } : null,
  };
}

/** Ids and update times of every product, used to find deleted or missed products. */
export async function readProductManifest(models) {
  return models.Product.collection.find({}, { projection: { _id: 1, updatedAt: 1 } }).toArray();
}

export async function readProductsByIds(models, ids = []) {
  const objectIds = ids.map(toObjectId).filter(Boolean);
  return objectIds.length > 0
    ? models.Product.collection.find({ _id: { $in: objectIds } }, { projection: PRODUCT_PROJECTION }).toArray()
    : [];
}
