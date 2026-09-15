/**
 * POST /api/desktop/printer  (desktop app only, called by the app itself with its internal token)
 *
 * Thermal printer check and direct printing for the desktop app, so a manager can set up and test
 * the printer from the login screen before anyone has logged in.
 * Body: { action: "status", ...printer } | { action: "print-direct", transaction, receiptSettings, printer }
 */
import { checkThermalPrinter, printReceiptToThermalPrinter } from '@/src/lib/server/printerService';
import { isInternalRequest, requireDesktopRuntime } from '@/src/lib/desktop/requestAuth';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  if (!requireDesktopRuntime(res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  if (!isInternalRequest(req)) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const { action, ...body } = req.body || {};
  if (action === 'status') {
    return res.status(200).json(await checkThermalPrinter(body));
  }
  if (action === 'print-direct') {
    const { status, body: result } = await printReceiptToThermalPrinter(body);
    return res.status(status).json(result);
  }
  return res.status(400).json({ success: false, message: 'Unknown printer action' });
}
