/**
 * POST /api/desktop/verify-manager  (desktop app only, Electron main process only)
 * Confirms a manager or admin passcode against the local staff records before the app restores a
 * backup or disconnects from the cloud database. Body: { staffId, pin }
 */

import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import { Staff } from '@/src/models/Staff';
import { verifyPin } from '@/src/lib/staffPin';
import { normalizeStaffRole } from '@/src/lib/posPermissions';
import { isInternalRequest, requireDesktopRuntime } from '@/src/lib/desktop/requestAuth';

const MANAGER_ROLES = new Set(['admin', 'manager']);

export default async function handler(req, res) {
  if (!requireDesktopRuntime(res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  if (!isInternalRequest(req)) return res.status(401).json({ ok: false, message: 'Not allowed' });

  const staffId = String(req.body?.staffId || '');
  const pin = String(req.body?.pin || '');
  if (!mongoose.Types.ObjectId.isValid(staffId) || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ ok: false, message: 'Select a manager and enter their 4-digit passcode.' });
  }

  await mongooseConnect();
  const staffMember = await Staff.findById(staffId).lean();
  if (!staffMember || staffMember.isActive === false || !(await verifyPin(staffMember, pin))) {
    return res.status(401).json({ ok: false, message: 'The manager or passcode is not correct.' });
  }
  if (!MANAGER_ROLES.has(normalizeStaffRole(staffMember.role))) {
    return res.status(403).json({ ok: false, message: 'Only a manager or admin can do this.' });
  }
  return res.status(200).json({ ok: true, name: staffMember.name });
}
