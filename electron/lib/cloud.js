'use strict';

/**
 * First-run cloud calls made by the main process (so the installation token never enters the page).
 */

const MANAGER_ROLES = new Set(['admin', 'manager', 'senior staff']);

function normalizeCloudUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Enter the full cloud address, for example https://your-pos.vercel.app');
  }
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('The cloud address must start with https://');
  }
  return `${url.protocol}//${url.host}`;
}

async function getJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(20 * 1000) });
  } catch {
    throw new Error('Could not reach the cloud. Check the internet connection and the address.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `The cloud responded with ${response.status}`);
  }
  return data;
}

async function lookupCloud(cloudUrl) {
  const base = normalizeCloudUrl(cloudUrl);

  const ping = await getJson(`${base}/api/sync/ping`).catch(() => null);
  if (ping?.service !== 'ibile-pos-sync') {
    throw new Error('This address is not a System POS cloud with desktop sync enabled. Deploy the latest POS version first.');
  }

  const [locationsData, staffData] = await Promise.all([
    getJson(`${base}/api/store/init-locations`),
    getJson(`${base}/api/staff/list`),
  ]);

  const locations = (locationsData?.store?.locations || [])
    .filter((location) => location?.isActive !== false)
    .map((location) => ({ _id: String(location._id), name: location.name }));
  const managers = (staffData?.data || [])
    .filter((member) => member?.isActive !== false && MANAGER_ROLES.has(String(member.role || '').trim().toLowerCase()))
    .map((member) => ({ _id: String(member._id), name: member.name, role: member.role }));

  if (locations.length === 0) throw new Error('The cloud has no active locations yet.');
  if (managers.length === 0) throw new Error('The cloud has no active manager or admin to authorise this POS.');

  return { ok: true, cloudUrl: base, storeName: locationsData?.store?.storeName || '', locations, managers };
}

async function enrollInstallation({ cloudUrl, installationId, installationName, locationId, staffId, pin, appVersion }) {
  const base = normalizeCloudUrl(cloudUrl);
  const data = await getJson(`${base}/api/sync/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      installationId,
      installationName,
      locationId,
      staffId,
      pin,
      appVersion,
      platform: `${process.platform}-${process.arch}`,
    }),
  });
  if (!data?.token) throw new Error('The cloud did not issue credentials for this POS.');
  return { ...data, cloudUrl: base };
}

module.exports = { lookupCloud, enrollInstallation, normalizeCloudUrl };
