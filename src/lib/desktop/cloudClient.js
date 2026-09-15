/**
 * Desktop only: authenticated calls from the local server to the cloud sync API.
 */

import { getDesktopConfig } from '@/src/lib/runtime';
import { parseWire, stringifyWire } from '@/src/lib/sync/ejson';

export class CloudRequestError extends Error {
  constructor(message, { status = 0, code = '', network = false } = {}) {
    super(message);
    this.name = 'CloudRequestError';
    this.status = status;
    this.code = code;
    this.network = network;
  }
}

export async function cloudRequest(path, { method = 'POST', body, timeoutMs = 20000, auth = true } = {}) {
  const config = getDesktopConfig();
  if (!config.cloudUrl) {
    throw new CloudRequestError('The cloud address is not configured', { code: 'NOT_CONFIGURED' });
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    headers.Authorization = `Bearer ${config.token}`;
    headers['X-Installation-Id'] = config.installationId;
  }
  if (config.appVersion) headers['X-POS-Desktop-Version'] = config.appVersion;

  let response;
  try {
    response = await fetch(`${config.cloudUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? stringifyWire(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (error) {
    const reason = error?.cause?.code || error?.name || error?.message || 'network error';
    throw new CloudRequestError(`Cloud not reachable (${reason})`, { network: true, code: 'NETWORK' });
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? parseWire(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new CloudRequestError(data?.message || `Cloud responded with ${response.status}`, {
      status: response.status,
      code: data?.code || `HTTP_${response.status}`,
    });
  }
  return data;
}

export async function pingCloud(timeoutMs = 6000) {
  try {
    await cloudRequest('/api/sync/ping', { method: 'GET', auth: false, timeoutMs });
    return true;
  } catch {
    return false;
  }
}
