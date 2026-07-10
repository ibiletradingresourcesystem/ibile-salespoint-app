/**
 * API Endpoint: POST /api/printer/print-direct
 * 
 * Sends ESC/POS commands directly to Xprinter XP-D200N thermal printer
 * Supports both USB and Network connection modes
 * 
 * Request body:
 * {
 *   "type": "receipt" | "thank-you",
 *   "transaction": { ...transaction data },
 *   "receiptSettings": { ...receipt settings },
 *   "printerIp": "192.168.1.100", // For network printer
 *   "printerPort": 9100 // For network printer
 * }
 */

import ESCPOSPrinter from '@/src/lib/escpos';
import {
  buildReceiptViewModel,
  formatReceiptNaira,
} from '@/src/lib/receiptViewModel';

const RECEIPT_WIDTH = 42;

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const truncateText = (value, width) => {
  const text = cleanText(value);
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text;
};

const line = (label, amount) => {
  const left = truncateText(label, 24);
  const right = formatReceiptNaira(amount);
  return `${left}${right.padStart(Math.max(1, RECEIPT_WIDTH - left.length))}`;
};

const itemLine = (item) => {
  const name = truncateText(item.name, 13).padEnd(13);
  const price = formatReceiptNaira(item.unitPrice).replace('.00', '').padStart(8);
  const qty = String(item.quantity).slice(0, 3).padStart(3);
  const total = formatReceiptNaira(item.lineTotal).replace('.00', '').padStart(13);
  return `${name} ${price} ${qty} ${total}`;
};

const centerText = (value) => {
  const text = truncateText(value, RECEIPT_WIDTH);
  const pad = Math.max(0, Math.floor((RECEIPT_WIDTH - text.length) / 2));
  return `${' '.repeat(pad)}${text}`;
};

// Generate receipt ESC/POS commands
function generateReceiptCommands(transaction, settings) {
  const printer = new ESCPOSPrinter();
  printer.init();
  const model = buildReceiptViewModel(transaction, settings);

  // Header
  printer.setSize(1, 1).setAlignment(1).setBold(true);
  printer.text(model.companyName);

  // Store Info
  printer.setAlignment(1).setBold(false);
  printer.text(model.locationName);
  if (model.address) printer.text(model.address);
  if (model.contactLine) printer.text(model.contactLine);
  if (model.taxNumber) printer.text(`Tax ID: ${model.taxNumber}`);

  // Separator
  printer.setAlignment(0);
  printer.text('-'.repeat(RECEIPT_WIDTH));

  // Receipt Details
  printer.setAlignment(0).setBold(false);
  printer.setBold(true).text(model.title.toUpperCase()).setBold(false);
  printer.text(`${model.dateTime} ${model.receiptId}`);
  printer.text(`Staff: ${truncateText(model.staffName, 20)}  ${model.status}`);
  if (model.directorMemoAccount?.active) {
    printer.text(`Director: ${truncateText(model.directorMemoAccount.name, 32)}`);
  }
  printer.text('-'.repeat(RECEIPT_WIDTH));

  // Items Header
  printer.setBold(true);
  printer.text('ITEM           RATE  QTY        TOTAL');
  printer.setBold(false);

  // Items
  model.items.forEach((item) => printer.text(itemLine(item)));

  // Total items
  printer.text(`Total Qty: ${model.totalQuantity}`.padStart(RECEIPT_WIDTH));
  printer.text('-'.repeat(RECEIPT_WIDTH));

  // Totals
  printer.text(line('Subtotal', model.subtotal));
  if (model.tax > 0) printer.text(line('Tax', model.tax));
  model.adjustmentLines.forEach((adjustment) => {
    const label = adjustment.type === 'subtract' ? `${adjustment.label} (-)` : adjustment.label;
    printer.text(line(label, adjustment.amount));
  });

  printer.setBold(true);
  printer.text(line('TOTAL', model.total));
  printer.setBold(false);
  printer.text('-'.repeat(RECEIPT_WIDTH));

  // Payment
  printer.setBold(true);
  printer.text('PAYMENT');
  printer.setBold(false);

  model.tenderPayments.forEach((payment) => printer.text(line(payment.name, payment.amount)));

  // Change
  if (model.change > 0) {
    printer.setBold(true);
    printer.text(line('CHANGE', model.change));
    printer.setBold(false);
  }

  // Status and optional notes
  printer.setAlignment(1).setBold(true);
  printer.text(model.status);
  printer.setBold(false);

  if (model.refundDays > 0) {
    printer.text(`Refund within ${model.refundDays} days with receipt`);
  }
  if (model.receiptMessage) printer.text(model.receiptMessage);

  // QR Code
  if (model.qrUrl) {
    printer.setAlignment(1);
    printer.newLine();
    if (model.qrDescription) printer.text(model.qrDescription);
    printer.qrcode(model.qrUrl, 3);
  }

  // Cut paper
  printer.partialCut();

  return printer.getByteArray();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { type = 'receipt', transaction, receiptSettings, printerIp, printerPort = 9100, connectionMode = 'network' } = req.body;

    if (!transaction) {
      return res.status(400).json({ success: false, message: 'Transaction data required' });
    }

    // Generate ESC/POS commands
    const receiptData = generateReceiptCommands(transaction, receiptSettings || {});

    // If printer IP provided, send to network printer
    if (printerIp && connectionMode === 'network') {
      try {
        const net = require('net');
        const client = new net.Socket();

        return new Promise((resolve) => {
          client.connect(printerPort, printerIp, () => {
            // Send data
            const buffer = Buffer.from(receiptData);
            client.write(buffer);
            client.end();

            resolve(
              res.status(200).json({
                success: true,
                message: 'Receipt sent to network printer',
                printer: {
                  ip: printerIp,
                  port: printerPort,
                },
              })
            );
          });

          client.on('error', (error) => {
            console.error('❌ Network printer connection error:', error);
            resolve(
              res.status(500).json({
                success: false,
                message: 'Failed to connect to network printer',
                error: error.message,
              })
            );
          });

          client.setTimeout(5000, () => {
            client.destroy();
            resolve(
              res.status(500).json({
                success: false,
                message: 'Network printer connection timeout',
              })
            );
          });
        });
      } catch (error) {
        console.error('❌ Error sending to network printer:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to send to network printer',
          error: error.message,
        });
      }
    }

    // USB printer handling - Try thermal printer, return result
    if (connectionMode === 'usb') {
      try {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const { execSync } = require('child_process');
        
        // Create temporary file with ESC/POS data
        const tempDir = os.tmpdir();
        const fileName = `receipt_${Date.now()}.prn`;
        const filePath = path.join(tempDir, fileName);
        
        // Write binary data
        fs.writeFileSync(filePath, Buffer.from(receiptData));
        
        // Try print.exe in background
        let printed = false;
        try {
          execSync(`print /d:XP-80C "${filePath}"`, {
            timeout: 3000,
            stdio: 'ignore'
          });
          printed = true;
        } catch (error) {
          console.warn('âš ï¸ USB direct print command failed:', error.message);
        }
        
        // Clean up temp file after delay
        setTimeout(() => {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            // Ignore
          }
        }, 2000);
        
        if (printed) {
          return res.status(200).json({
            success: true,
            message: 'Receipt sent to USB printer',
          });
        }

        return res.status(200).json({
          success: false,
          message: 'USB print command failed, browser fallback required',
        });
        
      } catch (error) {
        return res.status(200).json({
          success: false,
          message: 'USB print failed, will display print dialog',
        });
      }
    }

    // Fallback: Return ESC/POS data for client-side printing or debugging
    console.log('⚠️ No connection mode specified, returning ESC/POS data');
    return res.status(200).json({
      success: true,
      message: 'Receipt commands generated (not sent to printer)',
      data: Buffer.from(receiptData).toString('base64'),
      type: 'escpos',
    });
  } catch (error) {
    console.error('❌ Error generating receipt:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate receipt',
      error: error.message,
    });
  }
}
