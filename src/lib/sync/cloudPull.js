/**
 * Cloud: data a desktop installation downloads to operate offline.
 *
 * Only what the POS uses is sent. Staff records are reduced to login and permission fields
 * (no bank, salary, guarantor or onboarding data) and passcodes are always bcrypt hashes.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import Store from '@/src/models/Store';
import Staff from '@/src/models/Staff';
import Tender from '@/src/models/Tender';
import { Category } from '@/src/models/Category';
import Promotion from '@/src/models/Promotion';
import Customer from '@/src/models/Customer';
import SystemTheme from '@/src/models/SystemTheme';
import Product from '@/src/models/Product';
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

async function sanitizeStaff(doc) {
  const next = { ...doc };
  if (next.password !== undefined) next.password = await hashIfPlaintext(String(next.password));
  if (next.pin !== undefined && next.pin !== null && next.pin !== '') next.pin = await hashIfPlaintext(String(next.pin));
  return next;
}

const SNAPSHOT_SOURCES = {
  store: { model: () => Store },
  systemthemes: { model: () => SystemTheme },
  tenders: { model: () => Tender },
  categories: { model: () => Category },
  promotions: { model: () => Promotion },
  staff: { model: () => Staff, projection: STAFF_PROJECTION, transform: sanitizeStaff },
  customers: { model: () => Customer },
};

const clampLimit = (value, fallback, max) => {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(number, max);
};

export const isSnapshotEntity = (entity) => Object.prototype.hasOwnProperty.call(SNAPSHOT_SOURCES, entity);

/**
 * Whole-collection pull. The first page carries an ETag of the full collection; when it matches the
 * installation's copy nothing is sent.
 */
export async function pullSnapshot(entity, { etag, afterId, limit } = {}) {
  const source = SNAPSHOT_SOURCES[entity];
  const { collection } = source.model();
  const pageSize = clampLimit(limit, 500, 1000);
  const projection = source.projection;
  const after = afterId ? toObjectId(afterId) : null;

  let currentEtag = null;
  if (!after) {
    const hash = crypto.createHash('sha1');
    let count = 0;
    for await (const doc of collection.find({}, { projection, sort: { _id: 1 } })) {
      hash.update(EJSON.stringify(doc, { relaxed: false }));
      count += 1;
    }
    currentEtag = `${count}-${hash.digest('hex')}`;
    if (etag && etag === currentEtag) {
      return { entity, unchanged: true, etag: currentEtag };
    }
  }

  const docs = await collection
    .find(after ? { _id: { $gt: after } } : {}, { projection, sort: { _id: 1 }, limit: pageSize })
    .toArray();
  const payload = source.transform ? await Promise.all(docs.map(source.transform)) : docs;

  return {
    entity,
    unchanged: false,
    etag: currentEtag,
    docs: payload,
    nextAfterId: docs.length === pageSize ? docs[docs.length - 1]._id : null,
  };
}

/**
 * Product changes. Without `since` this pages the whole collection by _id (first sync); with it,
 * everything updated at or after `since`, ordered by (updatedAt, _id) so paging never skips a record.
 */
export async function pullProductChanges({ since, afterId, limit } = {}) {
  const { collection } = Product;
  const pageSize = clampLimit(limit, 500, 1000);
  const serverTime = new Date();
  const sinceDate = since ? new Date(since) : null;
  const after = afterId ? toObjectId(afterId) : null;

  let filter;
  let sort;
  if (!sinceDate || Number.isNaN(sinceDate.getTime())) {
    filter = after ? { _id: { $gt: after } } : {};
    sort = { _id: 1 };
  } else {
    filter = after
      ? { $or: [{ updatedAt: { $gt: sinceDate } }, { updatedAt: sinceDate, _id: { $gt: after } }] }
      : { updatedAt: { $gte: sinceDate } };
    sort = { updatedAt: 1, _id: 1 };
  }

  const docs = await collection.find(filter, { projection: PRODUCT_PROJECTION, sort, limit: pageSize }).toArray();
  const last = docs[docs.length - 1];
  const hasMore = docs.length === pageSize;

  return {
    entity: 'products',
    serverTime,
    docs,
    hasMore,
    next: hasMore
      ? { since: sinceDate && !Number.isNaN(sinceDate.getTime()) ? last.updatedAt : null, afterId: last._id }
      : null,
  };
}

/** Ids and update times of every product, used to find deleted or missed products. */
export async function pullProductManifest({ afterId, limit } = {}) {
  const pageSize = clampLimit(limit, 5000, 10000);
  const after = afterId ? toObjectId(afterId) : null;
  const docs = await Product.collection
    .find(after ? { _id: { $gt: after } } : {}, { projection: { _id: 1, updatedAt: 1 }, sort: { _id: 1 }, limit: pageSize })
    .toArray();

  return {
    entity: 'products',
    entries: docs,
    nextAfterId: docs.length === pageSize ? docs[docs.length - 1]._id : null,
  };
}

export async function pullProductsByIds(ids = []) {
  const objectIds = ids.map(toObjectId).filter(Boolean).slice(0, 500);
  const docs = objectIds.length > 0
    ? await Product.collection.find({ _id: { $in: objectIds } }, { projection: PRODUCT_PROJECTION }).toArray()
    : [];
  return { entity: 'products', docs };
}
