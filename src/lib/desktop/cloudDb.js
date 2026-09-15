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
  if (NETWORK_NAMES.has(error?.name) || /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|querySrv|getaddrinfo|timed out|connection .* closed/i.test(text)) {
    return 'offline';
  }
  return 'error';
}

export function describeCloudError(error) {
  const kind = classifyCloudError(error);
  if (kind === 'offline') return 'Cannot reach the cloud database. Check the internet connection.';
  if (kind === 'auth') return 'The cloud database refused the saved credentials. Set up this POS again from the app menu.';
  if (kind === 'config') return error.message;
  return 'The cloud database returned an error.';
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
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
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
