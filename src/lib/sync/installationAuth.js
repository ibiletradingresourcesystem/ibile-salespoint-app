/**
 * Cloud: authenticates desktop installations calling /api/sync/*.
 *
 * Each installation holds a random secret issued at enrolment. The cloud stores only its sha256,
 * so a database leak does not expose working tokens. Requests send:
 *   Authorization: Bearer <secret>
 *   X-Installation-Id: <installationId>
 */

import crypto from 'crypto';
import { mongooseConnect } from '@/src/lib/mongoose';
import SyncInstallation from '@/src/models/SyncInstallation';

export const INSTALLATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/i;

export const hashInstallationToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

export const createInstallationToken = () => crypto.randomBytes(32).toString('base64url');

const safeEqualHex = (left, right) => {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * Returns the installation, or sends a 401/403 and returns null.
 */
export async function requireInstallation(req, res) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const installationId = String(req.headers['x-installation-id'] || '').trim();

  if (!token || !INSTALLATION_ID_PATTERN.test(installationId)) {
    res.status(401).json({ success: false, code: 'INSTALLATION_AUTH_REQUIRED', message: 'Installation credentials are required' });
    return null;
  }

  await mongooseConnect();
  const installation = await SyncInstallation.findOne({ installationId }).lean();

  if (!installation || !safeEqualHex(installation.tokenHash, hashInstallationToken(token))) {
    res.status(401).json({ success: false, code: 'INSTALLATION_AUTH_INVALID', message: 'Installation credentials are not valid' });
    return null;
  }

  if (installation.revokedAt) {
    res.status(403).json({ success: false, code: 'INSTALLATION_REVOKED', message: 'This installation has been revoked. Enrol it again with a manager account.' });
    return null;
  }

  const appVersion = String(req.headers['x-pos-desktop-version'] || '').slice(0, 40);
  SyncInstallation.updateOne(
    { _id: installation._id },
    { $set: { lastSeenAt: new Date(), ...(appVersion ? { appVersion } : {}) } }
  ).catch(() => {});

  return installation;
}
