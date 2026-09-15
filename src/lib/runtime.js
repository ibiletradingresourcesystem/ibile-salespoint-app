/**
 * Where this server is running.
 *
 * - Cloud (default): the existing Vercel deployment talking to the customer's cloud MongoDB.
 * - Desktop: the same Next.js app started by the Electron shell (electron/main.js) on the
 *   customer's computer with POS_RUNTIME=desktop. Its own database is the local MongoDB; it also
 *   connects directly to the customer's cloud MongoDB to sync (no Vercel or other server between).
 *
 * Server-side only. Browser code should use src/lib/desktopClient.js.
 */

export const isDesktopServer = () => process.env.POS_RUNTIME === 'desktop';

export function getDesktopConfig() {
  return {
    installationId: process.env.SYNC_INSTALLATION_ID || '',
    installationName: process.env.SYNC_INSTALLATION_NAME || '',
    locationId: process.env.SYNC_LOCATION_ID || '',
    // Customer's cloud MongoDB. Set only in this server process by Electron; never sent to the page.
    cloudMongoUri: process.env.CLOUD_MONGODB_URI || '',
    cloudDbName: process.env.CLOUD_MONGODB_DB || '',
    internalToken: process.env.DESKTOP_INTERNAL_TOKEN || '',
    appVersion: process.env.DESKTOP_APP_VERSION || '',
  };
}

export function isDesktopEnrolled() {
  const { installationId, cloudMongoUri } = getDesktopConfig();
  return Boolean(installationId && cloudMongoUri);
}

/** Host of the cloud database for display, without credentials. */
export function cloudDatabaseHost() {
  const { cloudMongoUri } = getDesktopConfig();
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(cloudMongoUri);
  return match ? match[1] : '';
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
