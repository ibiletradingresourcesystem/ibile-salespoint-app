'use strict';

/**
 * Turns a mongodb+srv:// connection string into a standard mongodb://host1,host2,... string.
 *
 * Why: the MongoDB driver looks up the SRV and TXT records of an Atlas address with Node's own DNS
 * client. Some shop networks and routers answer those queries badly (querySrv EBADRESP/ECONNREFUSED)
 * even though the internet and Windows' DNS work, which made the POS report "offline" forever.
 * Here the records are looked up in turn with Node's DNS, Windows' DNS client and DNS over HTTPS,
 * and the POS connects with the resulting host list, which only needs ordinary address lookups.
 *
 * The same rules as the driver apply: every host must be in the Atlas address's own domain, and
 * TLS stays on. Nothing here logs or returns the credentials.
 */

const dns = require('dns');
const { spawn } = require('child_process');

const LOOKUP_TIMEOUT_MS = 8000;
const ALLOWED_TXT_OPTIONS = new Set(['authsource', 'replicaset', 'loadbalanced']);
const SRV_ONLY_OPTIONS = new Set(['srvmaxhosts', 'srvservicename']);

function parseSrvUri(uri) {
  const match = /^mongodb\+srv:\/\/(?:([^@/]*)@)?([^/?,:]+)(\/[^?]*)?(?:\?(.*))?$/i.exec(String(uri || '').trim());
  if (!match) return null;
  const [, userInfo = '', host, path = '/', query = ''] = match;
  return { userInfo, host: host.toLowerCase(), path: path || '/', params: new URLSearchParams(query) };
}

const isSrvUri = (uri) => /^mongodb\+srv:\/\//i.test(String(uri || '').trim());

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), LOOKUP_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/* ------------------------------------------------------------------ resolvers */
// lookup(srvName, host) -> { targets: [{ host, port }], txt: string[] | null }  (txt null = not available)

const nodeResolver = {
  name: 'Node DNS',
  async lookup(srvName, host) {
    const [srv, txt] = await Promise.allSettled([dns.promises.resolveSrv(srvName), dns.promises.resolveTxt(host)]);
    if (srv.status === 'rejected') throw srv.reason;
    return {
      targets: srv.value.map((record) => ({ host: record.name, port: record.port })),
      txt: txt.status === 'fulfilled' ? txt.value.map((chunks) => chunks.join('')) : null,
    };
  },
};

const windowsResolver = {
  name: 'Windows DNS',
  lookup(srvName, host) {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32') return reject(new Error('only on Windows'));
      // One PowerShell start for both records (each start takes a second or two)
      const script = [
        "$srv = @(Resolve-DnsName -Name $env:IBILE_SRV_NAME -Type SRV -DnsOnly -ErrorAction Stop | Where-Object { $_.Type -eq 'SRV' } | ForEach-Object { @{ host = $_.NameTarget; port = [int]$_.Port } })",
        "$txt = $null; try { $txt = @(Resolve-DnsName -Name $env:IBILE_TXT_NAME -Type TXT -DnsOnly -ErrorAction Stop | Where-Object { $_.Type -eq 'TXT' } | ForEach-Object { $_.Strings -join '' }) } catch { }",
        '@{ targets = $srv; txt = $txt } | ConvertTo-Json -Compress -Depth 4',
      ].join('; ');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        env: { ...process.env, IBILE_SRV_NAME: srvName, IBILE_TXT_NAME: host },
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== 0) return reject(new Error(`lookup failed (${code})`));
        try {
          const parsed = JSON.parse(output.trim());
          resolve({
            targets: asArray(parsed.targets).map((t) => ({ host: t.host, port: Number(t.port) })),
            txt: parsed.txt == null ? null : asArray(parsed.txt).map(String),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  },
};

async function dohQuery(name, type) {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  ];
  const typeCode = type === 'SRV' ? 33 : 16;
  let lastError;
  for (const url of endpoints) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`answered ${response.status}`);
      const body = await response.json();
      return (body.Answer || []).filter((answer) => answer.type === typeCode).map((answer) => String(answer.data));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const httpsResolver = {
  name: 'DNS over HTTPS',
  async lookup(srvName, host) {
    const [srv, txt] = await Promise.allSettled([dohQuery(srvName, 'SRV'), dohQuery(host, 'TXT')]);
    if (srv.status === 'rejected') throw srv.reason;
    return {
      targets: srv.value.map((data) => {
        const [, , port, target] = data.trim().split(/\s+/);
        return { host: target, port: Number(port) };
      }),
      txt: txt.status === 'fulfilled'
        ? txt.value.map((data) => (data.match(/"((?:[^"\\]|\\.)*)"/g) || [data]).map((part) => part.replace(/^"|"$/g, '')).join(''))
        : null,
    };
  },
};

const RESOLVERS = [nodeResolver, windowsResolver, httpsResolver];

/* ------------------------------------------------------------------ conversion */

const stripDot = (host) => String(host || '').replace(/\.$/, '').toLowerCase();

function assertSameDomain(srvHost, targets) {
  const domain = srvHost.split('.').slice(1).join('.');
  for (const target of targets) {
    const host = stripDot(target.host);
    if (!domain || !(host === domain || host.endsWith(`.${domain}`))) {
      throw new Error(`returned a host outside ${domain}`);
    }
  }
}

/**
 * Resolves the SRV/TXT records with the first resolver that works.
 * Returns { uri, hosts, resolver } (uri unchanged for mongodb:// strings); throws SRV_LOOKUP_FAILED
 * with a message that does not contain the credentials.
 */
async function resolveSrvConnectionString(uri, { log, resolvers = RESOLVERS } = {}) {
  const parsed = parseSrvUri(uri);
  if (!parsed) return { uri, hosts: [], resolver: null };

  const srvName = `_${parsed.params.get('srvServiceName') || 'mongodb'}._tcp.${parsed.host}`;
  const failures = [];

  for (const resolver of resolvers) {
    let result;
    try {
      result = await withTimeout(resolver.lookup(srvName, parsed.host), resolver.name);
      result.targets = result.targets.filter((t) => t.host && t.port);
      if (result.targets.length === 0) throw new Error('no SRV records');
      assertSameDomain(parsed.host, result.targets);
    } catch (error) {
      failures.push(`${resolver.name}: ${String(error?.code || error?.message || error).slice(0, 120)}`);
      continue;
    }

    let txt = result.txt;
    for (const other of resolvers) {
      if (txt !== null) break;
      if (other === resolver) continue;
      txt = await withTimeout(other.lookup(srvName, parsed.host), other.name).then((r) => r.txt).catch(() => null);
    }

    const params = new URLSearchParams();
    if (txt?.length > 1) throw Object.assign(new Error('The database address has more than one TXT record'), { code: 'SRV_LOOKUP_FAILED' });
    for (const [key, value] of new URLSearchParams(txt?.[0] || '')) {
      if (ALLOWED_TXT_OPTIONS.has(key.toLowerCase())) params.set(key, value);
    }
    for (const [key, value] of parsed.params) {
      if (!SRV_ONLY_OPTIONS.has(key.toLowerCase())) params.set(key, value);
    }
    if (![...params.keys()].some((key) => /^(tls|ssl)$/i.test(key))) params.set('tls', 'true');

    const hosts = result.targets.map((t) => `${stripDot(t.host)}:${t.port}`).sort();
    const maxHosts = Number(parsed.params.get('srvMaxHosts') || 0);
    const selected = maxHosts > 0 ? hosts.slice(0, maxHosts) : hosts;
    const auth = parsed.userInfo ? `${parsed.userInfo}@` : '';
    const query = params.toString();

    if (failures.length > 0) log?.warn(`Cloud database address looked up with ${resolver.name} (${failures.join('; ')})`);
    return {
      uri: `mongodb://${auth}${selected.join(',')}${parsed.path}${query ? `?${query}` : ''}`,
      hosts: selected,
      resolver: resolver.name,
    };
  }

  const error = new Error(`The cloud database address (${parsed.host}) could not be looked up (${failures.join('; ')}).`);
  error.code = 'SRV_LOOKUP_FAILED';
  throw error;
}

module.exports = { resolveSrvConnectionString, isSrvUri, parseSrvUri, RESOLVERS };
