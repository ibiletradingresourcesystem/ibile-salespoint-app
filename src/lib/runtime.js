/**
 * Where this server is running.
 *
 * - Cloud (default): the existing Vercel deployment talking to the cloud MongoDB.
 * - Desktop: the same Next.js app started by the Electron shell (electron/main.js) on the
 *   customer's computer with POS_RUNTIME=desktop, talking to the local MongoDB.
 *
 * Server-side only. Browser code should use src/lib/desktopClient.js.
 */

export const isDesktopServer = () => process.env.POS_RUNTIME === 'desktop';

export function getDesktopConfig() {
  return {
    installationId: process.env.SYNC_INSTALLATION_ID || '',
    installationName: process.env.SYNC_INSTALLATION_NAME || '',
    cloudUrl: String(process.env.SYNC_CLOUD_URL || '').replace(/\/+$/, ''),
    token: process.env.SYNC_TOKEN || '',
    locationId: process.env.SYNC_LOCATION_ID || '',
    internalToken: process.env.DESKTOP_INTERNAL_TOKEN || '',
    appVersion: process.env.DESKTOP_APP_VERSION || '',
  };
}

export function isDesktopEnrolled() {
  const { installationId, cloudUrl, token } = getDesktopConfig();
  return Boolean(installationId && cloudUrl && token);
}

/**
 * Tills opened by a desktop installation are owned by that installation and reach the cloud
 * through sync. Web terminals must not adopt them as "the open till for this location".
 * Locally every till belongs to this installation, so no filter applies there.
 */
export function webTillScope() {
  return isDesktopServer() ? {} : { installationId: null };
}

/**
 * Some records are managed only in the cloud (products, categories, promotions). A write on the
 * desktop would be overwritten by the next pull, so refuse it with a clear message instead.
 */
export function rejectCloudManagedWrite(res, what = 'This data') {
  return res.status(409).json({
    success: false,
    code: 'CLOUD_MANAGED',
    message: `${what} is managed in the Ibile management app and syncs to this POS automatically.`,
  });
}
