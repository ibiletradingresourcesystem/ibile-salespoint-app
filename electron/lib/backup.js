'use strict';

/**
 * Backups of the local database, written by the app itself (no extra tools to install).
 *
 * Format (.ibpbak): gzip-compressed lines of MongoDB Extended JSON (canonical, so every type is
 * kept exactly): a manifest, then each collection's indexes and documents, then an end marker with
 * document counts. A backup is written to a .partial file and renamed only when complete, and a
 * restore reads the whole file and checks the counts before touching the database.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { MongoClient, BSON } = require('mongodb');

const { EJSON } = BSON;
const FORMAT = 'ibile-pos-backup';
const FORMAT_VERSION = 1;
const EXTENSION = '.ibpbak';
const KEEP_BY_REASON = { auto: 14, 'pre-update': 5, 'pre-migration': 5, 'pre-restore': 5 };

const line = (value) => `${EJSON.stringify(value, { relaxed: false })}\n`;

async function createBackup({ uri, backupsDir, reason = 'manual', meta = {}, log }) {
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupsDir, `ibile-pos-${stamp}-${reason}${EXTENSION}`);
  const partial = `${file}.partial`;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const counts = {};

  try {
    await client.connect();
    const db = client.db();
    const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();

    async function* lines() {
      yield line({
        type: 'manifest',
        format: FORMAT,
        formatVersion: FORMAT_VERSION,
        createdAt: new Date(),
        reason,
        database: db.databaseName,
        collections,
        ...meta,
      });
      for (const name of collections) {
        const collection = db.collection(name);
        yield line({ type: 'collection', name, indexes: await collection.indexes() });
        let count = 0;
        // Keep BSON number types as stored (a double 800.0 must not come back as an integer)
        const cursor = collection.find({}, { batchSize: 1000, promoteValues: false, promoteLongs: false, bsonRegExp: true });
        for await (const doc of cursor) {
          count += 1;
          yield line({ type: 'doc', c: name, d: doc });
        }
        counts[name] = count;
      }
      yield line({ type: 'end', counts });
    }

    await pipeline(Readable.from(lines()), zlib.createGzip({ level: 6 }), fs.createWriteStream(partial));
    fs.renameSync(partial, file);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  } finally {
    await client.close().catch(() => {});
  }

  pruneBackups(backupsDir, log);
  log?.info(`Backup created (${reason}): ${file}`);
  return { file, counts };
}

function listBackups(backupsDir) {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter((name) => name.endsWith(EXTENSION))
    .map((name) => {
      const full = path.join(backupsDir, name);
      const stat = fs.statSync(full);
      const reason = /-(manual|auto|pre-update|pre-migration|pre-restore)\.ibpbak$/.exec(name)?.[1] || 'manual';
      return { file: full, name, size: stat.size, modifiedAt: stat.mtime, reason };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
}

/** Keeps the newest automatic backups of each kind; manual backups are never removed. */
function pruneBackups(backupsDir, log) {
  const byReason = new Map();
  for (const entry of listBackups(backupsDir)) {
    if (!KEEP_BY_REASON[entry.reason]) continue;
    const list = byReason.get(entry.reason) || [];
    list.push(entry);
    byReason.set(entry.reason, list);
  }
  for (const [reason, entries] of byReason) {
    for (const entry of entries.slice(KEEP_BY_REASON[reason])) {
      fs.rmSync(entry.file, { force: true });
      log?.info(`Removed old ${reason} backup ${entry.name}`);
    }
  }
}

function readLines(file) {
  return readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
}

/** Reads the whole backup and confirms it is complete. Returns its manifest and counts. */
async function verifyBackup(file) {
  let manifest = null;
  let end = null;
  const seen = {};

  for await (const text of readLines(file)) {
    if (!text) continue;
    // Relaxed parsing here: verification compares plain numbers; restore keeps exact types
    const entry = EJSON.parse(text, { relaxed: true });
    if (!manifest) {
      if (entry.type !== 'manifest' || entry.format !== FORMAT) throw new Error('This is not an Ibile POS backup file.');
      if (Number(entry.formatVersion) > FORMAT_VERSION) throw new Error('This backup was made by a newer version of Ibile POS. Update the app first.');
      manifest = entry;
    } else if (entry.type === 'doc') {
      seen[entry.c] = (seen[entry.c] || 0) + 1;
    } else if (entry.type === 'end') {
      end = entry;
    }
  }

  if (!manifest || !end) throw new Error('This backup file is incomplete.');
  for (const [name, count] of Object.entries(end.counts || {})) {
    if ((seen[name] || 0) !== Number(count)) throw new Error(`This backup file is damaged (${name} is incomplete).`);
  }
  return { manifest, counts: end.counts };
}

/** Replaces the local database with the backup. The caller stops the POS service first. */
async function restoreBackup({ uri, file, log }) {
  await verifyBackup(file);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db();
    await db.dropDatabase();

    const indexes = {};
    let current = null;
    let batch = [];
    const flush = async () => {
      if (batch.length > 0) {
        await db.collection(current).insertMany(batch, { ordered: false });
        batch = [];
      }
    };

    for await (const text of readLines(file)) {
      if (!text) continue;
      const entry = EJSON.parse(text, { relaxed: false });
      if (entry.type === 'collection') {
        await flush();
        current = entry.name;
        indexes[entry.name] = entry.indexes || [];
        await db.createCollection(entry.name).catch((error) => {
          if (error?.codeName !== 'NamespaceExists') throw error;
        });
      } else if (entry.type === 'doc') {
        if (entry.c !== current) {
          await flush();
          current = entry.c;
        }
        batch.push(entry.d);
        if (batch.length >= 1000) await flush();
      }
    }
    await flush();

    for (const [name, list] of Object.entries(indexes)) {
      const specs = list.filter((index) => index.name !== '_id_').map(({ v, ns, ...spec }) => spec);
      if (specs.length === 0) continue;
      await db.collection(name).createIndexes(specs).catch((error) => {
        log?.warn(`Could not recreate indexes for ${name}: ${error.message}`);
      });
    }
  } finally {
    await client.close().catch(() => {});
  }

  log?.info(`Restored backup ${file}`);
}

module.exports = { createBackup, listBackups, verifyBackup, restoreBackup, EXTENSION };
