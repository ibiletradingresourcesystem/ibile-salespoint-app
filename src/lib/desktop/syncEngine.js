/**
 * Desktop only: moves data between this installation's local MongoDB and the cloud.
 *
 * One cycle:
 *   1. check the cloud is reachable (short timeout, backs off while offline)
 *   2. push the outbox, oldest and most-depended-on first, in batches
 *   3. pull cloud data that is due (snapshots by ETag, products by updatedAt cursor)
 *
 * The till never waits for this. Sales are committed locally first; cycles are started by the
 * Electron scheduler (heartbeat), shortly after any local change, and on demand from the UI.
 * Everything the engine needs to resume after a restart (outbox, cursors) is in MongoDB.
 */

import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import SyncOutbox from '@/src/models/SyncOutbox';
import { Transaction } from '@/src/models/Transactions';
import Till from '@/src/models/Till';
import EndOfDayReport from '@/src/models/EndOfDayReport';
import Customer from '@/src/models/Customer';
import { PULL_ENTITIES, PUSH_ENTITIES } from '@/src/lib/sync/entities';
import { toObjectId } from '@/src/lib/sync/ejson';
import { getDesktopConfig, isDesktopEnrolled, isDesktopServer } from '@/src/lib/runtime';
import { CloudRequestError, cloudRequest, pingCloud } from '@/src/lib/desktop/cloudClient';
import {
  applyProductPage,
  applySnapshot,
  deleteLocalProducts,
  localProductVersions,
} from '@/src/lib/desktop/pullApply';
import { recordLocalChange } from '@/src/lib/desktop/outbox';
import { registerSyncRunner } from '@/src/lib/desktop/syncSignal';

const STATE_ID = 'engine';
const OPEN_STATUSES = ['pending', 'processing'];
const UNRESOLVED_STATUSES = ['pending', 'processing', 'failed', 'conflict'];
const PUSH_BATCH_SIZE = 25;
const CYCLE_BUDGET_MS = 45 * 1000;
const STALE_CLAIM_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
const OFFLINE_BACKOFF_MS = [15 * 1000, 30 * 1000, 60 * 1000, 2 * 60 * 1000];
const PRODUCT_CURSOR_OVERLAP_MS = 2 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SWEEP_WINDOW_MS = 25 * 24 * 60 * 60 * 1000;

// Records only ever created on this installation; the sweep re-queues any that were never recorded
const LOCALLY_AUTHORED = {
  transactions: () => Transaction.collection,
  tills: () => Till.collection,
  endofdayreports: () => EndOfDayReport.collection,
};
const DOCUMENT_COLLECTIONS = { ...LOCALLY_AUTHORED, customers: () => Customer.collection };

const runtime = () => {
  if (!globalThis.__ibilePosSyncEngine) {
    globalThis.__ibilePosSyncEngine = {
      running: null,
      rerun: false,
      phase: 'idle',
      progress: null,
      nextAttemptAt: 0,
      offlineStreak: 0,
      recoveredClaims: false,
      lastSweepAt: 0,
    };
  }
  return globalThis.__ibilePosSyncEngine;
};

const stateCollection = () => mongoose.connection.collection('sync_state');

async function readState() {
  return (await stateCollection().findOne({ _id: STATE_ID })) || { _id: STATE_ID, pull: {} };
}

async function writeState(set) {
  await stateCollection().updateOne({ _id: STATE_ID }, { $set: { ...set, updatedAt: new Date() } }, { upsert: true });
}

const retryDelay = (attempts) => {
  const base = Math.min(MAX_RETRY_DELAY_MS, 10 * 1000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
};

/* ------------------------------------------------------------------ outbox state changes */

async function markSynced(entry, { cloudId = '', note = '' } = {}) {
  await SyncOutbox.collection.updateOne(
    { _id: entry._id },
    { $set: { status: 'synced', syncedAt: new Date(), lockedAt: null, error: note, cloudId: String(cloudId || '') } }
  );
}

async function markFinal(entry, status, message) {
  await SyncOutbox.collection.updateOne(
    { _id: entry._id },
    { $set: { status, lockedAt: null, error: String(message || '').slice(0, 1000) } }
  );
}

/** Puts a claimed entry back in the queue, or folds it into a newer pending entry for the same record. */
async function releaseForRetry(entry, message, { immediate = false } = {}) {
  const nextRetryAt = new Date(Date.now() + (immediate ? 0 : retryDelay(entry.attempts || 1)));
  try {
    await SyncOutbox.collection.updateOne(
      { _id: entry._id, status: 'processing' },
      { $set: { status: 'pending', lockedAt: null, nextRetryAt, error: String(message || '').slice(0, 1000) } }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    // A newer change to this record is already queued; it carries the latest state
    await SyncOutbox.collection.updateOne(
      { entity: entry.entity, entityId: entry.entityId, status: 'pending' },
      { $addToSet: { fields: { $each: entry.fields || ['*'] } }, $max: { rev: entry.rev || 0 } }
    );
    await SyncOutbox.collection.deleteOne({ _id: entry._id });
  }
}

async function recoverClaims() {
  const rt = runtime();
  const filter = rt.recoveredClaims
    ? { status: 'processing', lockedAt: { $lt: new Date(Date.now() - STALE_CLAIM_MS) } }
    : { status: 'processing' };
  rt.recoveredClaims = true;

  const stale = await SyncOutbox.find(filter).lean();
  for (const entry of stale) {
    await releaseForRetry(entry, 'Interrupted before the cloud confirmed it', { immediate: true });
  }
}

/* ------------------------------------------------------------------ push */

async function buildWireOp(entry) {
  const definition = PUSH_ENTITIES[entry.entity];
  const base = {
    opId: String(entry._id),
    entity: entry.entity,
    entityId: entry.entityId,
    rev: entry.rev,
    fields: entry.fields || [],
  };
  if (definition.mode === 'payload') return { ...base, payload: entry.payload };

  const id = toObjectId(entry.entityId);
  const doc = id ? await DOCUMENT_COLLECTIONS[entry.entity]().findOne({ _id: id }) : null;
  return doc ? { ...base, doc } : null;
}

async function pushPending(deadline) {
  const summary = { sent: 0, synced: 0, retry: 0, failed: 0, conflict: 0 };

  while (Date.now() < deadline) {
    const now = new Date();
    const candidates = await SyncOutbox.find({ status: 'pending', nextRetryAt: { $lte: now } })
      .sort({ priority: 1, createdAt: 1 })
      .limit(PUSH_BATCH_SIZE)
      .lean();
    if (candidates.length === 0) break;

    const claimed = [];
    for (const entry of candidates) {
      if (!PUSH_ENTITIES[entry.entity]) {
        await markFinal(entry, 'failed', `Unknown record type ${entry.entity}`);
        continue;
      }
      const result = await SyncOutbox.collection.updateOne(
        { _id: entry._id, status: 'pending' },
        { $set: { status: 'processing', lockedAt: now, lastAttemptAt: now }, $inc: { attempts: 1 } }
      );
      if (result.modifiedCount) claimed.push({ ...entry, attempts: (entry.attempts || 0) + 1 });
    }

    const sendable = [];
    const ops = [];
    for (const entry of claimed) {
      const op = await buildWireOp(entry);
      if (op) {
        sendable.push(entry);
        ops.push(op);
      } else {
        await markSynced(entry, { note: 'Record no longer exists on this computer' });
      }
    }
    if (ops.length === 0) continue;

    let response;
    try {
      response = await cloudRequest('/api/sync/push', { body: { ops }, timeoutMs: 45 * 1000 });
    } catch (error) {
      for (const entry of sendable) await releaseForRetry(entry, error.message);
      throw error;
    }

    summary.sent += ops.length;
    const results = new Map((response?.results || []).map((result) => [String(result.opId), result]));

    for (const entry of sendable) {
      const result = results.get(String(entry._id));
      switch (result?.status) {
        case 'applied':
        case 'duplicate':
          await markSynced(entry, { cloudId: result.cloudId });
          summary.synced += 1;
          break;
        case 'conflict':
          await markFinal(entry, 'conflict', result.message);
          summary.conflict += 1;
          break;
        case 'rejected':
          await markFinal(entry, 'failed', result.message);
          summary.failed += 1;
          break;
        default:
          await releaseForRetry(entry, result?.message || 'The cloud did not confirm this change');
          summary.retry += 1;
      }
    }
  }

  return summary;
}

/* ------------------------------------------------------------------ pull */

const hasUnsentSales = async () =>
  (await SyncOutbox.countDocuments({ entity: 'transactions', status: { $in: OPEN_STATUSES } })) > 0;

async function pullSnapshotEntity(definition, cursor) {
  let afterId = null;
  let etag = null;
  const docs = [];

  for (let page = 0; page < 200; page += 1) {
    const data = await cloudRequest('/api/sync/pull', {
      body: {
        entity: definition.name,
        mode: 'snapshot',
        ...(afterId ? { afterId: String(afterId) } : { etag: cursor.etag || undefined }),
        limit: 1000,
      },
      timeoutMs: 60 * 1000,
    });

    if (data?.unchanged) {
      await writeState({ [`pull.${definition.name}.lastPulledAt`]: new Date() });
      return { unchanged: true };
    }
    if (!afterId) etag = data?.etag || null;
    docs.push(...(data?.docs || []));
    if (!data?.nextAfterId) break;
    afterId = data.nextAfterId;
  }

  const applied = await applySnapshot(definition.name, docs);
  await writeState({
    [`pull.${definition.name}`]: { etag, lastPulledAt: new Date(), count: docs.length },
  });
  return { count: docs.length, ...applied };
}

async function reconcileProducts() {
  const cloudVersions = new Map();
  let afterId = null;
  do {
    const data = await cloudRequest('/api/sync/pull', {
      body: { entity: 'products', mode: 'manifest', ...(afterId ? { afterId: String(afterId) } : {}) },
      timeoutMs: 60 * 1000,
    });
    for (const entry of data?.entries || []) cloudVersions.set(String(entry._id), entry.updatedAt ?? null);
    afterId = data?.nextAfterId || null;
  } while (afterId);

  const locals = await localProductVersions();
  const time = (value) => (value ? new Date(value).getTime() : null);

  const removedIds = cloudVersions.size > 0
    ? locals.filter((doc) => !cloudVersions.has(String(doc._id))).map((doc) => doc._id)
    : [];
  const localById = new Map(locals.map((doc) => [String(doc._id), doc]));
  const staleIds = [...cloudVersions.entries()]
    .filter(([id, updatedAt]) => !localById.has(id) || time(localById.get(id).updatedAt) !== time(updatedAt))
    .map(([id]) => id);

  const removed = await deleteLocalProducts(removedIds);
  let refreshed = 0;
  for (let index = 0; index < staleIds.length; index += 500) {
    const data = await cloudRequest('/api/sync/pull', {
      body: { entity: 'products', mode: 'ids', ids: staleIds.slice(index, index + 500) },
      timeoutMs: 60 * 1000,
    });
    await applyProductPage(data?.docs || [], { force: true });
    refreshed += data?.docs?.length || 0;
  }
  return { removed, refreshed };
}

async function pullProducts(definition, cursor, deadline) {
  const cursorKey = `pull.${definition.name}`;
  let since = cursor.since ? new Date(cursor.since) : null;
  let afterId = cursor.afterId || null;
  let runStartedAt = cursor.runStartedAt ? new Date(cursor.runStartedAt) : null;
  let count = 0;

  const saveProgress = (extra = {}) =>
    writeState({
      [cursorKey]: {
        ...cursor,
        since,
        afterId: afterId ? String(afterId) : null,
        runStartedAt,
        ...extra,
      },
    });

  for (;;) {
    if (Date.now() > deadline) {
      await saveProgress();
      return { count, incomplete: true };
    }

    const data = await cloudRequest('/api/sync/pull', {
      body: {
        entity: 'products',
        mode: 'changes',
        ...(since ? { since: since.toISOString() } : {}),
        ...(afterId ? { afterId: String(afterId) } : {}),
        limit: 500,
      },
      timeoutMs: 60 * 1000,
    });
    if (!runStartedAt) runStartedAt = new Date(data.serverTime);

    // A sale made while pulling must reach the cloud before products are overwritten
    if (await hasUnsentSales()) {
      await saveProgress();
      return { count, incomplete: true, reason: 'sales-waiting-to-sync' };
    }

    await applyProductPage(data?.docs || []);
    count += data?.docs?.length || 0;

    if (data?.hasMore && data?.next) {
      since = data.next.since ? new Date(data.next.since) : since;
      afterId = data.next.afterId;
      await saveProgress();
      continue;
    }

    // Caught up. Next run starts slightly before this one began, to absorb clock differences
    since = new Date(runStartedAt.getTime() - PRODUCT_CURSOR_OVERLAP_MS);
    afterId = null;
    runStartedAt = null;

    let reconciled = null;
    const lastManifestAt = cursor.lastManifestAt ? new Date(cursor.lastManifestAt).getTime() : 0;
    let manifestAt = cursor.lastManifestAt || null;
    if (Date.now() - lastManifestAt >= definition.manifestIntervalMs && !(await hasUnsentSales())) {
      reconciled = await reconcileProducts();
      manifestAt = new Date();
    }

    await saveProgress({ lastPulledAt: new Date(), lastManifestAt: manifestAt });
    return { count, reconciled };
  }
}

async function pullDue(state, { force, deadline }) {
  const results = {};
  let completedAll = true;
  const rt = runtime();

  for (const definition of PULL_ENTITIES) {
    const cursor = state.pull?.[definition.name] || {};
    const lastPulledAt = cursor.lastPulledAt ? new Date(cursor.lastPulledAt).getTime() : 0;
    const due = force || !lastPulledAt || Date.now() - lastPulledAt >= definition.intervalMs;
    if (!due) continue;

    if (Date.now() > deadline) {
      completedAll = false;
      break;
    }

    rt.progress = { step: 'pull', entity: definition.name };
    if (definition.strategy === 'snapshot') {
      results[definition.name] = await pullSnapshotEntity(definition, cursor);
    } else if (await hasUnsentSales()) {
      results[definition.name] = { skipped: 'sales-waiting-to-sync' };
      if (!lastPulledAt) completedAll = false;
    } else {
      results[definition.name] = await pullProducts(definition, cursor, deadline);
      if (results[definition.name].incomplete) completedAll = false;
    }
  }

  rt.progress = null;
  return { results, completedAll };
}

/* ------------------------------------------------------------------ sweep */

async function sweepUnrecordedChanges() {
  const rt = runtime();
  if (Date.now() - rt.lastSweepAt < SWEEP_INTERVAL_MS) return 0;
  rt.lastSweepAt = Date.now();

  const windowStart = mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - SWEEP_WINDOW_MS) / 1000));
  let queued = 0;

  for (const [entity, collection] of Object.entries(LOCALLY_AUTHORED)) {
    const ids = (await collection().find({ _id: { $gte: windowStart } }, { projection: { _id: 1 } }).toArray())
      .map((doc) => String(doc._id));
    if (ids.length === 0) continue;

    const known = new Set(await SyncOutbox.distinct('entityId', { entity, entityId: { $in: ids } }));
    for (const id of ids.filter((value) => !known.has(value))) {
      await recordLocalChange(entity, id, { fields: ['*'] });
      queued += 1;
    }
  }

  if (queued > 0) console.warn(`[sync] Re-queued ${queued} local record(s) that had not been recorded for sync`);
  return queued;
}

/* ------------------------------------------------------------------ cycle */

async function runCycle({ force, pushOnly }) {
  const rt = runtime();
  await mongooseConnect();

  if (!isDesktopEnrolled()) {
    rt.phase = 'not_enrolled';
    return { skipped: 'not-enrolled' };
  }

  const startedAt = Date.now();
  await recoverClaims();
  await sweepUnrecordedChanges();

  rt.phase = 'checking';
  const reachable = await pingCloud();
  if (!reachable) {
    rt.offlineStreak += 1;
    rt.nextAttemptAt = Date.now() + OFFLINE_BACKOFF_MS[Math.min(rt.offlineStreak - 1, OFFLINE_BACKOFF_MS.length - 1)];
    rt.phase = 'offline';
    await writeState({ cloudReachable: false, lastCheckAt: new Date() });
    return { offline: true };
  }

  rt.offlineStreak = 0;
  await writeState({ cloudReachable: true, lastCheckAt: new Date() });
  rt.phase = 'syncing';

  try {
    rt.progress = { step: 'push' };
    const push = await pushPending(startedAt + CYCLE_BUDGET_MS);

    let pull = null;
    const state = await readState();
    if (!pushOnly) {
      pull = await pullDue(state, {
        force: force || !state.initialSyncComplete,
        deadline: startedAt + CYCLE_BUDGET_MS * 2,
      });
    }

    const set = { lastSuccessAt: new Date(), lastError: '', lastErrorCode: '', lastErrorAt: null };
    if (pull && !state.initialSyncComplete && pull.completedAll) {
      set.initialSyncComplete = true;
      set.initialSyncAt = new Date();
    }
    await writeState(set);

    rt.phase = 'idle';
    rt.nextAttemptAt = 0;
    return { push, pull };
  } catch (error) {
    const isAuth = error instanceof CloudRequestError && (error.status === 401 || error.status === 403);
    const isNetwork = Boolean(error?.network);
    rt.phase = isAuth ? 'auth_error' : isNetwork ? 'offline' : 'error';
    rt.nextAttemptAt = Date.now() + (isAuth ? 5 * 60 * 1000 : isNetwork ? 30 * 1000 : 60 * 1000);

    console.error('[sync] Cycle failed:', error?.message || error);
    await writeState({
      lastError: String(error?.message || 'Sync failed').slice(0, 500),
      lastErrorCode: error?.code || '',
      lastErrorAt: new Date(),
      ...(isNetwork ? { cloudReachable: false } : {}),
    });
    return { error: error?.message };
  } finally {
    rt.progress = null;
  }
}

/**
 * Starts a sync cycle, or joins the one already running.
 * force: ignore offline backoff and pull everything now. pushOnly: skip pulls.
 */
export function runSyncCycle({ reason = 'scheduled', force = false, pushOnly = false } = {}) {
  const rt = runtime();
  if (!isDesktopServer()) return Promise.resolve({ skipped: 'not-desktop' });
  if (rt.running) {
    rt.rerun = true;
    return rt.running;
  }
  if (!force && Date.now() < rt.nextAttemptAt) return Promise.resolve({ skipped: 'backoff' });

  rt.running = runCycle({ reason, force, pushOnly }).finally(() => {
    rt.running = null;
    if (rt.rerun) {
      rt.rerun = false;
      setTimeout(() => runSyncCycle({ reason: 'rerun' }).catch(() => {}), 1000).unref?.();
    }
  });
  return rt.running;
}

registerSyncRunner(runSyncCycle);

/**
 * Makes sure one record has reached the cloud (used before cloud actions that depend on it, such
 * as completing an online order against this till). Resolves { ok } once confirmed or given up.
 */
export async function flushRecord(entity, entityId) {
  if (!isDesktopEnrolled() || !entityId) return { ok: false };
  await mongooseConnect();

  const filter = { entity, entityId: String(entityId) };
  const unresolved = () => SyncOutbox.countDocuments({ ...filter, status: { $in: UNRESOLVED_STATUSES } });

  if ((await unresolved()) === 0) {
    if ((await SyncOutbox.countDocuments({ ...filter, status: 'synced' })) > 0) return { ok: true };
    await recordLocalChange(entity, entityId, { fields: ['*'] });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rt = runtime();
    if (rt.running) await rt.running.catch(() => {});
    await SyncOutbox.collection.updateMany({ ...filter, status: 'pending' }, { $set: { nextRetryAt: new Date(0) } });
    await runSyncCycle({ reason: 'flush', force: true, pushOnly: true });
    if ((await unresolved()) === 0) return { ok: true };
  }
  return { ok: false };
}

/** Sends failed or conflicted entries again (after the cause has been fixed in the cloud). */
export async function retryEntries(ids = []) {
  await mongooseConnect();
  const objectIds = ids.map(toObjectId).filter(Boolean);
  const entries = await SyncOutbox.find({ _id: { $in: objectIds }, status: { $in: ['failed', 'conflict'] } }).lean();

  for (const entry of entries) {
    try {
      await SyncOutbox.collection.updateOne(
        { _id: entry._id },
        { $set: { status: 'pending', attempts: 0, nextRetryAt: new Date(0), error: '' } }
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
      await SyncOutbox.collection.deleteOne({ _id: entry._id });
    }
  }

  runSyncCycle({ reason: 'retry', force: true }).catch(() => {});
  return entries.length;
}

export async function getSyncStatus() {
  const rt = runtime();
  const config = getDesktopConfig();
  const enrolled = isDesktopEnrolled();

  await mongooseConnect();
  const [state, grouped] = await Promise.all([
    readState(),
    SyncOutbox.aggregate([
      { $match: { status: { $in: UNRESOLVED_STATUSES } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);
  const counts = Object.fromEntries(grouped.map((row) => [row._id, row.count]));
  const pending = (counts.pending || 0) + (counts.processing || 0);
  const failed = counts.failed || 0;
  const conflicts = counts.conflict || 0;

  let phase;
  if (!enrolled) phase = 'not_enrolled';
  else if (rt.phase === 'auth_error') phase = 'auth_error';
  else if (rt.running && rt.phase === 'syncing') phase = 'syncing';
  else if (state.cloudReachable === false) phase = 'offline';
  else if (state.cloudReachable === undefined) phase = 'checking';
  else if (failed > 0 || conflicts > 0 || state.lastError) phase = 'error';
  else if (pending === 0) phase = 'synced';
  else phase = 'online';

  const pull = Object.fromEntries(
    PULL_ENTITIES.map(({ name }) => [name, state.pull?.[name]?.lastPulledAt || null])
  );

  let cloudHost = '';
  try {
    cloudHost = config.cloudUrl ? new URL(config.cloudUrl).host : '';
  } catch {
    cloudHost = config.cloudUrl;
  }

  return {
    runtime: 'desktop',
    enrolled,
    installationId: config.installationId,
    installationName: config.installationName,
    cloudHost,
    phase,
    cloudReachable: state.cloudReachable ?? null,
    pending,
    failed,
    conflicts,
    initialSyncComplete: Boolean(state.initialSyncComplete),
    progress: rt.progress,
    lastCheckAt: state.lastCheckAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
    lastError: state.lastError || '',
    lastErrorAt: state.lastErrorAt || null,
    pull,
  };
}
