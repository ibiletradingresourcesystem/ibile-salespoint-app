'use strict';

/**
 * Runs the bundled MongoDB server for this installation. The customer never operates it.
 *
 * - listens on 127.0.0.1 only (not reachable from the network)
 * - authentication on; the first run creates the local user through MongoDB's localhost exception
 * - journaling (default) keeps committed sales safe if the computer loses power
 * - a modest cache so it fits alongside the POS on ordinary till computers
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { MongoClient } = require('mongodb');
const { findFreePort, isPortFree, killOrphan, sleep, waitForExit, writePid, clearPid } = require('./processes');
const { openLogStream } = require('./logger');

const DATABASE_NAME = 'ibile_pos';

const isAuthError = (error) =>
  error?.code === 18 || error?.code === 13 || /Authentication failed|requires authentication/i.test(error?.message || '');

// Windows exit codes meaning mongod.exe could not run on this computer at all (nothing reaches mongod.log)
const WINDOWS_START_FAILURES = {
  // 0xC0000135 STATUS_DLL_NOT_FOUND: MSVCP140*.dll / VCRUNTIME140*.dll missing
  3221225781: {
    reason: 'vc_runtime',
    message: 'The Microsoft Visual C++ Redistributable (x64), which the local database needs, is not installed on this computer.',
  },
  // 0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND: an older Visual C++ runtime is installed
  3221225785: {
    reason: 'vc_runtime',
    message: 'The Microsoft Visual C++ Redistributable (x64) on this computer is too old for the local database.',
  },
  // 0xC000001D STATUS_ILLEGAL_INSTRUCTION: MongoDB 8.0 needs a processor with AVX
  3221225501: {
    reason: 'cpu',
    message: "This computer's processor cannot run the local database (MongoDB 8.0 needs a processor with AVX support). Use a newer computer for this POS.",
  },
};

class LocalDatabaseStartError extends Error {
  constructor(message, { exitCode = null, reason = 'exit' } = {}) {
    super(message);
    this.name = 'LocalDatabaseStartError';
    this.exitCode = exitCode;
    this.reason = reason;
  }
}

class LocalMongo {
  constructor({ paths, config, log }) {
    this.paths = paths;
    this.config = config;
    this.log = log;
    this.child = null;
    this.port = null;
    this.stopping = false;
    this.exitInfo = null;
    this.onUnexpectedExit = null;
  }

  uri(database = DATABASE_NAME) {
    const user = encodeURIComponent(this.config.get('mongoUser'));
    const password = encodeURIComponent(this.config.secret('mongoPassword'));
    return `mongodb://${user}:${password}@127.0.0.1:${this.port}/${database}?authSource=admin&directConnection=true`;
  }

  async start() {
    const { mongod, dbPath, logsDir, runDir } = this.paths;
    if (!fs.existsSync(mongod)) {
      throw new Error(`The local database program is missing (${mongod}). Reinstall Ibile POS.`);
    }

    fs.mkdirSync(dbPath, { recursive: true });
    await killOrphan(runDir, 'mongod', path.basename(mongod), this.log);

    this.port = this.config.get('mongoPort');
    if (!(await isPortFree(this.port))) {
      const previous = this.port;
      this.port = await findFreePort(previous + 1);
      this.config.set({ mongoPort: this.port });
      this.log.warn(`Database port ${previous} is in use; using ${this.port}`);
    }

    const args = [
      '--dbpath', dbPath,
      '--port', String(this.port),
      '--bind_ip', '127.0.0.1',
      '--auth',
      '--wiredTigerCacheSizeGB', '0.5',
      '--setParameter', 'diagnosticDataCollectionEnabled=false',
    ];

    const output = openLogStream(logsDir, 'mongod.log');
    this.stopping = false;
    this.exitInfo = null;
    this.child = spawn(mongod, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.stdout.pipe(output);
    this.child.stderr.pipe(output);
    writePid(runDir, 'mongod', this.child.pid);

    this.child.once('exit', (code, signal) => {
      this.exitInfo = { code, signal };
      clearPid(runDir, 'mongod');
      if (!this.stopping) {
        this.log.error(`Local database stopped unexpectedly (code ${code}, signal ${signal})`);
        this.onUnexpectedExit?.(this.exitInfo);
      }
    });

    await this.waitUntilReady(120 * 1000);
    await this.ensureUser();
    this.log.info(`Local database ready on 127.0.0.1:${this.port}`);
    return this.uri();
  }

  async waitUntilReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exitInfo) {
        const { code } = this.exitInfo;
        const known = WINDOWS_START_FAILURES[code];
        if (known) {
          throw new LocalDatabaseStartError(`${known.message} (exit code ${code})`, { exitCode: code, reason: known.reason });
        }
        throw new LocalDatabaseStartError(
          `The local database could not start (exit code ${code}). Details are in logs\\mongod.log.`,
          { exitCode: code }
        );
      }
      const client = new MongoClient(`mongodb://127.0.0.1:${this.port}/?directConnection=true`, {
        serverSelectionTimeoutMS: 1000,
      });
      try {
        await client.connect();
        await client.db('admin').command({ ping: 1 });
        return;
      } catch {
        await sleep(500);
      } finally {
        await client.close().catch(() => {});
      }
    }
    throw new Error('The local database did not start in time. Details are in logs\\mongod.log.');
  }

  async ensureUser() {
    const options = { serverSelectionTimeoutMS: 5000 };

    const authenticated = new MongoClient(this.uri('admin'), options);
    try {
      await authenticated.connect();
      await authenticated.db('admin').command({ connectionStatus: 1 });
      return;
    } catch (error) {
      if (!isAuthError(error)) throw error;
    } finally {
      await authenticated.close().catch(() => {});
    }

    // First run: no users exist yet, so MongoDB allows creating one from this computer
    const bootstrap = new MongoClient(`mongodb://127.0.0.1:${this.port}/?directConnection=true`, options);
    try {
      await bootstrap.connect();
      await bootstrap.db('admin').command({
        createUser: this.config.get('mongoUser'),
        pwd: this.config.secret('mongoPassword'),
        roles: [{ role: 'root', db: 'admin' }],
      });
      this.log.info('Created the local database user');
    } catch (error) {
      throw new Error(
        'The local database is protected by credentials this computer no longer has. ' +
        'See "Recovering local database access" in docs/DESKTOP.md.'
      );
    } finally {
      await bootstrap.close().catch(() => {});
    }
  }

  async stop() {
    if (!this.child || this.exitInfo) return;
    this.stopping = true;

    const client = new MongoClient(this.uri('admin'), { serverSelectionTimeoutMS: 3000 });
    try {
      await client.connect();
      await client.db('admin').command({ shutdown: 1 }).catch(() => {});
    } catch {
      // Fall through to terminating the process
    } finally {
      await client.close().catch(() => {});
    }

    if (!(await waitForExit(this.child, 30 * 1000))) {
      this.log.warn('Local database did not stop in time; terminating it');
      this.child.kill();
      await waitForExit(this.child, 5000);
    }
    this.log.info('Local database stopped');
  }
}

module.exports = { LocalMongo, LocalDatabaseStartError, DATABASE_NAME };
