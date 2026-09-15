/**
 * POST /api/sync/push
 *
 * Receives a batch of local changes from a desktop installation and applies them.
 * Body (Extended JSON): { ops: [{ opId, entity, entityId, rev, fields?, doc?, payload? }] }
 * Response: { results: [{ opId, status: applied|duplicate|conflict|rejected|error, message?, cloudId? }] }
 *
 * "error" results are safe to retry; the other statuses are final for that revision.
 */

import SyncInstallation from '@/src/models/SyncInstallation';
import { requireInstallation } from '@/src/lib/sync/installationAuth';
import { applyPushOps } from '@/src/lib/sync/cloudApply';
import { fromWireObject, sendWire } from '@/src/lib/sync/ejson';

const MAX_OPS_PER_REQUEST = 50;

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const installation = await requireInstallation(req, res);
  if (!installation) return;

  let ops;
  try {
    ops = fromWireObject(req.body || {}).ops;
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Request body is not valid Extended JSON' });
  }

  if (!Array.isArray(ops) || ops.length === 0) {
    return res.status(400).json({ success: false, message: 'ops must be a non-empty array' });
  }
  if (ops.length > MAX_OPS_PER_REQUEST) {
    return res.status(413).json({ success: false, message: `Send at most ${MAX_OPS_PER_REQUEST} changes per request` });
  }

  try {
    const results = await applyPushOps(installation, ops);
    SyncInstallation.updateOne({ _id: installation._id }, { $set: { lastPushAt: new Date() } }).catch(() => {});
    return sendWire(res, 200, { success: true, results, serverTime: new Date() });
  } catch (error) {
    console.error('[sync] Push failed:', error);
    return res.status(500).json({ success: false, message: 'Could not apply changes' });
  }
}
