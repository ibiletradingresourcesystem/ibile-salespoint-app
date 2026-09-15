/**
 * GET  /api/sync-admin/installations          list desktop installations (manager/admin session)
 * POST /api/sync-admin/installations          { installationId, action: "revoke" }
 *
 * Revoking stops an installation's token from syncing immediately. Sales already stored on that
 * computer stay there until it is enrolled again, after which they sync normally.
 */

import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import { Staff } from '@/src/models/Staff';
import SyncInstallation from '@/src/models/SyncInstallation';
import { normalizeStaffRole } from '@/src/lib/posPermissions';

async function requireManager(req, res) {
  const staffId = String(req.headers['x-auth-staff-id'] || '');
  if (!mongoose.Types.ObjectId.isValid(staffId)) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return null;
  }
  const staff = await Staff.findById(staffId).select('_id name role isActive').lean();
  if (!staff || staff.isActive === false || !['admin', 'manager'].includes(normalizeStaffRole(staff.role))) {
    res.status(403).json({ success: false, message: 'Only a manager or admin can manage installations' });
    return null;
  }
  return staff;
}

export default async function handler(req, res) {
  await mongooseConnect();
  const staff = await requireManager(req, res);
  if (!staff) return;

  if (req.method === 'GET') {
    const installations = await SyncInstallation.find({})
      .select('-tokenHash')
      .sort({ lastSeenAt: -1 })
      .lean();
    return res.status(200).json({ success: true, installations });
  }

  if (req.method === 'POST') {
    const { installationId, action } = req.body || {};
    if (action !== 'revoke' || !installationId) {
      return res.status(400).json({ success: false, message: 'Provide installationId and action "revoke"' });
    }
    const result = await SyncInstallation.updateOne(
      { installationId: String(installationId) },
      { $set: { revokedAt: new Date(), revokedByStaffId: staff._id } }
    );
    if (!result.matchedCount) {
      return res.status(404).json({ success: false, message: 'Installation not found' });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
