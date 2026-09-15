/**
 * POST /api/desktop/sync  (desktop app only)
 * Runs a sync cycle: the only way the desktop contacts the cloud sync API. Called by Sync Products
 * and Sync now (staff session), and by the app menu and first-run setup (internal token).
 * Body: { wait?: boolean }
 */

import { getSyncStatus, runSyncCycle } from '@/src/lib/desktop/syncEngine';
import { isInternalRequest, requireDesktopRuntime, sessionStaffId } from '@/src/lib/desktop/requestAuth';

export default async function handler(req, res) {
  if (!requireDesktopRuntime(res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  if (!isInternalRequest(req) && !sessionStaffId(req)) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const { wait = false } = req.body || {};
  const cycle = runSyncCycle();

  if (!wait) {
    cycle.catch(() => {});
    return res.status(202).json({ success: true, started: true });
  }

  const result = await cycle.catch((error) => ({ error: error?.message }));
  return res.status(200).json({ success: !result?.error, result, status: await getSyncStatus() });
}
