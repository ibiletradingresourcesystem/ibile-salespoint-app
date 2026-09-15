'use strict';

/**
 * Runs the existing System POS (Next.js app and its API routes) on this computer.
 *
 * Packaged: the standalone server built by scripts/desktop/build-server.js, run by the app's own
 * executable in Node mode. Development: `next dev` from the repository.
 */

const path = require('path');
const { spawn } = require('child_process');
const { openLogStream } = require('./logger');
const { findFreePort, isPortFree, killOrphan, killTree, sleep, waitForExit, writePid, clearPid } = require('./processes');

class LocalServer {
  constructor({ paths, config, log }) {
    this.paths = paths;
    this.config = config;
    this.log = log;
    this.child = null;
    this.port = null;
    this.exitInfo = null;
    this.stopping = false;
    this.onUnexpectedExit = null;
  }

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  async choosePort() {
    await killOrphan(this.paths.runDir, 'server', path.basename(process.execPath), this.log);
    const preferred = this.config.get('serverPort');
    if (await isPortFree(preferred)) return preferred;

    // The page origin includes the port, and browser storage (device id, cached settings) belongs to
    // the origin, so a new port is only chosen when the usual one is taken by another program
    const port = await findFreePort(preferred + 1);
    this.log.warn(`POS port ${preferred} is in use by another program; using ${port}`);
    this.config.set({ serverPort: port });
    return port;
  }

  async start(env) {
    const { isDev, repoRoot, serverDir, logsDir, runDir } = this.paths;
    this.port = this.port || (await this.choosePort());

    const childEnv = {
      ...process.env,
      ...env,
      PORT: String(this.port),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: isDev ? 'development' : 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      ELECTRON_RUN_AS_NODE: '1',
    };

    const args = isDev
      ? [require.resolve('next/dist/bin/next', { paths: [repoRoot] }), 'dev', '-p', String(this.port), '-H', '127.0.0.1']
      : [path.join(serverDir, 'server.js')];

    const output = openLogStream(logsDir, 'server.log');
    this.exitInfo = null;
    this.stopping = false;
    this.child = spawn(process.execPath, args, {
      cwd: isDev ? repoRoot : serverDir,
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout.pipe(output);
    this.child.stderr.pipe(output);
    writePid(runDir, 'server', this.child.pid);

    this.child.once('exit', (code, signal) => {
      this.exitInfo = { code, signal };
      clearPid(runDir, 'server');
      if (!this.stopping) {
        this.log.error(`POS service stopped unexpectedly (code ${code}, signal ${signal})`);
        this.onUnexpectedExit?.(this.exitInfo);
      }
    });

    await this.waitUntilReady(isDev ? 240 * 1000 : 90 * 1000);
    this.log.info(`POS service ready at ${this.origin}`);
  }

  async waitUntilReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exitInfo) {
        throw new Error(`The POS service could not start (exit code ${this.exitInfo.code}). Details are in logs\\server.log.`);
      }
      try {
        const response = await fetch(`${this.origin}/api/desktop/status`, { signal: AbortSignal.timeout(5000) });
        if (response.status === 200 || response.status === 503) return;
      } catch {
        // not listening yet
      }
      await sleep(750);
    }
    throw new Error('The POS service did not start in time. Details are in logs\\server.log.');
  }

  async stop() {
    if (!this.child || this.exitInfo) return;
    this.stopping = true;
    await killTree(this.child.pid);
    await waitForExit(this.child, 10 * 1000);
    this.log.info('POS service stopped');
  }

  async restart(env) {
    await this.stop();
    await this.start(env);
  }
}

module.exports = { LocalServer };
