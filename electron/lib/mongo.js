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
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { MongoClient } = require('mongodb');
const { findFreePort, isPortFree, killOrphan, sleep, waitForExit, writePid, clearPid } = require('./processes');
const { openLogStream } = require('./logger');
const { hasAvx2 } = require('./cpu');

const DATABASE_NAME = 'ibile_pos';

/**
 * How the database compresses what it writes, for collections and for the journal.
 *
 * Not MongoDB's default, Snappy: the Windows build of MongoDB 8.0 reads Snappy data with a BMI2
 * instruction without asking the processor first (SERVER-103289, fixed in 8.3). A processor
 * without BMI2 — a Celeron J1900, a Pentium, any Core older than Haswell — runs mongod on an empty
 * folder and then dies with "illegal instruction" the first time it reads data back from disk, so
 * the till worked once and then asked to start again with an empty database every time. zstd has
 * no such path (checked on an emulated Silvermont, the J1900's core). Collections a folder already
 * has keep the compression they were written with.
 */
const BLOCK_COMPRESSOR = 'zstd';

// 0xC000001D STATUS_ILLEGAL_INSTRUCTION, when Windows reports it as the exit code
const ILLEGAL_INSTRUCTION_EXIT = 3221225501;

/**
 * WiredTiger's cache. Half a gigabyte by default; a till with 4 GB or less also runs Windows, the
 * POS window and the POS service in it, so the database takes the smallest cache MongoDB allows.
 */
const cacheSizeGB = () => (os.totalmem() <= 4.5 * 1024 ** 3 ? '0.25' : '0.5');

const isAuthError = (error) =>
  error?.code === 18 || error?.code === 13 || /Authentication failed|requires authentication/i.test(error?.message || '');

const CPU_MESSAGE =
  "This computer's processor does not have an instruction the local database used, so the database " +
  'stopped. Send the logs folder (SYSTEM → Open logs folder) to support; a newer computer avoids it.';

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
  // 0xC000001D STATUS_ILLEGAL_INSTRUCTION, before mongod's own crash handler was in place
  [ILLEGAL_INSTRUCTION_EXIT]: {
    reason: 'cpu',
    message: CPU_MESSAGE,
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
    let illegalInstruction = false;

    for (const line of lines) {
      let entry = null;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // mongod also writes plain lines; only its JSON carries severities
      }
      if (entry.s !== 'E' && entry.s !== 'F') continue;
      // mongod's crash handler names the Windows exception: 0xC000001D is an instruction this
      // processor does not have, which no repair of the files can help
      if (/unhandled exception/i.test(entry.msg || '') && /C000001D|illegal instruction/i.test(JSON.stringify(entry.attr || {}))) {
        illegalInstruction = true;
      }
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
      illegalInstruction,
    };
  } catch {
    // No log to read yet, so nothing is claimed about the cause
    return { summary: '', blocked: false, socket: false, incompleteRepair: false, inUse: false, illegalInstruction: false };
  }
}

class LocalDatabaseStartError extends Error {
  constructor(message, { exitCode = null, reason = 'exit' } = {}) {
    super(message);
    this.name = 'LocalDatabaseStartError';
    this.exitCode = exitCode;
    this.reason = reason;
    // Only an exit with nothing else known about it: a blocked folder, a folder in use or a
    // processor that cannot run the code are not mended by rebuilding the files
    this.repairable = reason === 'exit' && REPAIRABLE_EXIT_CODES.has(Number(exitCode));
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

/** mongod's storage settings; existing collections keep what they were written with. */
const storageArgs = () => [
  '--wiredTigerCollectionBlockCompressor', BLOCK_COMPRESSOR,
  '--wiredTigerJournalCompressor', BLOCK_COMPRESSOR,
];

/**
 * Sends mongod's output to its log file and resolves once every line of it is on disk.
 *
 * Both pipes write to the one file, so neither may end it: whichever stream finished first used to
 * close the file under the other, losing the last lines — the ones that say why mongod stopped,
 * read straight after it exits to decide between repairing, moving port or reporting.
 */
function pipeToLog(child, output) {
  child.stdout?.pipe(output, { end: false });
  child.stderr?.pipe(output, { end: false });
  output.on('error', () => {});
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      output.end(() => resolve());
    };
    child.once('close', finish);
    // 'close' does not follow a program that never started
    child.once('error', () => setTimeout(finish, 100));
  });
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
    // Called when the folder is set aside because this processor cannot read it (main.js says so)
    this.onNewFolder = null;
    // The folder set aside by that, if it happened in this session
    this.keptFolder = null;
    this.flushed = null;
  }

  /* -------------------------------------------------- what the folder was written with */

  folderHasData() {
    // WiredTiger writes this file the first time it opens a folder
    return fs.existsSync(path.join(this.paths.dbPath, 'WiredTiger'));
  }

  /** Was this folder started empty by a version that writes zstd (no Snappy anywhere in it)? */
  folderIsSnappyFree() {
    const format = this.config.get('localDatabaseFormat');
    return Boolean(
      format?.compressor === BLOCK_COMPRESSOR &&
        format.path &&
        path.resolve(format.path).toLowerCase() === path.resolve(this.paths.dbPath).toLowerCase()
    );
  }

  /** An empty folder is about to be written with zstd: remember it, so a later crash is read right. */
  noteFolderFormat() {
    if (this.folderHasData()) return;
    this.config.set({
      localDatabaseFormat: { path: this.paths.dbPath, compressor: BLOCK_COMPRESSOR, since: new Date().toISOString() },
    });
  }

  /** Does this processor have AVX2, and so BMI2 (lib/cpu.js)? Asked once per computer. */
  async processorReadsSnappy() {
    let processor = this.config.get('processor');
    if (typeof processor?.avx2 !== 'boolean') {
      const avx2 = await hasAvx2();
      // Not remembered when Windows could not be asked: it is asked again next start
      if (avx2 === null) return false;
      processor = { avx2, checkedAt: new Date().toISOString() };
      this.config.set({ processor });
      this.log.info(`Processor ${avx2 ? 'has' : 'does not have'} AVX2/BMI2`);
    }
    return processor.avx2;
  }

  /**
   * On a processor that may lack BMI2, a folder an earlier version wrote (Snappy) is read through
   * once, right after the database starts: if this computer cannot read it, mongod stops on the
   * first page and start() moves to a new folder — here, before the POS opens, rather than in the
   * middle of the start-up or a sale. Done once per folder and computer.
   */
  async readOldDataOnce() {
    if (!this.folderHasData() || this.folderIsSnappyFree()) return;
    const samePath = (other) => Boolean(other) && path.resolve(other).toLowerCase() === path.resolve(this.paths.dbPath).toLowerCase();
    if (samePath(this.config.get('oldDataReadable')?.path)) return;
    if (await this.processorReadsSnappy()) return;

    this.log.info('Checking that this computer can read the data the local database saved before');
    const client = new MongoClient(this.uri('admin'), { serverSelectionTimeoutMS: 10000 });
    try {
      await client.connect();
      const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
      // The till's own data first; MongoDB's internal config and local databases are its own business
      // (even root may not read config.system.sessions)
      const names = databases
        .map(({ name }) => name)
        .filter((name) => !['config', 'local'].includes(name))
        .sort((a, b) => (a === DATABASE_NAME ? -1 : b === DATABASE_NAME ? 1 : a.localeCompare(b)));
      for (const name of names) {
        const db = client.db(name);
        for (const { name: collection, type } of await db.listCollections({}, { nameOnly: true }).toArray()) {
          if (type === 'view') continue;
          try {
            // Every page is decompressed once; nothing is kept
            const cursor = db.collection(collection).find({}, { projection: { _id: 1 }, batchSize: 2000 });
            while (await cursor.next()) {
              // reading is the test
            }
          } catch (error) {
            // A collection this user may not read says nothing about the files; a stopped mongod does
            if (error?.code !== 13) throw error;
          }
        }
      }
      this.config.set({ oldDataReadable: { path: this.paths.dbPath, at: new Date().toISOString() } });
      this.log.info('The data saved before reads on this computer');
    } catch (error) {
      // The connection drops a moment before Windows reports mongod gone
      for (let waited = 0; waited < 5000 && !this.exitInfo; waited += 100) await sleep(100);
      // mongod stopped: start() decides what that means. Anything else is not this check's to judge.
      if (this.exitInfo) throw error;
      this.log.warn(`Could not finish reading the data saved before: ${error.message}`);
    } finally {
      await client.close().catch(() => {});
    }
  }

  /** Lets the last run's own lines reach mongod.log before they are read. */
  logFlushed() {
    return Promise.race([this.flushed || Promise.resolve(), sleep(5000)]);
  }

  /** Did the mongod started last, in this session, die on an instruction this processor lacks? */
  async lastRunHitIllegalInstruction() {
    if (!this.exitInfo || this.exitInfo.code === 0) return false;
    await this.logFlushed();
    return (
      this.exitInfo.code === ILLEGAL_INSTRUCTION_EXIT ||
      readMongodFailure(this.paths.logsDir, this.runLogStart).illegalInstruction
    );
  }

  /**
   * The folder holds Snappy data this processor cannot read (see BLOCK_COMPRESSOR): it never will
   * on this computer, and asking about it every start does not change that. It is set aside — kept,
   * for any sale that had not reached the cloud — and a new folder, written with zstd, takes its
   * place; the till then downloads the store's data again, as after "start again with an empty
   * database", without anyone being asked.
   */
  async restartInNewFolder() {
    this.log.warn(
      "This computer's processor cannot read the data the local database saved before (Snappy, which " +
        'MongoDB 8.0 reads with a BMI2 instruction this processor does not have). Starting a new local ' +
        "database written with zstd; the store's data comes back from the cloud."
    );
    this.onNewFolder?.();
    if (this.child && !this.exitInfo) await this.stop();
    this.keptFolder = await this.setAsideDataFolderWhenFree();
    this.noteFolderFormat();
    await this.launch();
    await this.ensureUser();
    this.log.info(`Local database ready on 127.0.0.1:${this.port}`);
    return this.uri();
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

    // Read before anything is started: the last run in this session (the database stopped and is
    // being restarted) may have died reading Snappy data this processor cannot read
    const previousRunHitIllegalInstruction = await this.lastRunHitIllegalInstruction();

    this.port = this.config.get('mongoPort');
    if (!(await isPortFree(this.port))) {
      const previous = this.port;
      this.port = await findFreePort(previous + 1);
      this.config.set({ mongoPort: this.port });
      this.log.warn(`Database port ${previous} is in use; using ${this.port}`);
    }

    if (previousRunHitIllegalInstruction && this.folderHasData() && !this.folderIsSnappyFree()) {
      return this.restartInNewFolder();
    }
    this.noteFolderFormat();

    try {
      await this.launch();
    } catch (error) {
      // An instruction this processor lacks, on a folder that may hold Snappy data: see restartInNewFolder
      if (error.reason === 'cpu' && this.folderHasData() && !this.folderIsSnappyFree()) {
        return this.restartInNewFolder();
      }
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
        // The repair read the files and died on an instruction this processor lacks: they are not
        // damaged, they are Snappy this computer cannot read (see restartInNewFolder)
        if (failure.illegalInstruction && !this.folderIsSnappyFree()) return this.restartInNewFolder();
        if (failure.illegalInstruction) {
          throw new LocalDatabaseStartError(CPU_MESSAGE, { exitCode: error.exitCode, reason: 'cpu' });
        }
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

    try {
      await this.ensureUser();
      await this.readOldDataOnce();
    } catch (error) {
      // Signing in and the read-through are the first reads of stored data: a processor that cannot
      // read Snappy stops in one of them
      if ((await this.lastRunHitIllegalInstruction()) && this.folderHasData() && !this.folderIsSnappyFree()) {
        return this.restartInNewFolder();
      }
      throw error;
    }
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
      '--wiredTigerCacheSizeGB', cacheSizeGB(),
      ...storageArgs(),
      '--setParameter', 'diagnosticDataCollectionEnabled=false',
    ];

    const output = openLogStream(logsDir, 'mongod.log');
    this.runLogStart = mongodLogSize(logsDir);
    this.stopping = false;
    this.exitInfo = null;
    this.child = spawn(mongod, args, { cwd: dbPath, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.flushed = pipeToLog(this.child, output);
    if (this.child.pid) writePid(runDir, 'mongod', this.child.pid);

    // A program Windows would not start at all (blocked, removed after the check) never exits
    this.child.once('error', (error) => {
      this.exitInfo = { code: null, signal: null, error };
      this.log.error(`Could not start the local database: ${error.message}`);
    });
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
    const child = spawn(mongod, ['--dbpath', dbPath, '--repair', '--wiredTigerCacheSizeGB', cacheSizeGB(), ...storageArgs()], {
      cwd: dbPath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const flushed = pipeToLog(child, output);

    const finished = await new Promise((resolve) => {
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
    // What it said is read next, to say why it failed
    await Promise.race([flushed, sleep(5000)]);
    return finished;
  }

  /**
   * setAsideDataFolder, straight after mongod stopped: Windows can hold its files a moment longer
   * (and antivirus looks at them as they close), so the move is tried again for a few seconds.
   */
  async setAsideDataFolderWhenFree() {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return this.setAsideDataFolder();
      } catch (error) {
        if (attempt >= 20 || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        await sleep(500);
      }
    }
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
        // Its last lines say why it stopped; they are read once they are all in the file
        await this.logFlushed();
        const failure = readMongodFailure(this.paths.logsDir, this.runLogStart);
        // Caught by mongod's own crash handler, which exits 14 like any other crash
        if (failure.illegalInstruction) {
          throw new LocalDatabaseStartError(`${CPU_MESSAGE} (exit code ${code})`, { exitCode: code, reason: 'cpu' });
        }
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
