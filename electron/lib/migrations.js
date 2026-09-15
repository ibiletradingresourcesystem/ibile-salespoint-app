'use strict';

/**
 * Local database migrations for desktop installations.
 *
 * The POS models are shared with the cloud and Mongoose tolerates missing fields, so most releases
 * need none. When a release must transform existing local data, add an entry with the next version.
 * A backup is taken before any pending migration runs (see main.js), and the version is recorded
 * after each migration so an interrupted run resumes where it stopped.
 */

const { MongoClient } = require('mongodb');

const MIGRATIONS = [
  {
    version: 1,
    name: 'Record the schema version for desktop installations',
    async up(db) {
      await db.collection('desktop_meta').updateOne(
        { _id: 'schema' },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
    },
  },
];

async function withDb(uri, work) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    return await work(client.db());
  } finally {
    await client.close().catch(() => {});
  }
}

async function inspect(uri) {
  return withDb(uri, async (db) => {
    const meta = await db.collection('desktop_meta').findOne({ _id: 'schema' });
    const current = Number(meta?.version || 0);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    return {
      current,
      pending: MIGRATIONS.filter((migration) => migration.version > current),
      hasData: collections.some((collection) => !collection.name.startsWith('system.')),
    };
  });
}

async function runMigrations(uri, pending, log) {
  return withDb(uri, async (db) => {
    for (const migration of pending) {
      log.info(`Running local migration ${migration.version}: ${migration.name}`);
      await migration.up(db);
      await db.collection('desktop_meta').updateOne(
        { _id: 'schema' },
        { $set: { version: migration.version, [`applied.v${migration.version}`]: { name: migration.name, at: new Date() } } },
        { upsert: true }
      );
    }
  });
}

module.exports = { inspect, runMigrations };
