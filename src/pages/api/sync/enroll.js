/**
 * POST /api/sync/enroll
 *
 * Registers a desktop installation with the cloud. A manager or admin confirms it with their
 * existing staff passcode; the installation receives a secret token (shown only in this response)
 * for all later /api/sync calls. Enrolling an existing installation again issues a new token.
 *
 * Body: { installationId, installationName, staffId, pin, locationId, appVersion, platform }
 */

import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import { Staff } from '@/src/models/Staff';
import Store from '@/src/models/Store';
import SyncInstallation from '@/src/models/SyncInstallation';
import { verifyPin } from '@/src/lib/staffPin';
import { normalizeStaffRole } from '@/src/lib/posPermissions';
import { sanitizeString } from '@/src/lib/apiValidation';
import {
  INSTALLATION_ID_PATTERN,
  createInstallationToken,
  hashInstallationToken,
} from '@/src/lib/sync/installationAuth';

const ENROLLING_ROLES = new Set(['admin', 'manager']);

const fail = (res, status, code, message) => res.status(status).json({ success: false, code, message });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  const body = req.body || {};
  const installationId = String(body.installationId || '').trim();
  const installationName = sanitizeString(String(body.installationName || '')).slice(0, 80);
  const staffId = sanitizeString(String(body.staffId || ''));
  const pin = String(body.pin || '').trim();
  const locationId = sanitizeString(String(body.locationId || ''));

  if (!INSTALLATION_ID_PATTERN.test(installationId)) {
    return fail(res, 400, 'VALIDATION_ERROR', 'Installation id is not valid');
  }
  if (!mongoose.Types.ObjectId.isValid(staffId) || !/^\d{4}$/.test(pin)) {
    return fail(res, 400, 'VALIDATION_ERROR', 'Select a manager and enter their 4-digit passcode');
  }
  if (!mongoose.Types.ObjectId.isValid(locationId)) {
    return fail(res, 400, 'VALIDATION_ERROR', 'Select the location this POS operates');
  }

  try {
    await mongooseConnect();

    const staffMember = await Staff.findById(staffId).select('+password').lean();
    if (!staffMember || staffMember.isActive === false || !(await verifyPin(staffMember, pin))) {
      return fail(res, 401, 'INVALID_CREDENTIALS', 'The manager or passcode is not correct');
    }
    if (!ENROLLING_ROLES.has(normalizeStaffRole(staffMember.role))) {
      return fail(res, 403, 'ROLE_NOT_ALLOWED', 'Only a manager or admin can set up a desktop POS');
    }

    const store = await Store.findOne({}).lean();
    const location = (store?.locations || []).find((loc) => String(loc._id) === locationId);
    if (!location || location.isActive === false) {
      return fail(res, 404, 'LOCATION_NOT_FOUND', 'That location is not available');
    }

    const token = createInstallationToken();
    const now = new Date();
    const installation = await SyncInstallation.findOneAndUpdate(
      { installationId },
      {
        $set: {
          name: installationName || `POS ${installationId.slice(0, 8)}`,
          tokenHash: hashInstallationToken(token),
          locationId: location._id,
          locationName: location.name || '',
          enrolledByStaffId: staffMember._id,
          enrolledByStaffName: staffMember.name || '',
          enrolledAt: now,
          appVersion: String(body.appVersion || '').slice(0, 40),
          platform: String(body.platform || '').slice(0, 40),
          lastSeenAt: now,
          revokedAt: null,
          revokedByStaffId: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    console.log(`🖥️ Desktop installation enrolled: ${installation.name} (${installationId}) at ${location.name} by ${staffMember.name}`);

    return res.status(200).json({
      success: true,
      token,
      installation: {
        installationId,
        name: installation.name,
        locationId: String(location._id),
        locationName: location.name || '',
      },
      store: {
        _id: String(store._id),
        name: store.storeName || store.companyName || '',
      },
      serverTime: now.toISOString(),
    });
  } catch (error) {
    console.error('Desktop enrolment error:', error);
    return fail(res, 500, 'ENROLL_FAILED', 'Could not set up this installation right now');
  }
}
