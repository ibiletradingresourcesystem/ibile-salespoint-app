'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(preferred) {
  for (let port = preferred; port < preferred + 100; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found near ${preferred}`);
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Ends a process and everything it started (next dev starts its own workers). */
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
      resolve();
    }
  });
}

function processImageName(pid) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve('');
      const match = /^"([^"]+)"/.exec(String(stdout).trim());
      resolve(match ? match[1].toLowerCase() : '');
    });
  });
}

const pidFile = (runDir, name) => path.join(runDir, `${name}.pid`);

function writePid(runDir, name, pid) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(pidFile(runDir, name), String(pid));
}

function clearPid(runDir, name) {
  try {
    fs.unlinkSync(pidFile(runDir, name));
  } catch {
    // ignore
  }
}

/** Stops a process left running by a previous session that crashed, if it is still ours. */
async function killOrphan(runDir, name, imageName, log) {
  let pid;
  try {
    pid = Number.parseInt(fs.readFileSync(pidFile(runDir, name), 'utf8'), 10);
  } catch {
    return;
  }
  // Windows reuses process ids; never stop this app itself
  if (!pid || pid === process.pid) return clearPid(runDir, name);

  const image = await processImageName(pid);
  if (image && image === imageName.toLowerCase()) {
    log.warn(`Stopping ${name} left running by a previous session (pid ${pid})`);
    await killTree(pid);
    await sleep(1500);
  }
  clearPid(runDir, name);
}

module.exports = {
  sleep,
  isPortFree,
  findFreePort,
  waitForExit,
  killTree,
  writePid,
  clearPid,
  killOrphan,
};
