/**
 * API Endpoint: POST /api/printer/print-direct
 *
 * Prints a receipt straight to the thermal printer (ESC/POS), without a print dialog.
 * Needs the POS server running on the till computer (USB printer queue on Windows, or a
 * printer on the shop network). When hosted online it returns success: false so the till
 * falls back to browser printing.
 *
 * Body: {
 *   transaction, receiptSettings,
 *   printer: { connectionMode: "usb" | "network", printerName, ip, port, paperWidth: 80 | 58 }
 * }
 */
import { printReceiptToThermalPrinter } from '@/src/lib/server/printerService';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  const { status, body } = await printReceiptToThermalPrinter(req.body || {});
  return res.status(status).json(body);
}
