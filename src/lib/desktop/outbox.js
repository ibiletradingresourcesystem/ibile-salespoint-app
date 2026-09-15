/**
 * Desktop only: durable record of local changes that still need to reach the cloud.
 *
 * Entries are written to the local MongoDB in the same request that changed the data, so they
 * survive app and computer restarts. Several changes to the same record while it waits are merged
 * into one pending entry; the latest state of the record is read at send time. The sync engine is
 * asked to send them a few seconds later; if the cloud database cannot be reached they wait here.
 */

import mongoose from 'mongoose';
import SyncOutbox from '@/src/models/SyncOutbox';
import { PUSH_ENTITIES } from '@/src/lib/sync/entities';
import { getDesktopConfig, isDesktopServer } from '@/src/lib/runtime';
import { requestSyncSoon } from '@/src/lib/desktop/syncSignal';

async function nextRevision() {
  const result = await mongoose.connection.collection('sync_counters').findOneAndUpdate(
    { _id: 'outbox_rev' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return Number((result?.value ?? result)?.seq || 0);
}

/**
 * @param {string} entity   key of PUSH_ENTITIES
 * @param {string} entityId record id (or record key for payload entities)
 * @param {object} options  fields: changed top-level fields; payload: data for payload entities
 */
export async function recordLocalChange(entity, entityId, { fields = ['*'], payload = null } = {}) {
  if (!isDesktopServer()) return;
  const definition = PUSH_ENTITIES[entity];
  if (!definition || !entityId) return;

  const now = new Date();
  const rev = await nextRevision();
  const isPayload = definition.mode === 'payload';

  const update = {
    $max: { rev },
    $set: { updatedAt: now, ...(isPayload ? { payload } : {}) },
    $setOnInsert: {
      installationId: getDesktopConfig().installationId,
      operation: isPayload ? 'payload' : 'upsert',
      priority: definition.priority,
      attempts: 0,
      nextRetryAt: new Date(0),
      lastAttemptAt: null,
      lockedAt: null,
      syncedAt: null,
      error: '',
      cloudId: '',
      createdAt: now,
      ...(isPayload ? { fields: [] } : {}),
    },
  };
  if (!isPayload) {
    update.$addToSet = { fields: { $each: fields?.length ? fields : ['*'] } };
  }

  const filter = { entity, entityId: String(entityId), status: 'pending' };

  // Two requests changing the same record can race on the one-pending-entry index; retry once merged
  for (let attempt = 0; ; attempt += 1) {
    try {
      await SyncOutbox.collection.updateOne(filter, update, { upsert: true });
      break;
    } catch (error) {
      if (error?.code !== 11000 || attempt >= 2) throw error;
    }
  }

  requestSyncSoon();
}
