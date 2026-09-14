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
import { buildEscposReceipt } from '@/src/lib/escposReceipt';
import { canUseWindowsPrinters, isHostedOnline, sendRawToWindowsPrinter } from '@/src/lib/server/windowsPrinters';
import { isLocalNetworkAddress, isValidPort, sendToNetworkPrinter } from '@/src/lib/server/networkPrinter';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { transaction, receiptSettings = {}, printer = {} } = req.body || {};
  if (!transaction) {
    return res.status(400).json({ success: false, message: 'Transaction data required' });
  }

  if (isHostedOnline()) {
    return res.status(200).json({
      success: false,
      message: 'Direct printing is not available when the POS runs online',
    });
  }

  const paperWidth = Number(printer.paperWidth) === 58 ? 58 : 80;
  let bytes;
  try {
    bytes = buildEscposReceipt(transaction, receiptSettings, { paperWidth });
  } catch (error) {
    console.error('Failed to build receipt:', error);
    return res.status(500).json({ success: false, message: 'Could not build the receipt' });
  }

  try {
    if (printer.connectionMode === 'network') {
      if (!isLocalNetworkAddress(printer.ip) || !isValidPort(printer.port)) {
        return res.status(200).json({ success: false, message: 'Printer IP address or port is not valid' });
      }
      await sendToNetworkPrinter(printer.ip, printer.port, bytes);
      return res.status(200).json({ success: true, message: `Receipt sent to ${printer.ip}:${printer.port}` });
    }

    if (!canUseWindowsPrinters()) {
      return res.status(200).json({ success: false, message: 'USB direct printing needs the POS running on a Windows till computer' });
    }
    const printerName = String(printer.printerName || '').trim();
    if (!printerName) {
      return res.status(200).json({ success: false, message: 'No receipt printer selected in Printer Settings' });
    }
    await sendRawToWindowsPrinter(printerName, bytes);
    return res.status(200).json({ success: true, message: `Receipt sent to ${printerName}` });
  } catch (error) {
    console.error('Direct print failed:', error.message);
    return res.status(200).json({ success: false, message: error.message });
  }
}
