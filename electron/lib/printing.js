'use strict';

/**
 * Printing for the desktop app, through Windows printer drivers (no browser print dialog needed).
 *
 * The page builds the printout as HTML (receipt, end-of-day report) exactly as for browser printing.
 * It is loaded into a hidden, sandboxed window with no access to the app, then printed either
 * silently to the chosen printer or with the Windows print dialog. Raw ESC/POS printing to thermal
 * printers stays in the POS server (/api/printer/print-direct).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { BrowserWindow } = require('electron');

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const IMAGE_WAIT_MS = 3000;
const MM_TO_MICRONS = 1000;
const PX_TO_MICRONS = 25400 / 96;

let queue = Promise.resolve();
const printableWidthCache = new Map();

/**
 * How wide this printer can actually print, in mm ('' printer = the Windows default), or 0 when the
 * driver does not say. A thermal printer keeps a margin at each edge its head cannot reach, and its
 * paper size is often set to that printable width (72 mm for an 80 mm roll). Asking for a page wider
 * than that makes Windows shrink the whole receipt to fit, so it comes out narrower than the paper
 * with white down both sides. A page of exactly this width prints one-to-one and fills the roll.
 *
 * Drivers disagree about which of the two figures is which — this printer reports a printable area
 * wider than its own paper — so the smaller of the two is used, and anything outside a sane roll
 * width is ignored.
 */
function printableWidthMm(deviceName = '') {
  if (process.platform !== 'win32') return Promise.resolve(0);
  const key = deviceName || '(default)';
  if (printableWidthCache.has(key)) return Promise.resolve(printableWidthCache.get(key));

  const script = [
    'Add-Type -AssemblyName System.Drawing;',
    '$s = New-Object System.Drawing.Printing.PrinterSettings;',
    deviceName ? `$s.PrinterName = '${deviceName.replace(/'/g, "''")}';` : '',
    'if (-not $s.IsValid) { exit };',
    // Both are in hundredths of an inch
    "'{0} {1}' -f $s.DefaultPageSettings.PrintableArea.Width, $s.DefaultPageSettings.Bounds.Width",
  ].join(' ');

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      (error, stdout) => {
        const figures = error
          ? []
          : String(stdout)
              .trim()
              .split(/\s+/)
              .map(Number)
              .filter((value) => Number.isFinite(value) && value > 0);
        const mm = figures.length ? (Math.min(...figures) / 100) * 25.4 : 0;
        const usable = mm >= 30 && mm <= 120 ? Math.round(mm * 10) / 10 : 0;
        printableWidthCache.set(key, usable);
        resolve(usable);
      }
    );
  });
}

/** The Windows default printer for this user ('' if none), from HKCU\...\Windows "Device" ("Name,winspool,Ne01:"). */
function windowsDefaultPrinter() {
  if (process.platform !== 'win32') return Promise.resolve('');
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows', '/v', 'Device'],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        const match = !error && /Device\s+REG_SZ\s+(.+)/i.exec(String(stdout));
        resolve(match ? match[1].trim().split(',')[0] : '');
      }
    );
  });
}

/** Printers installed in Windows: [{ name, displayName, isDefault, description }] */
async function listPrinters(webContents) {
  // Electron no longer reports which printer is the default
  const [printers, defaultName] = await Promise.all([webContents.getPrintersAsync(), windowsDefaultPrinter()]);
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
    description: printer.description || '',
    isDefault: Boolean(printer.isDefault) || (Boolean(defaultName) && printer.name === defaultName),
  }));
}

function waitForImages(webContents) {
  return webContents
    .executeJavaScript(
      `new Promise((resolve) => {
        const pending = [...document.images].filter((img) => !img.complete);
        if (pending.length === 0) return resolve(true);
        let left = pending.length;
        const done = () => { left -= 1; if (left <= 0) resolve(true); };
        pending.forEach((img) => { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); });
        setTimeout(() => resolve(false), ${IMAGE_WAIT_MS});
      })`,
      true
    )
    .catch(() => false);
}

async function printOnce({ html, deviceName = '', silent = true, paperWidth = 80, fitToContent = true, log }) {
  const roll = Number(paperWidth) === 58 ? 58 : 80;
  // Lay out and print at what the printer can actually cover, so the receipt fills the paper
  const printable = await printableWidthMm(deviceName).catch(() => 0);
  const width = printable > 0 && printable <= roll ? printable : roll;
  if (printable > 0 && printable !== roll) log?.info?.(`Printing at the printer's printable width: ${width} mm of ${roll} mm paper`);
  const file = path.join(os.tmpdir(), `ibile-pos-print-${crypto.randomBytes(8).toString('hex')}.html`);
  fs.writeFileSync(file, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    // Roughly the roll width, so the page is measured the way it will print
    width: Math.round((width / 25.4) * 96) + 40,
    height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  try {
    await win.loadFile(file);
    await waitForImages(win.webContents);

    const options = {
      silent,
      printBackground: true,
      deviceName: deviceName || undefined,
      margins: { marginType: 'none' },
    };
    if (fitToContent) {
      // Thermal rolls: page as long as the printout, so no blank paper is fed after it
      // Bottom of the content itself; the document is never shorter than the window, so it can't be used
      const heightPx = await win.webContents
        .executeJavaScript(
          'Math.ceil(Math.max(0, ...[...document.body.querySelectorAll("*")].map((el) => el.getBoundingClientRect().bottom + window.scrollY)))',
          true
        )
        .catch(() => 0);
      const heightMicrons = Math.max(50 * MM_TO_MICRONS, Math.ceil(heightPx * PX_TO_MICRONS) + 5 * MM_TO_MICRONS);
      options.pageSize = { width: Math.round(width * MM_TO_MICRONS), height: heightMicrons };
    }

    return await new Promise((resolve) => {
      win.webContents.print(options, (success, failureReason) => {
        if (success) resolve({ ok: true });
        else if (/cancel/i.test(failureReason || '')) resolve({ ok: false, canceled: true, error: 'Printing was cancelled' });
        else resolve({ ok: false, error: failureReason ? `Printing failed: ${failureReason}` : 'Printing failed' });
      });
    });
  } catch (error) {
    log?.error('Printing failed', error);
    return { ok: false, error: error.message };
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // removed with the temp folder later
    }
  }
}

/**
 * Prints one HTML document. Jobs run one after another so receipts never interleave.
 * { html, deviceName ('' = Windows default printer), silent, paperWidth (80 | 58), fitToContent }
 */
function printHtml(job, { log, webContents } = {}) {
  const html = String(job?.html || '');
  if (!html) return Promise.resolve({ ok: false, error: 'Nothing to print' });
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) return Promise.resolve({ ok: false, error: 'The printout is too large' });

  const run = async () => {
    const deviceName = String(job.deviceName || '').trim();
    if (deviceName && webContents) {
      const printers = await listPrinters(webContents).catch(() => []);
      if (printers.length > 0 && !printers.some((printer) => printer.name === deviceName)) {
        return { ok: false, error: `Printer "${deviceName}" is not installed on this computer` };
      }
    }
    return printOnce({ ...job, html, deviceName, silent: job.silent !== false, log });
  };

  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

module.exports = { listPrinters, printHtml, printableWidthMm };
