'use strict';

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

function rotate(file) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_BYTES) return;
    for (let index = KEEP - 1; index >= 1; index -= 1) {
      const from = `${file}.${index}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${file}.${index + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
  } catch {
    // Logging must never stop the app
  }
}

/** Append-only log stream for a child process (server, database). */
function openLogStream(logsDir, name) {
  fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, name);
  rotate(file);
  return fs.createWriteStream(file, { flags: 'a' });
}

function createLogger(logsDir) {
  fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, 'main.log');
  rotate(file);

  const write = (level, parts) => {
    const text = parts
      .map((part) => (part instanceof Error ? part.stack || part.message : typeof part === 'string' ? part : JSON.stringify(part)))
      .join(' ');
    const line = `${new Date().toISOString()} [${level}] ${text}\n`;
    try {
      fs.appendFileSync(file, line);
    } catch {
      // ignore
    }
    if (level === 'error') console.error(line.trim());
    else console.log(line.trim());
  };

  return {
    file,
    info: (...parts) => write('info', parts),
    warn: (...parts) => write('warn', parts),
    error: (...parts) => write('error', parts),
  };
}

module.exports = { createLogger, openLogStream };
