/**
 * Extended JSON for sync payloads, so ObjectIds and Dates survive the trip between the
 * desktop and the cloud (plain JSON would turn them into strings).
 */

import mongoose from 'mongoose';

const { EJSON } = mongoose.mongo.BSON;

export const stringifyWire = (value) => EJSON.stringify(value, { relaxed: true });
export const parseWire = (text) => EJSON.parse(text, { relaxed: true });
export const fromWireObject = (value) => EJSON.deserialize(value, { relaxed: true });

export function sendWire(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(stringifyWire(payload));
}

export const toObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value || '');
  return mongoose.Types.ObjectId.isValid(text) && /^[a-f\d]{24}$/i.test(text)
    ? new mongoose.Types.ObjectId(text)
    : null;
};

/** Refuse field names that MongoDB would read as operators or dotted paths. */
export function assertSafeKeys(doc, label = 'document') {
  for (const key of Object.keys(doc || {})) {
    if (key.startsWith('$') || key.includes('.')) {
      const error = new Error(`Invalid field name "${key}" in ${label}`);
      error.syncStatus = 'rejected';
      throw error;
    }
  }
}
