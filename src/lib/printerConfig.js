/**
 * Printer settings for this till (stored in this browser's localStorage; the desktop app also keeps
 * them in its own settings file so they survive browser data being cleared).
 *
 * Receipt content and styling (logo, company details, font, QR, messages) come from the
 * management app's Receipt Settings. These settings only describe this till's printer:
 *
 *   printMethod    'browser' – print through the browser (desktop app: the Windows print dialog)
 *                  'windows' – desktop app only: the full receipt design to a Windows printer, no dialog
 *                  'direct'  – ESC/POS straight to the thermal printer, no dialog (POS running on the till PC)
 *                  'both'    – try direct first, fall back to browser printing (desktop app: the Windows printer)
 *   connectionMode 'usb' (Windows printer queue named `printerName`) | 'network' (ip:port)
 *   windowsPrinterName  desktop app: printer for designed printouts ('' = the Windows default printer)
 *   fitToReceipt   desktop app: page length follows the printout (thermal rolls); off for A4/Letter printers
 *   pageWidthMode  desktop app, designed printouts: how wide the printed page is —
 *                  'roll'   the paper roll above (80 or 58 mm), the size the driver already has a
 *                           form for; Windows fits it to what the printer can print, and with no
 *                           side margins the ink covers that whole area (default)
 *                  'auto'   the paper size the driver reports. Exact, but a width the driver has no
 *                           form for can make a thermal printer spit out an error slip instead
 *                  'custom' pageWidthMm, when neither of those comes out right
 *   pageWidthMm    width in mm used when pageWidthMode is 'custom' (30–120)
 *   paperWidth     80 | 58 (mm roll)
 *   marginLeft     blank space, in mm, kept clear on the left of the printout
 *   marginRight    blank space, in mm, kept clear on the right (raise the side that gets cut off)
 *   thermalTextSize  direct ESC/POS printing only: 'auto' follows the management app's receipt font
 *                  size, 'standard' and 'small' pick the printer's own font A or B
 */

import { getDesktopBridge, isDesktopApp } from './desktopClient';
import { buildReceiptLogoRaster } from './escposImage';

const STORAGE_KEY = 'printerSettings';
const SETTINGS_VERSION = 6;

export const PRINT_METHODS = ['browser', 'windows', 'direct', 'both'];
export const PAPER_WIDTHS = [80, 58];
export const MAX_SIDE_MARGIN = 12;
export const PAGE_WIDTH_MODES = ['auto', 'roll', 'custom'];
export const MIN_PAGE_WIDTH = 30;
export const MAX_PAGE_WIDTH = 120;

// Default side margins and ESC/POS characters per line (Font A) per roll width.
// These margins keep the printout inside what the print head can reach. Dropping them to 0 to use
// the whole roll had printers clipping the amounts off the right-hand side, so they stay.
export const PAPER_PROFILES = {
  80: { sideMargin: 4, columns: 48 },
  58: { sideMargin: 3, columns: 32 },
};

export const THERMAL_TEXT_SIZES = ['auto', 'standard', 'small'];

export function getDefaultPrinterSettings(paperWidth = 80) {
  const profile = PAPER_PROFILES[paperWidth] || PAPER_PROFILES[80];
  return {
    settingsVersion: SETTINGS_VERSION,
    // The desktop app prints the receipt design without a dialog; a browser cannot
    printMethod: isDesktopApp() ? 'windows' : 'browser',
    connectionMode: 'usb',
    printerName: 'XP-80C',
    windowsPrinterName: '',
    fitToReceipt: true,
    pageWidthMode: 'roll',
    pageWidthMm: 72,
    ip: '192.168.1.100',
    port: 9100,
    paperWidth: PAPER_PROFILES[paperWidth] ? paperWidth : 80,
    marginLeft: profile.sideMargin,
    marginRight: profile.sideMargin,
    thermalTextSize: 'auto',
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
  // Earlier versions set a print width instead of side margins; start those tills on the default margins,
  // or split a hand-picked width evenly between the two sides
  let marginLeft = source.marginLeft;
  let marginRight = source.marginRight;
  if (Number(source.settingsVersion) < SETTINGS_VERSION || !source.settingsVersion) {
    const oldWidth = Number(source.printWidth);
    const customWidth = Number(source.settingsVersion) === 2 && Number.isFinite(oldWidth) && oldWidth > 0 && oldWidth < paperWidth;
    marginLeft = customWidth ? (paperWidth - oldWidth) / 2 : profile.sideMargin;
    marginRight = marginLeft;
  }

  return {
    settingsVersion: SETTINGS_VERSION,
    printMethod,
    connectionMode: source.connectionMode === 'network' ? 'network' : 'usb',
    printerName: String(source.printerName || defaults.printerName).trim(),
    windowsPrinterName: String(source.windowsPrinterName || '').trim(),
    fitToReceipt: source.fitToReceipt !== false,
    // Settings saved before this version start again on the default: the widths they were given
    // (and the usePaperWidth switch this replaced) could leave a printer showing an error slip
    pageWidthMode:
      Number(source.settingsVersion) >= SETTINGS_VERSION && PAGE_WIDTH_MODES.includes(source.pageWidthMode)
        ? source.pageWidthMode
        : defaults.pageWidthMode,
    pageWidthMm: Math.round(clampNumber(source.pageWidthMm, MIN_PAGE_WIDTH, MAX_PAGE_WIDTH, 72) * 10) / 10,
    ip: String(source.ip || defaults.ip).trim(),
    port: Math.round(clampNumber(source.port, 1, 65535, defaults.port)),
    paperWidth,
    marginLeft: clampNumber(marginLeft, 0, MAX_SIDE_MARGIN, profile.sideMargin),
    marginRight: clampNumber(marginRight, 0, MAX_SIDE_MARGIN, profile.sideMargin),
    thermalTextSize: THERMAL_TEXT_SIZES.includes(source.thermalTextSize) ? source.thermalTextSize : 'auto',
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
    const normalized = normalizePrinterSettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    getDesktopBridge()?.setPrinterSettings?.(normalized).catch((error) => console.error('Failed to save printer settings in the app:', error));
    return true;
  } catch (error) {
    console.error('Failed to save printer settings:', error);
    return false;
  }
}

/**
 * Desktop app: settings kept by the app win over this browser's copy (e.g. after browser data was
 * cleared); a copy saved only in the browser is handed to the app. Call once when the POS loads.
 */
export async function loadDesktopPrinterSettings() {
  const bridge = getDesktopBridge();
  if (!bridge?.getPrinterSettings) return getPrinterSettings();
  try {
    const fromApp = await bridge.getPrinterSettings();
    if (fromApp) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePrinterSettings(fromApp)));
    } else if (localStorage.getItem(STORAGE_KEY)) {
      await bridge.setPrinterSettings(getPrinterSettings());
    }
  } catch (error) {
    console.warn('Could not load printer settings from the app:', error);
  }
  return getPrinterSettings();
}

/**
 * Desktop app: which Windows printer a designed printout goes to, and whether a dialog is shown.
 *   windows          → the chosen Windows printer (or the default), no dialog
 *   direct / both    → the thermal printer's own Windows queue (USB), no dialog; network printers have
 *                      no queue, so the chosen Windows printer or else the dialog
 *   browser          → the Windows print dialog
 */
export function getDesktopPrintTarget(settings = getPrinterSettings()) {
  const printer = normalizePrinterSettings(settings);
  const base = {
    paperWidth: printer.paperWidth,
    fitToContent: printer.fitToReceipt,
    pageWidthMode: printer.pageWidthMode,
    pageWidthMm: printer.pageWidthMm,
  };
  if (printer.printMethod === 'windows') return { ...base, silent: true, deviceName: printer.windowsPrinterName };
  if (printer.printMethod === 'direct' || printer.printMethod === 'both') {
    if (printer.connectionMode === 'usb' && printer.printerName) return { ...base, silent: true, deviceName: printer.printerName };
    if (printer.windowsPrinterName) return { ...base, silent: true, deviceName: printer.windowsPrinterName };
  }
  return { ...base, silent: false, deviceName: printer.windowsPrinterName };
}

/** Desktop app: human description of where printouts go, for the preview and settings. */
export function describeDesktopPrintTarget(settings = getPrinterSettings()) {
  const target = getDesktopPrintTarget(settings);
  if (!target.silent) return 'Windows print dialog';
  return target.deviceName || 'Windows default printer';
}

/** Page geometry shared by every printout (receipts and end-of-day report). */
export function getPrintLayout(settings = getPrinterSettings()) {
  const normalized = normalizePrinterSettings(settings);
  const profile = PAPER_PROFILES[normalized.paperWidth];
  return {
    paperWidth: normalized.paperWidth,
    marginLeft: normalized.marginLeft,
    marginRight: normalized.marginRight,
    // Approximate width of the printed content, used to pick the narrow-roll layout
    contentWidth: normalized.paperWidth - normalized.marginLeft - normalized.marginRight,
    columns: profile.columns,
  };
}

async function postJson(url, body) {
  // Desktop app: through the app, so it also works on the login screen before anyone logs in
  const bridge = getDesktopBridge();
  if (bridge?.printerRequest) {
    const action = url.endsWith('/print-direct') ? 'print-direct' : 'status';
    try {
      const data = (await bridge.printerRequest(action, body)) || {};
      return { ok: true, data };
    } catch (error) {
      return { ok: false, data: { message: error.message || 'The app could not reach the printer service' } };
    }
  }
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

/** Desktop app: installed Windows printers [{ name, displayName, isDefault }] (empty elsewhere). */
export async function listDesktopPrinters() {
  try {
    return (await getDesktopBridge()?.listPrinters?.()) || [];
  } catch {
    return [];
  }
}

/** Desktop app: whether the Windows printer for designed printouts is installed. */
export async function getWindowsPrinterStatus(settings = getPrinterSettings()) {
  const printer = normalizePrinterSettings(settings);
  const printers = await listDesktopPrinters();
  if (printers.length === 0) {
    return { available: false, message: 'No printers are installed in Windows. Install the printer\'s driver first.', printers };
  }
  if (!printer.windowsPrinterName) {
    const fallback = printers.find((entry) => entry.isDefault);
    return fallback
      ? { available: true, message: `Printing to the Windows default printer, "${fallback.displayName}".`, printers }
      : { available: false, message: 'Windows has no default printer. Choose a printer from the list.', printers };
  }
  const match = printers.find((entry) => entry.name === printer.windowsPrinterName);
  return match
    ? { available: true, message: `"${match.displayName}" is installed${match.isDefault ? ' (Windows default)' : ''}.`, printers }
    : { available: false, message: `"${printer.windowsPrinterName}" is not installed on this computer. Choose another printer.`, printers };
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
  // The POS server cannot decode a picture, so the logo goes with the job as printer dots.
  // receiptSettings already holds the store's logo, or nothing when it has none.
  const logoSource = receiptSettings?.companyLogo || receiptSettings?.logo || '';
  const logo = logoSource ? await buildReceiptLogoRaster(logoSource, { paperWidth: printer.paperWidth }) : null;
  const { data } = await postJson('/api/printer/print-direct', {
    transaction,
    receiptSettings,
    logo,
    printer: {
      connectionMode: printer.connectionMode,
      printerName: printer.printerName,
      ip: printer.ip,
      port: printer.port,
      paperWidth: printer.paperWidth,
      thermalTextSize: printer.thermalTextSize,
    },
  });
  return { success: data.success === true, message: data.message || 'Direct print failed' };
}

/** Sidebar indicator: true only when direct printing is set up and the printer is reachable. */
export async function checkPrinterAvailable(settings = getPrinterSettings()) {
  const printer = normalizePrinterSettings(settings);
  if (printer.printMethod === 'browser') return false;
  if (printer.printMethod === 'windows') {
    if (!isDesktopApp()) return false;
    return (await getWindowsPrinterStatus(printer)).available;
  }
  const status = await getPrinterStatus(printer);
  return status.available;
}
