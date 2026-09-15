/**
 * POST /api/sync/pull
 *
 * Sends a desktop installation the data it needs from the cloud.
 * Body: { entity, mode, etag?, afterId?, since?, limit?, ids? }
 *   mode "snapshot"  store, systemthemes, tenders, categories, promotions, staff, customers
 *   mode "changes"   products by updatedAt cursor
 *   mode "manifest"  product ids + updatedAt (deleted/missed product detection)
 *   mode "ids"       specific products
 */

import SyncInstallation from '@/src/models/SyncInstallation';
import { requireInstallation } from '@/src/lib/sync/installationAuth';
import {
  isSnapshotEntity,
  pullProductChanges,
  pullProductManifest,
  pullProductsByIds,
  pullSnapshot,
} from '@/src/lib/sync/cloudPull';
import { sendWire } from '@/src/lib/sync/ejson';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const installation = await requireInstallation(req, res);
  if (!installation) return;

  const { entity, mode, etag, afterId, since, limit, ids } = req.body || {};

  try {
    let payload;
    if (mode === 'snapshot' && isSnapshotEntity(entity)) {
      payload = await pullSnapshot(entity, { etag, afterId, limit });
    } else if (entity === 'products' && mode === 'changes') {
      payload = await pullProductChanges({ since, afterId, limit });
    } else if (entity === 'products' && mode === 'manifest') {
      payload = await pullProductManifest({ afterId, limit });
    } else if (entity === 'products' && mode === 'ids') {
      payload = await pullProductsByIds(Array.isArray(ids) ? ids : []);
    } else {
      return res.status(400).json({ success: false, message: `Unsupported pull: ${entity} / ${mode}` });
    }

    SyncInstallation.updateOne({ _id: installation._id }, { $set: { lastPullAt: new Date() } }).catch(() => {});
    return sendWire(res, 200, { success: true, ...payload });
  } catch (error) {
    console.error(`[sync] Pull failed for ${entity}/${mode}:`, error);
    return res.status(500).json({ success: false, message: 'Could not load data' });
  }
}
