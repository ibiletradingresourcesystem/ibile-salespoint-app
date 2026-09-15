/**
 * Desktop only: moves data between this computer's local MongoDB and the customer's cloud MongoDB,
 * over a direct database connection (no Vercel or other server in between).
 *
 * One cycle:
 *   1. connect to the cloud database and confirm it answers; stop if this installation was revoked
 *   2. push the outbox, oldest and most-depended-on first, in batches
 *   3. pull cloud data that is due (whole small collections, products by updatedAt cursor)
 *
 * The till never waits for this. Sales are committed locally first. Cycles start automatically a
 * few seconds after a local change, every 30 s while changes are waiting or data is due, and
 * immediately on Sync Products / Sync now / Close Till. While the cloud cannot be reached, automatic
 * attempts back off (up to 5 minutes). Everything needed to resume (outbox, cursors) is in MongoDB.
 */

import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import SyncOutbox from '@/src/models/SyncOutbox';
import { Transaction } from '@/src/models/Transactions';
import Till from '@/src/models/Till';
import EndOfDayReport from '@/src/models/EndOfDayReport';
import Customer from '@/src/models/Customer';
import { modelsFor } from '@/src/lib/dataModels';
import { PULL_ENTITIES, PUSH_ENTITIES } from '@/src/lib/sync/entities';
import { toObjectId } from '@/src/lib/sync/ejson';
import { applyPushOps } from '@/src/lib/sync/cloudApply';
import { readProductChanges, readProductManifest, readProductsByIds, readSnapshot } from '@/src/lib/sync/cloudPull';
import { cloudDatabaseHost, getDesktopConfig, isDesktopEnrolled, isDesktopServer } from '@/src/lib/runtime';
import { CloudDatabaseError, classifyCloudError, describeCloudError, pingCloudDatabase } from '@/src/lib/desktop/cloudDb';
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
const BACKGROUND_TICK_MS = 30 * 1000;
const MAX_OFFLINE_BACKOFF_MS = 5 * 60 * 1000;
const PRODUCT_CURSOR_OVERLAP_MS = 2 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SWEEP_WINDOW_MS = 25 * 24 * 60 * 60 * 1000;
const INSTALLATIONS = 'syncinstallations';

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
      phase: 'idle',
      progress: null,
      nextAttemptAt: 0,
      offlineStreak: 0,
      recoveredClaims: false,
      lastSweepAt: 0,
      loopStarted: false,
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

async function buildOp(entry) {
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

async function pushPending(models, installation, { deadline, force }) {
  const summary = { sent: 0, synced: 0, retry: 0, failed: 0, conflict: 0 };
  // Each entry is tried at most once per cycle; staff-started syncs also retry entries in backoff
  const attempted = [];

  while (Date.now() < deadline) {
    const now = new Date();
    const candidates = await SyncOutbox.find({
      status: 'pending',
      _id: { $nin: attempted },
      ...(force ? {} : { nextRetryAt: { $lte: now } }),
    })
      .sort({ priority: 1, createdAt: 1 })
      .limit(PUSH_BATCH_SIZE)
      .lean();
    if (candidates.length === 0) break;

    const claimed = [];
    for (const entry of candidates) {
      attempted.push(entry._id);
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
      const op = await buildOp(entry);
      if (op) {
        sendable.push(entry);
        ops.push(op);
      } else {
        await markSynced(entry, { note: 'Record no longer exists on this computer' });
      }
    }
    if (ops.length === 0) continue;

    const results = new Map((await applyPushOps(installation, ops, models)).map((result) => [result.opId, result]));
    summary.sent += ops.length;
    let lostConnection = null;

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
          if (result?.error && classifyCloudError(result.error) !== 'error') lostConnection = result.error;
          await releaseForRetry(entry, result?.error ? describeCloudError(result.error) : result?.message || 'Not confirmed by the cloud');
          summary.retry += 1;
      }
    }

    // The connection dropped part-way: stop here; the entries are safely back in the queue
    if (lostConnection) {
      throw new CloudDatabaseError(describeCloudError(lostConnection), { kind: classifyCloudError(lostConnection), cause: lostConnection });
    }
  }

  return summary;
}

/* ------------------------------------------------------------------ pull */

const hasUnsentSales = async () =>
  (await SyncOutbox.countDocuments({ entity: 'transactions', status: { $in: OPEN_STATUSES } })) > 0;

async function pullSnapshotEntity(definition, cursor, models) {
  const snapshot = await readSnapshot(definition.name, models);
  if (cursor.etag && cursor.etag === snapshot.etag) {
    await writeState({ [`pull.${definition.name}.lastPulledAt`]: new Date() });
    return { unchanged: true };
  }

  const applied = await applySnapshot(definition.name, await snapshot.prepare());
  await writeState({
    [`pull.${definition.name}`]: { etag: snapshot.etag, lastPulledAt: new Date(), count: snapshot.docs.length },
  });
  return { count: snapshot.docs.length, ...applied };
}

async function cloudClock(models) {
  try {
    const hello = await models.connection.db.admin().command({ hello: 1 });
    if (hello?.localTime instanceof Date) return hello.localTime;
  } catch {
    // fall back to this computer's clock
  }
  return new Date();
}

async function reconcileProducts(models) {
  const manifest = await readProductManifest(models);
  const cloudVersions = new Map(manifest.map((entry) => [String(entry._id), entry.updatedAt ?? null]));
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
  for (let index = 0; index < staleIds.length; index += 500) {
    await applyProductPage(await readProductsByIds(models, staleIds.slice(index, index + 500)), { force: true });
  }
  return { removed, refreshed: staleIds.length };
}

async function pullProducts(definition, cursor, models, deadline) {
  const cursorKey = `pull.${definition.name}`;
  let since = cursor.since ? new Date(cursor.since) : null;
  let afterId = cursor.afterId || null;
  let runStartedAt = cursor.runStartedAt ? new Date(cursor.runStartedAt) : null;
  let count = 0;

  const saveProgress = (extra = {}) =>
    writeState({
      [cursorKey]: { ...cursor, since, afterId: afterId ? String(afterId) : null, runStartedAt, ...extra },
    });

  if (!runStartedAt) runStartedAt = await cloudClock(models);

  for (;;) {
    if (Date.now() > deadline) {
      await saveProgress();
      return { count, incomplete: true };
    }

    const page = await readProductChanges(models, { since, afterId });

    // A sale made while pulling must reach the cloud before products are overwritten
    if (await hasUnsentSales()) {
      await saveProgress();
      return { count, incomplete: true, reason: 'sales-waiting-to-sync' };
    }

    await applyProductPage(page.docs);
    count += page.docs.length;

    if (page.hasMore && page.next) {
      since = page.next.since ? new Date(page.next.since) : since;
      afterId = page.next.afterId;
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
      reconciled = await reconcileProducts(models);
      manifestAt = new Date();
    }

    await saveProgress({ lastPulledAt: new Date(), lastManifestAt: manifestAt });
    return { count, reconciled };
  }
}

const isPullDue = (definition, cursor) => {
  const lastPulledAt = cursor.lastPulledAt ? new Date(cursor.lastPulledAt).getTime() : 0;
  return !lastPulledAt || Date.now() - lastPulledAt >= definition.intervalMs;
};

async function pullData(state, models, { force, deadline }) {
  const results = {};
  let completedAll = true;
  const rt = runtime();

  for (const definition of PULL_ENTITIES) {
    const cursor = state.pull?.[definition.name] || {};
    if (!force && !isPullDue(definition, cursor)) continue;
    if (Date.now() > deadline) {
      completedAll = false;
      break;
    }

    rt.progress = { step: 'pull', entity: definition.name };
    if (definition.strategy === 'snapshot') {
      results[definition.name] = await pullSnapshotEntity(definition, cursor, models);
    } else if (await hasUnsentSales()) {
      results[definition.name] = { skipped: 'sales-waiting-to-sync' };
      if (!cursor.lastPulledAt) completedAll = false;
    } else {
      results[definition.name] = await pullProducts(definition, cursor, models, deadline);
      if (results[definition.name].incomplete) completedAll = false;
    }
  }

  rt.progress = null;
  return { results, completedAll };
}

/* ------------------------------------------------------------------ installation */

/** Records this installation in the cloud and stops syncing if a manager revoked it there. */
async function checkInstallation(models) {
  const { installationId, installationName, appVersion } = getDesktopConfig();
  const installations = models.connection.collection(INSTALLATIONS);
  const record = await installations.findOne({ installationId }, { projection: { revokedAt: 1 } });
  if (record?.revokedAt) {
    throw new CloudDatabaseError('This POS has been disconnected from the cloud by a manager. Set it up again from the app menu.', { kind: 'auth' });
  }
  await installations.updateOne(
    { installationId },
    {
      $set: { lastSeenAt: new Date(), ...(appVersion ? { appVersion } : {}) },
      $setOnInsert: { installationId, name: installationName, enrolledAt: new Date(), revokedAt: null },
    },
    { upsert: true }
  );
  return { installationId };
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
  rt.phase = 'syncing';

  try {
    rt.progress = { step: 'connect' };
    const models = modelsFor(await pingCloudDatabase());
    const installation = await checkInstallation(models);

    rt.progress = { step: 'push' };
    const push = await pushPending(models, installation, { deadline: startedAt + CYCLE_BUDGET_MS, force });

    let pull = null;
    const state = await readState();
    if (!pushOnly) {
      pull = await pullData(state, models, {
        force: force || !state.initialSyncComplete,
        deadline: startedAt + CYCLE_BUDGET_MS * 2,
      });
    }

    const set = {
      cloudReachable: true,
      lastCheckAt: new Date(),
      lastSuccessAt: new Date(),
      lastError: '',
      lastErrorCode: '',
      lastErrorAt: null,
    };
    if (pull && !state.initialSyncComplete && pull.completedAll) {
      set.initialSyncComplete = true;
      set.initialSyncAt = new Date();
    }
    await writeState(set);

    rt.phase = 'idle';
    rt.offlineStreak = 0;
    rt.nextAttemptAt = 0;
    return { push, pull };
  } catch (error) {
    const kind = classifyCloudError(error);
    const message = error instanceof CloudDatabaseError ? error.message : describeCloudError(error);
    rt.phase = kind === 'auth' ? 'auth_error' : kind === 'offline' ? 'offline' : 'error';

    if (kind === 'offline') {
      rt.offlineStreak += 1;
      rt.nextAttemptAt = Date.now() + Math.min(MAX_OFFLINE_BACKOFF_MS, 30 * 1000 * 2 ** (rt.offlineStreak - 1));
    } else {
      rt.nextAttemptAt = Date.now() + (kind === 'auth' ? MAX_OFFLINE_BACKOFF_MS : 60 * 1000);
    }

    if (kind === 'error') console.error('[sync] Cycle failed:', error?.message || error);
    await writeState({
      cloudReachable: kind !== 'offline',
      lastCheckAt: new Date(),
      lastError: message.slice(0, 500),
      lastErrorCode: kind,
      lastErrorAt: new Date(),
    });
    return { error: message, offline: kind === 'offline' };
  } finally {
    rt.progress = null;
  }
}

/**
 * Runs a sync cycle now, or joins the one already running.
 * force: staff asked for it — ignore offline backoff, retry everything waiting, pull all data.
 * pushOnly: send changes without pulling.
 */
export function runSyncCycle({ force = false, pushOnly = false } = {}) {
  const rt = runtime();
  if (!isDesktopServer()) return Promise.resolve({ skipped: 'not-desktop' });
  if (rt.running) return rt.running;
  if (!force && Date.now() < rt.nextAttemptAt) return Promise.resolve({ skipped: 'waiting-to-retry' });

  rt.running = runCycle({ force, pushOnly }).finally(() => {
    rt.running = null;
  });
  return rt.running;
}

/* ------------------------------------------------------------------ automatic sync */

async function backgroundTick() {
  const rt = runtime();
  if (!isDesktopEnrolled() || rt.running || Date.now() < rt.nextAttemptAt) return;
  await mongooseConnect();

  const pendingDue = await SyncOutbox.countDocuments({ status: 'pending', nextRetryAt: { $lte: new Date() } });
  const state = await readState();
  const pullDue = PULL_ENTITIES.some((definition) => isPullDue(definition, state.pull?.[definition.name] || {}));
  if (pendingDue === 0 && !pullDue) return;

  await runSyncCycle({ pushOnly: !pullDue });
}

function startBackgroundSync() {
  const rt = runtime();
  if (rt.loopStarted || !isDesktopServer()) return;
  rt.loopStarted = true;
  const timer = setInterval(() => backgroundTick().catch(() => {}), BACKGROUND_TICK_MS);
  timer.unref?.();
}

// A local change (sale, till, customer) asks for a push a few seconds later
registerSyncRunner(() => runSyncCycle({ pushOnly: true }));
startBackgroundSync();

/* ------------------------------------------------------------------ helpers for other modules */

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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rt = runtime();
    if (rt.running) await rt.running.catch(() => {});
    const result = await runSyncCycle({ force: true, pushOnly: true });
    if ((await unresolved()) === 0) return { ok: true };
    if (result?.error) break;
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

  runSyncCycle({ force: true }).catch(() => {});
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
  else if (rt.running && rt.phase === 'syncing') phase = 'syncing';
  else if (rt.phase === 'auth_error' || state.lastErrorCode === 'auth') phase = 'auth_error';
  else if (state.cloudReachable === false) phase = 'offline';
  else if (failed > 0 || conflicts > 0 || state.lastError) phase = 'error';
  else if (pending === 0 && state.lastSuccessAt) phase = 'synced';
  else phase = 'online';

  const pull = Object.fromEntries(
    PULL_ENTITIES.map(({ name }) => [name, state.pull?.[name]?.lastPulledAt || null])
  );

  return {
    runtime: 'desktop',
    enrolled,
    installationId: config.installationId,
    installationName: config.installationName,
    cloudHost: cloudDatabaseHost(),
    phase,
    cloudReachable: state.cloudReachable ?? null,
    pending,
    failed,
    conflicts,
    initialSyncComplete: Boolean(state.initialSyncComplete),
    progress: rt.progress,
    nextAttemptAt: rt.nextAttemptAt ? new Date(rt.nextAttemptAt) : null,
    lastCheckAt: state.lastCheckAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
    lastError: state.lastError || '',
    lastErrorAt: state.lastErrorAt || null,
    pull,
  };
}
