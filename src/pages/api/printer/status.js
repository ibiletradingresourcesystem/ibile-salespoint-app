/**
 * API Endpoint: POST /api/printer/status
 *
 * Checks whether this POS server can print directly to the configured thermal printer.
 * Direct printing needs the POS running on the till computer; when hosted online (Vercel)
 * it reports that browser printing must be used.
 *
 * Body: { connectionMode: "usb" | "network", printerName, ip, port }
 * Response: { available, directSupported, message, printers? }
 */
import { canUseWindowsPrinters, isHostedOnline, listWindowsPrinters } from '@/src/lib/server/windowsPrinters';
import { checkNetworkPrinter, isLocalNetworkAddress, isValidPort } from '@/src/lib/server/networkPrinter';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { connectionMode = 'usb', printerName = '', ip = '', port = 9100 } = req.body || {};

  if (isHostedOnline()) {
    return res.status(200).json({
      available: false,
      directSupported: false,
      message: 'This POS is running online, so it cannot reach the shop printer directly. Use Browser printing, or run the POS on the till computer for direct printing.',
    });
  }

  if (connectionMode === 'network') {
    if (!isLocalNetworkAddress(ip) || !isValidPort(port)) {
      return res.status(200).json({
        available: false,
        directSupported: true,
        message: 'Enter the printer\'s local network IP address (e.g. 192.168.1.100) and port (usually 9100).',
      });
    }
    try {
      await checkNetworkPrinter(ip, port);
      return res.status(200).json({ available: true, directSupported: true, message: `Printer is reachable at ${ip}:${port}` });
    } catch (error) {
      return res.status(200).json({ available: false, directSupported: true, message: `Printer not reachable: ${error.message}` });
    }
  }

  if (!canUseWindowsPrinters()) {
    return res.status(200).json({
      available: false,
      directSupported: false,
      message: 'USB direct printing needs the POS running on a Windows till computer. Use Network or Browser printing on this server.',
    });
  }

  try {
    const printers = await listWindowsPrinters();
    const name = String(printerName).trim();
    const match = printers.find((printer) => printer.name.toLowerCase() === name.toLowerCase());

    if (!match) {
      return res.status(200).json({
        available: false,
        directSupported: true,
        printers: printers.map((printer) => printer.name),
        message: name
          ? `No printer named "${name}" is installed on this computer. Pick one from the list.`
          : 'Choose the receipt printer from the list.',
      });
    }

    return res.status(200).json({
      available: !match.offline,
      directSupported: true,
      printers: printers.map((printer) => printer.name),
      message: match.offline
        ? `"${match.name}" is installed but Windows has it set to offline.`
        : `"${match.name}" is installed and ready${match.port ? ` (${match.port})` : ''}.`,
    });
  } catch (error) {
    return res.status(200).json({
      available: false,
      directSupported: true,
      message: `Could not read the Windows printer list: ${error.message}`,
    });
  }
}
