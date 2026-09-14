/**
 * Printer settings for this till (stored in this browser's localStorage).
 *
 * Receipt content and styling (logo, company details, font, QR, messages) come from the
 * management app's Receipt Settings. These settings only describe this till's printer:
 *
 *   printMethod    'browser' – print through the browser (works hosted online and locally)
 *                  'direct'  – send straight to the thermal printer, no dialog (POS running on the till PC)
 *                  'both'    – try direct first, fall back to browser printing
 *   connectionMode 'usb' (Windows printer queue named `printerName`) | 'network' (ip:port)
 *   paperWidth     80 | 58 (mm roll)
 *   printWidth     width the printer can actually print, in mm (80mm rolls print ~72mm)
 *   leftMargin     shift the receipt right, in mm, if the printer's print area is offset
 */

const STORAGE_KEY = 'printerSettings';

export const PRINT_METHODS = ['browser', 'direct', 'both'];
export const PAPER_WIDTHS = [80, 58];

// Printable width and ESC/POS characters per line (Font A) for each roll width
const PAPER_PROFILES = {
  80: { printWidth: 72, columns: 48 },
  58: { printWidth: 48, columns: 32 },
};

export function getDefaultPrinterSettings() {
  return {
    printMethod: 'browser',
    connectionMode: 'usb',
    printerName: 'XP-80C',
    ip: '192.168.1.100',
    port: 9100,
    paperWidth: 80,
    printWidth: PAPER_PROFILES[80].printWidth,
    leftMargin: 0,
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Fill in defaults, drop retired fields and migrate settings saved by older versions. */
export function normalizePrinterSettings(raw = {}) {
  const defaults = getDefaultPrinterSettings();
  const source = raw && typeof raw === 'object' ? raw : {};

  const paperWidth = PAPER_WIDTHS.includes(Number(source.paperWidth)) ? Number(source.paperWidth) : defaults.paperWidth;
  const profile = PAPER_PROFILES[paperWidth];
  // Older versions had an "enabled" switch; switched off meant browser printing only
  const printMethod = source.enabled === false
    ? 'browser'
    : PRINT_METHODS.includes(source.printMethod) ? source.printMethod : defaults.printMethod;
  // Older versions laid receipts out at the full paper width, which cut off the right-hand side
  const savedPrintWidth = Number(source.printWidth);
  const printWidth = Number.isFinite(savedPrintWidth) && savedPrintWidth > 0
    ? clampNumber(savedPrintWidth, 30, paperWidth, profile.printWidth)
    : profile.printWidth;

  return {
    printMethod,
    connectionMode: source.connectionMode === 'network' ? 'network' : 'usb',
    printerName: String(source.printerName || defaults.printerName).trim(),
    ip: String(source.ip || defaults.ip).trim(),
    port: Math.round(clampNumber(source.port, 1, 65535, defaults.port)),
    paperWidth,
    printWidth,
    leftMargin: clampNumber(source.leftMargin, 0, paperWidth - printWidth, 0),
  };
}

export function getPrinterSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return normalizePrinterSettings(stored ? JSON.parse(stored) : {});
  } catch {
    return getDefaultPrinterSettings();
  }
}

export function setPrinterSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePrinterSettings(settings)));
    return true;
  } catch (error) {
    console.error('Failed to save printer settings:', error);
    return false;
  }
}

/** Page geometry shared by every printout (receipts and end-of-day report). */
export function getPrintLayout(settings = getPrinterSettings()) {
  const normalized = normalizePrinterSettings(settings);
  return {
    paperWidth: normalized.paperWidth,
    printWidth: normalized.printWidth,
    leftMargin: normalized.leftMargin,
    columns: PAPER_PROFILES[normalized.paperWidth].columns,
  };
}

async function postJson(url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  } catch (error) {
    return { ok: false, data: { message: error.message || 'Could not reach the POS server' } };
  }
}

/** Ask the POS server whether it can reach the configured printer. */
export async function getPrinterStatus(settings = getPrinterSettings()) {
  const printer = normalizePrinterSettings(settings);
  const { data } = await postJson('/api/printer/status', {
    connectionMode: printer.connectionMode,
    printerName: printer.printerName,
    ip: printer.ip,
    port: printer.port,
  });
  return {
    available: data.available === true,
    directSupported: data.directSupported === true,
    message: data.message || 'Could not check the printer',
    printers: Array.isArray(data.printers) ? data.printers : [],
  };
}

/** Send a receipt straight to the thermal printer through the POS server. */
export async function sendDirectPrint(transaction, receiptSettings, settings = getPrinterSettings()) {
  const printer = normalizePrinterSettings(settings);
  const { data } = await postJson('/api/printer/print-direct', {
    transaction,
    receiptSettings,
    printer: {
      connectionMode: printer.connectionMode,
      printerName: printer.printerName,
      ip: printer.ip,
      port: printer.port,
      paperWidth: printer.paperWidth,
    },
  });
  return { success: data.success === true, message: data.message || 'Direct print failed' };
}

/** Sidebar indicator: true only when direct printing is set up and the printer is reachable. */
export async function checkPrinterAvailable(settings = getPrinterSettings()) {
  const printer = normalizePrinterSettings(settings);
  if (printer.printMethod === 'browser') return false;
  const status = await getPrinterStatus(printer);
  return status.available;
}
