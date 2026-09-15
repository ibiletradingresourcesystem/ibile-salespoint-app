#!/usr/bin/env node
'use strict';

/**
 * Builds the POS as a self-contained server for the desktop app:
 *   build/desktop/app-server/  (server.js, minimal node_modules, .next, public)
 *
 * The Vercel build is unaffected: standalone output is only enabled with BUILD_TARGET=desktop.
 * Environment files are removed and the output is checked for the cloud database address, because
 * the installer is given to customers.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const standalone = path.join(root, '.next', 'standalone');
const out = path.join(root, 'build', 'desktop', 'app-server');

function run() {
  console.log('Building the POS server for the desktop app…');
  const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next', { paths: [root] }), 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, BUILD_TARGET: 'desktop', NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (result.status !== 0) process.exit(result.status || 1);

  if (!fs.existsSync(path.join(standalone, 'server.js'))) {
    throw new Error(`Expected ${path.join(standalone, 'server.js')} after the build. Check next.config.mjs output settings.`);
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.cpSync(standalone, out, { recursive: true, dereference: true });
  fs.cpSync(path.join(root, '.next', 'static'), path.join(out, '.next', 'static'), { recursive: true });
  fs.cpSync(path.join(root, 'public'), path.join(out, 'public'), { recursive: true });

  for (const name of fs.readdirSync(out)) {
    if (name.startsWith('.env')) {
      fs.rmSync(path.join(out, name), { force: true });
      console.log(`Removed ${name} from the desktop server`);
    }
  }

  assertNoCloudCredentials();
  console.log(`Desktop server ready: ${out}`);
}

/** Every secret-looking value from the project's env files (database URI, mail passwords, secrets). */
function readEnvSecrets() {
  const secrets = new Map();
  for (const name of ['.env.production.local', '.env.local', '.env.production', '.env']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/^\s*([A-Z0-9_]+)\s*=\s*["']?([^"'\r\n]*)["']?/gm)) {
      const value = match[2].trim();
      if (/(URI|URL|PASS|SECRET|KEY|TOKEN)/.test(match[1]) && value.length >= 12 && !/^https?:\/\/localhost/i.test(value)) {
        secrets.set(match[1], value);
      }
    }
  }
  return secrets;
}

function assertNoCloudCredentials() {
  const secrets = readEnvSecrets();
  if (secrets.size === 0) return;

  const stack = [out];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') stack.push(full);
        continue;
      }
      if (!/\.(js|json|env|txt|html)$/i.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      const leaked = [...secrets].filter(([, value]) => text.includes(value)).map(([key]) => key);
      if (leaked.length > 0) {
        throw new Error(`${leaked.join(', ')} from the env file was found in ${full}. The desktop build must not contain cloud secrets.`);
      }
    }
  }
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
