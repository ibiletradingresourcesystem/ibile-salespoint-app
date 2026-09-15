/**
 * GET /api/desktop/status  (desktop app only)
 * Connection and sync state for the POS status indicator, the setup screen and the Electron shell.
 */

import { getSyncStatus } from '@/src/lib/desktop/syncEngine';
import { requireDesktopRuntime } from '@/src/lib/desktop/requestAuth';

export default async function handler(req, res) {
  if (!requireDesktopRuntime(res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store');
  try {
    const status = await getSyncStatus();
    return res.status(200).json({ success: true, ...status });
  } catch (error) {
    return res.status(503).json({
      success: false,
      runtime: 'desktop',
      phase: 'error',
      lastError: `Local database unavailable: ${error?.message || error}`,
    });
  }
}
