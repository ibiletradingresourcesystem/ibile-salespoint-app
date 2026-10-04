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

/**
 * mongod exited after it had started running, which points at its data files rather than at this
 * computer: 14 is an unhandled exception (what a till that was switched off mid-write shows), 100 is
 * a failure inside initAndListen. Each is worth one repair attempt before giving up. 62 (files from
 * a different MongoDB version) is not: a repair cannot convert them and drops what it cannot read.
 * Nor is 100 when another mongod is holding the folder — see `inUse` below.
 */
const REPAIRABLE_EXIT_CODES = new Set([14, 100]);

/** Windows words for "something outside this app would not let mongod touch its files". */
const BLOCKED_PATTERNS = [
  /access is denied/i,
  /permission denied/i,
  /operation not permitted/i,
  /used by another process/i,
  /EPERM|EACCES/,
];

/**
 * A socket mongod was not allowed to open. Windows says this when a firewall rule or a security
 * policy stops that program listening, and when the port sits inside a range Windows has reserved
 * (Hyper-V and WSL take blocks of ports and move them at every restart).
 */
const SOCKET_PATTERNS = [
  /forbidden by its access permissions/i,
  /failed to set up listener/i,
  /address already in use/i,
  /SocketException/,
  /WSAEACCES|10013/,
];

// mongod prints these after a crash whatever caused it; the cause is in the lines before them
const BOILERPLATE = /unhandled exception|stack trace for|immediate exit|writing fatal message|aborting after|got signal/i;

/**
 * The last thing mongod complained about, from its own log.
 *
 * Exit code 14 on its own says nothing — it is "mongod threw" — so the app reads back the error and
 * fatal lines it wrote and repeats them. That is the difference between "it will not start" and
 * "your antivirus will not let it write to its folder".
 */
/** Bytes already in mongod.log, so a run's own lines can be told from those of earlier runs. */
function mongodLogSize(logsDir) {
  try {
    return fs.statSync(path.join(logsDir, 'mongod.log')).size;
  } catch {
    return 0;
  }
}

function readMongodFailure(logsDir, fromByte = 0) {
  try {
    // mongod.log is appended to by every run; a "Failed to set up listener" from last week must not
    // decide how today's crash is handled, so only this run's part is read
    const buffer = fs.readFileSync(path.join(logsDir, 'mongod.log'));
    const text = buffer.subarray(Math.min(fromByte, buffer.length)).toString('utf8');
    const lines = text.split(/\r?\n/).slice(-400).filter(Boolean);
    const messages = [];

    for (const line of lines) {
      let entry = null;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // mongod also writes plain lines; only its JSON carries severities
      }
      if (entry.s !== 'E' && entry.s !== 'F') continue;
      const detail =
        entry.attr?.error?.errmsg ||
        entry.attr?.error?.message ||
        entry.attr?.error ||
        entry.attr?.reason ||
        entry.attr?.message ||
        '';
      const message = [entry.msg, typeof detail === 'string' ? detail : JSON.stringify(detail)]
        .filter(Boolean)
        .join(': ')
        .trim();
      // The dump file it could not write, and the crash notice itself, are consequences — the line
      // that says why comes before them
      if (!message || /minidump/i.test(message) || BOILERPLATE.test(message)) continue;
      if (!messages.includes(message)) messages.push(message);
    }

    // The first real complaints, which is where the cause is
    // Judged on the errors themselves, never on the whole tail of the file: an "Access is denied"
    // from an older crash (mongod failing to write its own dump, say) would otherwise be read as
    // the cause of today's failure and send everyone after the antivirus.
    const errors = messages.join(' | ');
    return {
      summary: messages.slice(0, 3).join(' | '),
      blocked: BLOCKED_PATTERNS.some((pattern) => pattern.test(errors)),
      socket: SOCKET_PATTERNS.some((pattern) => pattern.test(errors)),
      // mongod refuses to open a folder whose repair was interrupted until a repair finishes
      incompleteRepair: /incomplete repair/i.test(errors),
      // Another mongod already has this folder open: repairing it would write under that process
      inUse: /DBPathInUse|Unable to lock the lock file|already running|Another mongod/i.test(errors),
    };
  } catch {
    // No log to read yet, so nothing is claimed about the cause
    return { summary: '', blocked: false, socket: false, incompleteRepair: false, inUse: false };
  }
}

class LocalDatabaseStartError extends Error {
  constructor(message, { exitCode = null, reason = 'exit' } = {}) {
    super(message);
    this.name = 'LocalDatabaseStartError';
    this.exitCode = exitCode;
    this.reason = reason;
    this.repairable = REPAIRABLE_EXIT_CODES.has(Number(exitCode));
  }
}

/**
 * Can the app write where the database lives?
 *
 * Ransomware protection — Defender's Controlled Folder Access, Avast's Ransomware Shield — lets a
 * program run and then refuses its writes. mongod answers that by throwing and exiting 14, which on
 * its own reads like a damaged database and sends everyone looking in the wrong place. One probe
 * file before it starts separates the two.
 */
function checkFolderIsWritable(dbPath) {
  const probe = path.join(dbPath, '.ibile-write-test');
  try {
    fs.writeFileSync(probe, String(Date.now()));
    fs.rmSync(probe, { force: true });
    return null;
  } catch (error) {
    return error;
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

    const writeError = checkFolderIsWritable(dbPath);
    if (writeError) {
      throw new LocalDatabaseStartError(
        'Ibile POS is not allowed to write to the folder its database lives in ' +
          `("${dbPath}": ${writeError.code || writeError.message}). This is ransomware protection — ` +
          "Windows Security's Controlled folder access, or Avast's Ransomware Shield. Allow " +
          `"${mongod}" and that folder, then start Ibile POS again.`,
        { reason: 'blocked' }
      );
    }

    await killOrphan(runDir, 'mongod', path.basename(mongod), this.log);

    this.port = this.config.get('mongoPort');
    if (!(await isPortFree(this.port))) {
      const previous = this.port;
      this.port = await findFreePort(previous + 1);
      this.config.set({ mongoPort: this.port });
      this.log.warn(`Database port ${previous} is in use; using ${this.port}`);
    }

    try {
      await this.launch();
    } catch (error) {
      // The files are in a state mongod will not open. This is what a till shows after it was
      // switched off at the wall mid-write, and it fixes itself: repair the files and start again.
      if (error.reason === 'blocked') throw error;

      // Not the files: mongod was not allowed to open its port. A firewall rule or a security
      // policy can block that program on that port, and Windows itself reserves blocks of ports
      // that move at every restart — which is what a till that starts once and then will not looks
      // like. Another port costs nothing to try.
      const listener = readMongodFailure(this.paths.logsDir, this.runLogStart);
      if (listener.socket) {
        const previous = this.port;
        this.port = await findFreePort(previous + 1);
        this.config.set({ mongoPort: this.port });
        this.log.warn(
          `The local database was not allowed to use port ${previous} (${listener.summary || 'socket error'}); ` +
            `trying port ${this.port}`
        );
        try {
          await this.launch();
          this.log.info(`Local database moved to port ${this.port}`);
          await this.ensureUser();
          this.log.info(`Local database ready on 127.0.0.1:${this.port}`);
          return this.uri();
        } catch (retryError) {
          const again = readMongodFailure(this.paths.logsDir, this.runLogStart);
          if (again.socket) {
            throw new LocalDatabaseStartError(
              'The local database is not allowed to open a port on this computer. A firewall rule or ' +
                'a security policy is blocking the database program itself, so changing the port does ' +
                `not help. Allow "${this.paths.mongod}" through the firewall (it only listens on this ` +
                'computer, 127.0.0.1), or ask whoever manages these computers to allow it.' +
                (again.summary ? ` The database reported: ${again.summary}.` : ''),
              { exitCode: retryError.exitCode, reason: 'blocked' }
            );
          }
          throw retryError;
        }
      }

      if (listener.inUse) {
        throw new LocalDatabaseStartError(
          'Another copy of the local database is already running on this computer and has its files open. ' +
            'Close any other Ibile POS window (or restart the computer), then start Ibile POS again.' +
            (listener.summary ? ` The database reported: ${listener.summary}.` : ''),
          { exitCode: error.exitCode, reason: 'in_use' }
        );
      }

      if (!error.repairable) throw error;
      this.log.warn(`${error.message} Repairing the local database files and trying again.`);
      this.onRepairStart?.();
      const repaired = await this.repair();
      if (!repaired) {
        const failure = readMongodFailure(this.paths.logsDir, this.runLogStart);
        // Another mongod holding the folder also says "locked by another process", which would
        // otherwise read as antivirus; it is neither blocked nor damaged, so it is told apart first
        if (failure.inUse) {
          throw new LocalDatabaseStartError(
            'Another copy of the local database is already running on this computer and has its files open. ' +
              'Close any other Ibile POS window (or restart the computer), then start Ibile POS again.' +
              (failure.summary ? ` The database reported: ${failure.summary}.` : ''),
            { exitCode: error.exitCode, reason: 'in_use' }
          );
        }
        if (failure.blocked) {
          throw new LocalDatabaseStartError(
            'Something on this computer is stopping the local database from using its own files — ' +
              'antivirus (Avast Ransomware Shield and similar) or Windows permissions. Allow ' +
              `"${this.paths.mongod}" and the folder "${this.paths.dbPath}", then start Ibile POS again.` +
              (failure.summary ? ` The database reported: ${failure.summary}.` : ''),
            { exitCode: error.exitCode, reason: 'blocked' }
          );
        }
        throw new LocalDatabaseStartError(
          'The local database could not start and its files could not be repaired.' +
            (failure.incompleteRepair
              ? ' An earlier repair was interrupted, and these files cannot be opened again until one' +
                ' finishes — which this one did not.'
              : '') +
            (failure.summary ? ` It reported: ${failure.summary}.` : '') +
            ' This till can start again with an empty database and take everything back from the cloud.',
          { exitCode: error.exitCode, reason: 'repair_failed' }
        );
      }
      this.log.info('Local database files repaired; starting again');
      await this.launch();
    }

    await this.ensureUser();
    this.log.info(`Local database ready on 127.0.0.1:${this.port}`);
    return this.uri();
  }

  /** Starts mongod and waits for it to answer. Throws LocalDatabaseStartError if it exits first. */
  async launch() {
    const { mongod, dbPath, logsDir, runDir } = this.paths;
    const args = [
      '--dbpath', dbPath,
      '--port', String(this.port),
      '--bind_ip', '127.0.0.1',
      '--auth',
      '--wiredTigerCacheSizeGB', '0.5',
      '--setParameter', 'diagnosticDataCollectionEnabled=false',
    ];

    const output = openLogStream(logsDir, 'mongod.log');
    this.runLogStart = mongodLogSize(logsDir);
    this.stopping = false;
    this.exitInfo = null;
    this.child = spawn(mongod, args, { cwd: dbPath, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
  }

  /**
   * `mongod --repair`: rebuilds what WiredTiger can still read and drops what it cannot. Sales are
   * also in the cloud and in the backups, so the worst case here is a restore, not lost takings.
   */
  async repair() {
    const { mongod, dbPath, logsDir } = this.paths;

    // A lock left behind by a killed process stops even the repair from running
    const lockFile = path.join(dbPath, 'mongod.lock');
    try {
      if (fs.existsSync(lockFile)) {
        fs.rmSync(lockFile, { force: true });
        this.log.info('Removed a leftover database lock file');
      }
    } catch (error) {
      this.log.warn(`Could not remove the database lock file: ${error.message}`);
    }

    const output = openLogStream(logsDir, 'mongod.log');
    this.runLogStart = mongodLogSize(logsDir);
    return new Promise((resolve) => {
      const child = spawn(mongod, ['--dbpath', dbPath, '--repair'], {
        cwd: dbPath,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.pipe(output);
      child.stderr.pipe(output);

      const timer = setTimeout(() => {
        this.log.warn('Repairing the local database took too long; stopping it');
        child.kill();
      }, 15 * 60 * 1000);

      child.once('error', (error) => {
        clearTimeout(timer);
        this.log.error(`Could not run the database repair: ${error.message}`);
        resolve(false);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) this.log.error(`Database repair finished with exit code ${code}`);
        resolve(code === 0);
      });
    });
  }

  /**
   * Moves the data folder aside and leaves an empty one in its place, so the till can start again
   * and take the store's data back from the cloud. The old folder is kept next to it: anything that
   * had not reached the cloud yet is still in there for support to pull out.
   */
  setAsideDataFolder() {
    const { dbPath } = this.paths;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const kept = `${dbPath}-unreadable-${stamp}`;
    fs.renameSync(dbPath, kept);
    fs.mkdirSync(dbPath, { recursive: true });
    this.log.warn(`Started a new local database; the old files are kept in ${kept}`);
    return kept;
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
        const failure = readMongodFailure(this.paths.logsDir, this.runLogStart);
        // Another mongod holding the folder also says "locked by another process", which would
        // otherwise read as antivirus; it is neither blocked nor damaged, so it is told apart first
        if (failure.inUse) {
          throw new LocalDatabaseStartError(
            'Another copy of the local database is already running on this computer and has its files open. ' +
              'Close any other Ibile POS window (or restart the computer), then start Ibile POS again.' +
              (failure.summary ? ` The database reported: ${failure.summary}.` : ''),
            { exitCode: code, reason: 'in_use' }
          );
        }
        if (failure.blocked) {
          throw new LocalDatabaseStartError(
            'Something on this computer is stopping the local database from using its own files — ' +
              'antivirus (Avast Ransomware Shield and similar) or Windows permissions. Allow ' +
              `"${this.paths.mongod}" and the folder "${this.paths.dbPath}", then start Ibile POS again.` +
              (failure.summary ? ` The database reported: ${failure.summary}.` : ''),
            { exitCode: code, reason: 'blocked' }
          );
        }
        throw new LocalDatabaseStartError(
          `The local database could not start (exit code ${code}).` +
            (failure.summary ? ` It reported: ${failure.summary}.` : ' Details are in logs\\mongod.log.'),
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

module.exports = { LocalMongo, LocalDatabaseStartError, DATABASE_NAME, readMongodFailure, mongodLogSize };
