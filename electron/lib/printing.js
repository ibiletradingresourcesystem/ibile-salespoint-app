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
const paperWidthCache = new Map();

/**
 * The width of the paper this printer is set to, in microns ('' = the Windows default printer), or
 * 0 when the driver does not say.
 *
 * A thermal printer cannot print to the edge of its roll — an 80 mm roll prints about 72 mm — and
 * its driver usually calls that the paper size. Asking Windows for a page as wide as the roll makes
 * it shrink the whole receipt to fit, which leaves white down both sides. Printing a page of exactly
 * the driver's own paper size is one-to-one, so the receipt fills the roll.
 *
 * The figure has to match the driver's paper exactly, or Windows treats it as a custom size that the
 * printer may refuse, so it is kept in the driver's own units (hundredths of an inch) to the end.
 * Drivers disagree about which figure is which — this test printer reports a printable area wider
 * than its own paper — so the smallest sensible one is used.
 */
function driverPaperWidthMicrons(deviceName = '') {
  if (process.platform !== 'win32') return Promise.resolve(0);
  const key = deviceName || '(default)';
  if (paperWidthCache.has(key)) return Promise.resolve(paperWidthCache.get(key));

  const script = [
    'Add-Type -AssemblyName System.Drawing;',
    '$s = New-Object System.Drawing.Printing.PrinterSettings;',
    deviceName ? `$s.PrinterName = '${deviceName.replace(/'/g, "''")}';` : '',
    'if (-not $s.IsValid) { exit };',
    '$p = $s.DefaultPageSettings;',
    // All three are in hundredths of an inch
    "'{0} {1} {2}' -f $p.PaperSize.Width, $p.Bounds.Width, $p.PrintableArea.Width",
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
        // 1 hundredth of an inch = 254 microns, kept whole so the page matches the driver's paper
        const microns = figures.length ? Math.round(Math.min(...figures) * 254) : 0;
        const usable = microns >= 30 * MM_TO_MICRONS && microns <= 120 * MM_TO_MICRONS ? microns : 0;
        paperWidthCache.set(key, usable);
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

async function printOnce({
  html,
  deviceName = '',
  silent = true,
  paperWidth = 80,
  fitToContent = true,
  usePaperWidth = true,
  log,
}) {
  const roll = Number(paperWidth) === 58 ? 58 : 80;
  const rollMicrons = roll * MM_TO_MICRONS;
  // Print a page the size of the printer's own paper, so Windows never shrinks the receipt to fit
  const fromDriver = usePaperWidth ? await driverPaperWidthMicrons(deviceName).catch(() => 0) : 0;
  const widthMicrons = fromDriver > 0 && fromDriver <= rollMicrons ? fromDriver : rollMicrons;
  if (widthMicrons !== rollMicrons) {
    log?.info?.(`Printing on this printer's own paper width: ${(widthMicrons / MM_TO_MICRONS).toFixed(1)} mm (${roll} mm roll)`);
  }
  const widthPx = (widthMicrons / PX_TO_MICRONS);
  const file = path.join(os.tmpdir(), `ibile-pos-print-${crypto.randomBytes(8).toString('hex')}.html`);
  fs.writeFileSync(file, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    // Roughly the page width, so the printout is measured the way it will print
    width: Math.round(widthPx) + 40,
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
      options.pageSize = { width: widthMicrons, height: heightMicrons };
    }

    const send = (printOptions) =>
      new Promise((resolve) => {
        win.webContents.print(printOptions, (success, failureReason) => {
          if (success) resolve({ ok: true });
          else if (/cancel/i.test(failureReason || '')) resolve({ ok: false, canceled: true, error: 'Printing was cancelled' });
          else resolve({ ok: false, error: failureReason ? `Printing failed: ${failureReason}` : 'Printing failed' });
        });
      });

    const result = await send(options);
    // A driver that will not take the page we asked for still has its own: print on that rather
    // than hand the till an error, and say so in the log
    if (!result.ok && !result.canceled && options.pageSize) {
      log?.warn?.(`${result.error} — printing again on the printer's default page size`);
      const { pageSize, ...withoutPageSize } = options;
      const retry = await send(withoutPageSize);
      if (retry.ok) return retry;
    }
    return result;
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

module.exports = { listPrinters, printHtml, driverPaperWidthMicrons };
