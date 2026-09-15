'use strict';

/**
 * First-run setup against the customer's cloud MongoDB, directly from the main process.
 *
 * The connection string never goes back to the page and is never logged. Error messages are
 * written here and never include it.
 */

const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const { resolveSrvConnectionString } = require('./srv');

const MANAGER_ROLES = new Set(['admin', 'manager', 'senior staff']);
const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

function validateConnectionString(value) {
  const text = String(value || '').trim();
  if (!/^mongodb(\+srv)?:\/\/\S+$/i.test(text)) {
    throw new Error('Enter the MongoDB connection string. It starts with mongodb+srv:// or mongodb://');
  }
  return text;
}

/** Host part only, for display (no username or password). */
function hostOf(connectionString) {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(connectionString);
  return match ? match[1] : '';
}

function friendlyError(error) {
  const text = `${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`;
  if (error?.code === 'SRV_LOOKUP_FAILED') {
    return new Error(`${error.message} Check the connection string and the internet connection.`);
  }
  if (error?.code === 18 || /bad auth|Authentication failed|AuthenticationFailed/i.test(text)) {
    return new Error('The database username or password is not correct.');
  }
  if (/querySrv|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) {
    return new Error('The database address could not be found. Check the connection string and the internet connection.');
  }
  if (/ServerSelection|timed out|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(text)) {
    return new Error(
      'Could not reach the database. Check the internet connection, and that MongoDB Atlas Network Access allows this computer\'s internet address.'
    );
  }
  if (/not authorized|Unauthorized/i.test(text)) {
    return new Error('This database user does not have permission to read the POS data.');
  }
  return new Error('Could not use this database.');
}

/**
 * connectUri: the mongodb:// form with the Atlas hosts already looked up (see srv.js); resolved here
 * when not given. work(client, connectUri) runs with a connected client.
 */
async function withClient(connectionString, work, { connectUri, log, onStep = () => {} } = {}) {
  let client = null;
  try {
    let uri = connectUri;
    if (!uri) {
      onStep(`Looking up the database address (${hostOf(connectionString)})`);
      const resolved = await resolveSrvConnectionString(connectionString, { log });
      uri = resolved.uri;
      if (resolved.resolver) onStep(`Address found: ${resolved.hosts.length} database servers (${resolved.resolver})`);
    }
    onStep('Connecting to the database');
    const started = Date.now();
    client = new MongoClient(uri, {
      appName: 'IbilePOS-Desktop-Setup',
      serverSelectionTimeoutMS: 30 * 1000,
      connectTimeoutMS: 20 * 1000,
    });
    await client.connect();
    onStep(`Connected (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    return await work(client, uri);
  } catch (error) {
    if (error?.userFacing) throw error;
    throw friendlyError(error);
  } finally {
    await client?.close().catch(() => {});
  }
}

const userFacing = (message) => Object.assign(new Error(message), { userFacing: true });

async function looksLikePosDatabase(db) {
  const [stores, staff] = await Promise.all([
    db.collection('stores').countDocuments({}, { limit: 1 }),
    db.collection('staffs').countDocuments({}, { limit: 1 }),
  ]);
  return stores > 0 && staff > 0;
}

/** The database named in the connection string, or the only database that holds POS data. */
async function findPosDatabase(client) {
  const named = client.db();
  if (await looksLikePosDatabase(named)) return named.databaseName;

  let names = [];
  try {
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true, authorizedDatabases: true });
    names = databases.map((database) => database.name).filter((name) => !SYSTEM_DATABASES.has(name));
  } catch {
    // Some database users may not list databases; the name must then be in the connection string
  }

  const matches = [];
  for (const name of names) {
    if (await looksLikePosDatabase(client.db(name))) matches.push(name);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw userFacing(`Several databases hold POS data (${matches.join(', ')}). Add the database name to the connection string, e.g. …mongodb.net/${matches[0]}?…`);
  }
  throw userFacing('No System POS data was found in this database. Check that this is the customer\'s POS database.');
}

async function lookupCloud(connectionString, { log, onStep = () => {} } = {}) {
  const uri = validateConnectionString(connectionString);
  return withClient(uri, async (client, connectUri) => {
    onStep('Finding the POS data');
    const dbName = await findPosDatabase(client);
    onStep(`POS data found in database "${dbName}"; reading locations and managers`);
    const db = client.db(dbName);

    const store = await db.collection('stores').findOne({}, { projection: { storeName: 1, companyName: 1, locations: 1 } });
    const staff = await db
      .collection('staffs')
      .find({ showOnPos: { $ne: false }, isActive: { $ne: false } }, { projection: { name: 1, role: 1 } })
      .toArray();

    const locations = (store?.locations || [])
      .filter((location) => location?.isActive !== false)
      .map((location) => ({ _id: String(location._id), name: location.name }));
    const managers = staff
      .filter((member) => MANAGER_ROLES.has(String(member.role || '').trim().toLowerCase()))
      .map((member) => ({ _id: String(member._id), name: member.name, role: member.role }));

    if (locations.length === 0) throw userFacing('The cloud database has no active locations yet.');
    if (managers.length === 0) throw userFacing('The cloud database has no active manager or admin to authorise this POS.');

    return {
      ok: true,
      dbName,
      host: hostOf(uri),
      // Holds the credentials: stays in the main process
      connectUri,
      storeName: store?.storeName || store?.companyName || '',
      locations,
      managers,
    };
  }, { log, onStep });
}

/** Same rules as the POS login (src/lib/staffPin.js), including legacy unhashed passcodes. */
async function verifyPin(staffMember, pin) {
  for (const stored of [staffMember.password, staffMember.pin]) {
    if (!stored) continue;
    try {
      if (await bcrypt.compare(pin, String(stored))) return true;
    } catch {
      // not a bcrypt hash
    }
  }
  return pin === String(staffMember.pin ?? '') || pin === String(staffMember.password ?? '');
}

async function enrollInstallation({ connectionString, connectUri, dbName, installationId, installationName, locationId, staffId, pin, appVersion, log, onStep = () => {} }) {
  const uri = validateConnectionString(connectionString);
  if (!/^\d{4}$/.test(String(pin || ''))) throw new Error('Enter the manager\'s 4-digit passcode.');

  return withClient(uri, async (client, resolvedUri) => {
    const { ObjectId } = require('mongodb');
    const db = client.db(dbName);
    const toId = (value) => (ObjectId.isValid(String(value || '')) ? new ObjectId(String(value)) : null);

    onStep('Checking the manager passcode');
    const staffMember = await db.collection('staffs').findOne({ _id: toId(staffId) });
    if (!staffMember || staffMember.isActive === false || !(await verifyPin(staffMember, String(pin)))) {
      throw userFacing('The manager or passcode is not correct.');
    }
    if (!MANAGER_ROLES.has(String(staffMember.role || '').trim().toLowerCase())) {
      throw userFacing('Only a manager or admin can set up a desktop POS.');
    }

    const store = await db.collection('stores').findOne({}, { projection: { storeName: 1, companyName: 1, locations: 1 } });
    const location = (store?.locations || []).find((entry) => String(entry._id) === String(locationId));
    if (!location || location.isActive === false) throw userFacing('That location is not available.');

    onStep(`Registering this POS for ${location.name || 'the location'}`);
    const now = new Date();
    await db.collection('syncinstallations').updateOne(
      { installationId },
      {
        $set: {
          name: installationName,
          locationId: location._id,
          locationName: location.name || '',
          enrolledByStaffId: staffMember._id,
          enrolledByStaffName: staffMember.name || '',
          enrolledAt: now,
          appVersion,
          platform: `${process.platform}-${process.arch}`,
          lastSeenAt: now,
          revokedAt: null,
          updatedAt: now,
        },
        $setOnInsert: { installationId, createdAt: now },
      },
      { upsert: true }
    );

    return {
      installation: { installationId, name: installationName, locationId: String(location._id), locationName: location.name || '' },
      store: { name: store?.storeName || store?.companyName || '' },
      dbName,
      host: hostOf(uri),
      connectUri: resolvedUri,
    };
  }, { connectUri, log, onStep });
}

module.exports = { lookupCloud, enrollInstallation, hostOf };
