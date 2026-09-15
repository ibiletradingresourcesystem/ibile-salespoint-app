/**
 * Desktop only: who may call /api/desktop/* (the middleware lets these routes through).
 *   - the Electron main process, with the per-launch internal token
 *   - a logged-in staff member, with the normal session cookie
 */

import crypto from 'crypto';
import { getDesktopConfig, isDesktopServer } from '@/src/lib/runtime';
import { verifySessionToken } from '@/src/lib/sessionAuth';

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const isInternalRequest = (req) =>
  safeEqual(req.headers['x-desktop-internal-token'], getDesktopConfig().internalToken);

export const sessionStaffId = (req) => verifySessionToken(req.cookies?.['pos-session'])?.staffId || null;

/** Sends 404 on the cloud deployment, where these routes do not exist. */
export function requireDesktopRuntime(res) {
  if (isDesktopServer()) return true;
  res.status(404).json({ success: false, message: 'Not found' });
  return false;
}
