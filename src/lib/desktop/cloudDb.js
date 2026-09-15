/**
 * Desktop only: direct connection from this computer to the customer's cloud MongoDB.
 *
 * There is no server in between. The connection string comes from Electron (encrypted with DPAPI
 * on disk) through this process's environment and is never sent to the page or written to logs.
 *
 * Operations fail fast instead of waiting when the internet is down (bufferCommands off), so the
 * sync engine can report OFFLINE and retry later. The desktop never builds indexes in the cloud.
 */

import mongoose from 'mongoose';
import { getDesktopConfig } from '@/src/lib/runtime';

const STATE_KEY = '__ibilePosCloudDb';

export class CloudDatabaseError extends Error {
  constructor(message, { kind = 'error', cause } = {}) {
    super(message);
    this.name = 'CloudDatabaseError';
    this.kind = kind; // 'offline' | 'auth' | 'config' | 'error'
    this.cause = cause;
  }
}

const NETWORK_NAMES = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoTopologyClosedError',
  'MongoNotConnectedError',
  'MongooseServerSelectionError',
]);

/** offline | auth | error — for messages and sync status. Never includes the connection string. */
export function classifyCloudError(error) {
  if (error instanceof CloudDatabaseError) return error.kind;
  const text = `${error?.name || ''} ${error?.code || ''} ${error?.codeName || ''} ${error?.message || ''}`;
  if (error?.code === 18 || /AuthenticationFailed|bad auth|Authentication failed/i.test(text)) return 'auth';
  if (NETWORK_NAMES.has(error?.name) || /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EBADRESP|querySrv|getaddrinfo|timed out|connection .* closed/i.test(text)) {
    return 'offline';
  }
  return 'error';
}

export function describeCloudError(error) {
  const kind = classifyCloudError(error);
  const text = `${error?.code || ''} ${error?.message || ''}`;
  if (kind === 'offline') {
    if (/querySrv|EBADRESP/i.test(text)) {
      return 'The cloud database address could not be looked up (DNS). Restart Ibile POS; if it continues, check the network\'s DNS settings.';
    }
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) {
      return 'The cloud database servers could not be found. Check the internet connection.';
    }
    if (/Server selection timed out|timed out|ETIMEDOUT/i.test(text)) {
      return 'The cloud database did not answer in time. Check the internet connection and that MongoDB Atlas Network Access allows this computer\'s internet address.';
    }
    return 'Cannot reach the cloud database. Check the internet connection.';
  }
  if (kind === 'auth') return 'The cloud database refused the saved credentials. Set up this POS again from the app menu.';
  if (kind === 'config') return error.message;
  return 'The cloud database returned an error.';
}

/**
 * The driver's own error text for logs and the setup screen's details, with the connection
 * string, user name and password removed.
 */
export function cloudErrorDetail(error) {
  const cause = error instanceof CloudDatabaseError && error.cause ? error.cause : error;
  const servers = cause?.reason?.servers instanceof Map
    ? [...cause.reason.servers.entries()].map(([address, server]) => `${address} ${server.type}${server.error ? ` (${server.error.message})` : ''}`)
    : [];
  let text = [`${cause?.name || 'Error'}${cause?.code ? ` ${cause.code}` : ''}: ${cause?.message || cause || ''}`, ...servers].join(' | ');

  const { cloudMongoUri } = getDesktopConfig();
  const userInfo = /^mongodb(?:\+srv)?:\/\/([^@/]*)@/i.exec(cloudMongoUri || '')?.[1] || '';
  const secrets = [cloudMongoUri, userInfo, ...userInfo.split(':')].filter((part) => part && part.length >= 3);
  const decoded = secrets.map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  for (const part of new Set([...secrets, ...decoded])) text = text.split(part).join('***');
  return text.replace(/mongodb(\+srv)?:\/\/[^\s@]*@/gi, 'mongodb$1://***@').slice(0, 1500);
}

export async function getCloudConnection() {
  const { cloudMongoUri, cloudDbName } = getDesktopConfig();
  if (!cloudMongoUri) {
    throw new CloudDatabaseError('This POS is not connected to a cloud database yet.', { kind: 'config' });
  }

  const state = (globalThis[STATE_KEY] ||= { connection: null, connecting: null });
  if (state.connection && state.connection.readyState === 1) return state.connection;
  if (state.connecting) return state.connecting;

  state.connecting = (async () => {
    if (state.connection) {
      await state.connection.close().catch(() => {});
      state.connection = null;
    }
    const connection = mongoose.createConnection(cloudMongoUri, {
      ...(cloudDbName ? { dbName: cloudDbName } : {}),
      appName: 'IbilePOS-Desktop',
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
      // Shop connections to Atlas can be slow (TLS to each replica set member); allow for that
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 60000,
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      retryWrites: true,
    });
    try {
      await connection.asPromise();
    } catch (error) {
      await connection.close().catch(() => {});
      throw new CloudDatabaseError(describeCloudError(error), { kind: classifyCloudError(error), cause: error });
    }
    state.connection = connection;
    return connection;
  })().finally(() => {
    state.connecting = null;
  });

  return state.connecting;
}

/** Confirms the cloud database answers right now (a direct ping, no web request). */
export async function pingCloudDatabase() {
  const connection = await getCloudConnection();
  try {
    await connection.db.admin().command({ ping: 1 });
  } catch (error) {
    throw new CloudDatabaseError(describeCloudError(error), { kind: classifyCloudError(error), cause: error });
  }
  return connection;
}
