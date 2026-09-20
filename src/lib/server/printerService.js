/**
 * Server-only: checking and printing to the thermal printer (ESC/POS), shared by
 * /api/printer/* (staff session) and, in the desktop app, /api/desktop/printer (the app itself).
 */
import { buildEscposReceipt } from '@/src/lib/escposReceipt';
import { canUseWindowsPrinters, isHostedOnline, listWindowsPrinters, sendRawToWindowsPrinter } from '@/src/lib/server/windowsPrinters';
import { checkNetworkPrinter, isLocalNetworkAddress, isValidPort, sendToNetworkPrinter } from '@/src/lib/server/networkPrinter';

/**
 * { connectionMode: "usb" | "network", printerName, ip, port }
 * → { available, directSupported, message, printers? }
 */
export async function checkThermalPrinter({ connectionMode = 'usb', printerName = '', ip = '', port = 9100 } = {}) {
  if (isHostedOnline()) {
    return {
      available: false,
      directSupported: false,
      message: 'This POS is running online, so it cannot reach the shop printer directly. Use Browser printing, or run the POS on the till computer for direct printing.',
    };
  }

  if (connectionMode === 'network') {
    if (!isLocalNetworkAddress(ip) || !isValidPort(port)) {
      return {
        available: false,
        directSupported: true,
        message: 'Enter the printer\'s local network IP address (e.g. 192.168.1.100) and port (usually 9100).',
      };
    }
    try {
      await checkNetworkPrinter(ip, port);
      return { available: true, directSupported: true, message: `Printer is reachable at ${ip}:${port}` };
    } catch (error) {
      return { available: false, directSupported: true, message: `Printer not reachable: ${error.message}` };
    }
  }

  if (!canUseWindowsPrinters()) {
    return {
      available: false,
      directSupported: false,
      message: 'USB direct printing needs the POS running on a Windows till computer. Use Network or Browser printing on this server.',
    };
  }

  try {
    const printers = await listWindowsPrinters();
    const name = String(printerName).trim();
    const match = printers.find((printer) => printer.name.toLowerCase() === name.toLowerCase());
    const names = printers.map((printer) => printer.name);

    if (!match) {
      return {
        available: false,
        directSupported: true,
        printers: names,
        message: name
          ? `No printer named "${name}" is installed on this computer. Pick one from the list.`
          : 'Choose the receipt printer from the list.',
      };
    }

    return {
      available: !match.offline,
      directSupported: true,
      printers: names,
      message: match.offline
        ? `"${match.name}" is installed but Windows has it set to offline.`
        : `"${match.name}" is installed and ready${match.port ? ` (${match.port})` : ''}.`,
    };
  } catch (error) {
    return {
      available: false,
      directSupported: true,
      message: `Could not read the Windows printer list: ${error.message}`,
    };
  }
}

// Logo bitmap from the page (escposImage.js): a whole number of bytes per row, and small enough
// that a bad request cannot hand the printer megabytes of dots
const MAX_LOGO_WIDTH = 576;
const MAX_LOGO_HEIGHT = 200;

function readLogoRaster(logo) {
  if (!logo || typeof logo !== 'object') return null;
  const width = Number(logo.width);
  const height = Number(logo.height);
  if (!Number.isInteger(width) || width <= 0 || width % 8 !== 0 || width > MAX_LOGO_WIDTH) return null;
  if (!Number.isInteger(height) || height <= 0 || height > MAX_LOGO_HEIGHT) return null;
  if (typeof logo.data !== 'string') return null;

  const data = Buffer.from(logo.data, 'base64');
  if (data.length !== (width / 8) * height) return null;
  return { width, height, data: new Uint8Array(data) };
}

/**
 * { transaction, receiptSettings, logo, printer: { connectionMode, printerName, ip, port,
 *   paperWidth, thermalTextSize } } → { status, body: { success, message } }
 */
export async function printReceiptToThermalPrinter({ transaction, receiptSettings = {}, logo = null, printer = {} } = {}) {
  if (!transaction) {
    return { status: 400, body: { success: false, message: 'Transaction data required' } };
  }

  if (isHostedOnline()) {
    return { status: 200, body: { success: false, message: 'Direct printing is not available when the POS runs online' } };
  }

  const paperWidth = Number(printer.paperWidth) === 58 ? 58 : 80;
  let bytes;
  try {
    bytes = buildEscposReceipt(transaction, receiptSettings, {
      paperWidth,
      textSize: printer.thermalTextSize,
      logo: readLogoRaster(logo),
    });
  } catch (error) {
    console.error('Failed to build receipt:', error);
    return { status: 500, body: { success: false, message: 'Could not build the receipt' } };
  }

  try {
    if (printer.connectionMode === 'network') {
      if (!isLocalNetworkAddress(printer.ip) || !isValidPort(printer.port)) {
        return { status: 200, body: { success: false, message: 'Printer IP address or port is not valid' } };
      }
      await sendToNetworkPrinter(printer.ip, printer.port, bytes);
      return { status: 200, body: { success: true, message: `Receipt sent to ${printer.ip}:${printer.port}` } };
    }

    if (!canUseWindowsPrinters()) {
      return { status: 200, body: { success: false, message: 'USB direct printing needs the POS running on a Windows till computer' } };
    }
    const printerName = String(printer.printerName || '').trim();
    if (!printerName) {
      return { status: 200, body: { success: false, message: 'No receipt printer selected in Printer Settings' } };
    }
    await sendRawToWindowsPrinter(printerName, bytes);
    return { status: 200, body: { success: true, message: `Receipt sent to ${printerName}` } };
  } catch (error) {
    console.error('Direct print failed:', error.message);
    return { status: 200, body: { success: false, message: error.message } };
  }
}
