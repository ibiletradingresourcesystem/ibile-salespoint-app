/**
 * Small helpers for sync documents moving between the local and cloud databases.
 */

import mongoose from 'mongoose';

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
