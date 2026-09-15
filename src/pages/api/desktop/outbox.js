/**
 * GET  /api/desktop/outbox?status=failed|conflict|pending  (desktop app only, logged-in staff)
 * POST /api/desktop/outbox { action: "retry", ids: [...] }
 *
 * Lets staff see changes that could not be sent to the cloud and send them again once fixed.
 */

import { mongooseConnect } from '@/src/lib/mongoose';
import SyncOutbox from '@/src/models/SyncOutbox';
import { retryEntries } from '@/src/lib/desktop/syncEngine';
import { isInternalRequest, requireDesktopRuntime, sessionStaffId } from '@/src/lib/desktop/requestAuth';

const LISTABLE = new Set(['pending', 'processing', 'failed', 'conflict']);

export default async function handler(req, res) {
  if (!requireDesktopRuntime(res)) return;
  if (!isInternalRequest(req) && !sessionStaffId(req)) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  if (req.method === 'GET') {
    await mongooseConnect();
    const requested = String(req.query.status || 'failed,conflict').split(',').filter((value) => LISTABLE.has(value));
    const entries = await SyncOutbox.find({ status: { $in: requested } })
      .select('entity entityId status attempts error nextRetryAt lastAttemptAt createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    return res.status(200).json({ success: true, entries });
  }

  if (req.method === 'POST') {
    const { action, ids } = req.body || {};
    if (action !== 'retry' || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide action "retry" and ids' });
    }
    const retried = await retryEntries(ids.slice(0, 200));
    return res.status(200).json({ success: true, retried });
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
