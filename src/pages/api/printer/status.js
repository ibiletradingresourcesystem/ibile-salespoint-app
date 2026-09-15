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
import { checkThermalPrinter } from '@/src/lib/server/printerService';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  return res.status(200).json(await checkThermalPrinter(req.body || {}));
}
