/**
 * Mongoose plugin that records every local write to a synced model in the outbox.
 *
 * Applied to the records the till creates (transactions, tills, end-of-day reports, customers),
 * so the existing API routes need no sync code of their own. It does nothing outside the desktop
 * runtime. Data applied from the cloud is written with the raw driver and is not recorded.
 */

import mongoose from 'mongoose';
import { isDesktopServer } from '@/src/lib/runtime';
import { recordLocalChange } from '@/src/lib/desktop/outbox';

// The same schemas are also used on the direct cloud connection (sync, online orders); only writes
// to the local database are local changes
const isLocal = (connection) => !connection || connection === mongoose.connection;

const QUERY_WRITE_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'];

const rootPath = (path) => String(path).split('.')[0];

function fieldsFromUpdate(update) {
  if (!update || Array.isArray(update)) return ['*'];
  const fields = new Set();
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$')) {
      if (value && typeof value === 'object') Object.keys(value).forEach((path) => fields.add(rootPath(path)));
    } else {
      fields.add(rootPath(key));
    }
  }
  return fields.size > 0 ? [...fields] : ['*'];
}

export function syncTracking(schema, { entity }) {
  if (!isDesktopServer()) return;

  const record = async (ids, fields) => {
    for (const id of ids) {
      try {
        await recordLocalChange(entity, String(id), { fields });
      } catch (error) {
        // The write itself succeeded; the periodic sweep in the sync engine re-queues missed records
        console.error(`[sync] Could not queue ${entity} ${id} for cloud sync:`, error?.message || error);
      }
    }
  };

  schema.pre('save', function trackSavedFields() {
    if (!isLocal(this.constructor?.db)) return;
    this.$locals.syncFields = this.isNew ? ['*'] : [...new Set(this.modifiedPaths().map(rootPath))];
  });

  schema.post('save', async function recordSave(doc) {
    if (!isLocal(doc.constructor?.db)) return;
    await record([doc._id], doc.$locals?.syncFields?.length ? doc.$locals.syncFields : ['*']);
  });

  schema.pre(QUERY_WRITE_OPS, async function findTargets() {
    if (!isLocal(this.model?.db)) {
      this._syncSkip = true;
      return;
    }
    let query = this.model.find(this.getFilter()).select('_id').lean();
    const session = this.getOptions()?.session;
    if (session) query = query.session(session);
    this._syncIds = (await query).map((doc) => doc._id);
    this._syncFields = fieldsFromUpdate(this.getUpdate());
  });

  schema.post(QUERY_WRITE_OPS, async function recordQueryWrite(result) {
    if (this._syncSkip) return;
    const unchanged = result && typeof result.matchedCount === 'number' && !result.modifiedCount && !result.upsertedId;
    if (unchanged) return;

    const ids = new Map((this._syncIds || []).map((id) => [String(id), id]));
    for (const candidate of [result?.upsertedId, result?._id, result?.value?._id]) {
      if (candidate) ids.set(String(candidate), candidate);
    }
    await record([...ids.values()], this._syncFields || ['*']);
  });

  schema.post('insertMany', async function recordInsertMany(docs) {
    if (!isLocal(this?.db)) return;
    await record((docs || []).map((doc) => doc._id), ['*']);
  });
}
