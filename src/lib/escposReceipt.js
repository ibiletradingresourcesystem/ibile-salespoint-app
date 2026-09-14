/**
 * Receipt as ESC/POS bytes for direct thermal printing. Same content and order as the browser
 * receipt (see receiptPrinting.js). Printers use their own fonts, so from the management app's
 * styling this applies font size (small sizes use the printer's compact font) and bold weight;
 * the logo and font family only appear on browser printouts.
 */
import EscPosBuilder, { toPrinterText } from './escpos';
import { buildReceiptViewModel, formatReceiptNaira, formatReceiptNairaCompact } from './receiptViewModel';

// Characters per line for [normal font, compact font]
const COLUMNS = { 80: [48, 64], 58: [32, 42] };
const COMPACT_FONT_BELOW_PT = 7;

function wrap(text, width) {
  const words = toPrinterText(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    for (let piece = word; piece.length > 0; piece = piece.slice(width)) {
      const chunk = piece.slice(0, width);
      if (!current) current = chunk;
      else if (current.length + 1 + chunk.length <= width) current += ` ${chunk}`;
      else {
        lines.push(current);
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** "left ... right" on one line, or the right part on its own line when both don't fit */
function pair(left, right, width) {
  const l = toPrinterText(left);
  const r = toPrinterText(right);
  if (l.length + r.length + 1 <= width) return [`${l}${r.padStart(width - l.length)}`];
  return [...wrap(l, width), r.padStart(width)];
}

export function buildEscposReceipt(transaction, settings = {}, { paperWidth = 80 } = {}) {
  const model = buildReceiptViewModel(transaction, settings);
  const compact = model.fontSize < COMPACT_FONT_BELOW_PT;
  const width = (COLUMNS[paperWidth] || COLUMNS[80])[compact ? 1 : 0];
  const bodyBold = model.fontWeight === 'bold';
  const rule = '-'.repeat(width);

  const p = new EscPosBuilder().init().font(compact);
  const lines = (list) => list.forEach((line) => p.text(line));
  const heading = (text) => p.bold(true).text(text).bold(bodyBold);

  // Header, after a little space at the top
  p.feed(1).align(1).bold(true).size(1, 2);
  lines(wrap(model.companyName.toUpperCase(), width));
  p.size(1, 1).bold(bodyBold);
  lines(wrap(model.locationName, width));
  if (model.address) lines(wrap(model.address, width));
  if (model.contactLine) lines(wrap(model.contactLine, width));
  if (model.taxNumber) lines(wrap(`Tax ID: ${model.taxNumber}`, width));

  // Details
  p.align(0).text(rule);
  heading(model.title.toUpperCase());
  lines(pair(model.dateTime, model.receiptId, width));
  lines(pair(`Staff: ${model.staffName}`, model.status, width));
  if (model.directorMemoAccount?.active) lines(pair('Director', model.directorMemoAccount.name, width));

  // Items: one line when the name fits, otherwise the name then "rate x qty ... total"
  p.text(rule);
  const rateWidth = 10;
  const qtyWidth = 5;
  const totalWidth = 12;
  const nameWidth = width - rateWidth - qtyWidth - totalWidth;
  const oneLineItems = width >= 42;
  if (oneLineItems) {
    heading(`${'ITEM'.padEnd(nameWidth)}${'RATE'.padStart(rateWidth)}${'QTY'.padStart(qtyWidth)}${'TOTAL'.padStart(totalWidth)}`);
  } else {
    heading(pair('ITEM', 'TOTAL', width)[0]);
  }
  model.items.forEach((item) => {
    const name = toPrinterText(item.name);
    const rate = toPrinterText(formatReceiptNairaCompact(item.unitPrice));
    const qty = String(item.quantity);
    const total = toPrinterText(formatReceiptNairaCompact(item.lineTotal));
    const fits = name.length <= nameWidth && rate.length < rateWidth && qty.length < qtyWidth && total.length < totalWidth;
    if (oneLineItems && fits) {
      p.text(`${name.padEnd(nameWidth)}${rate.padStart(rateWidth)}${qty.padStart(qtyWidth)}${total.padStart(totalWidth)}`);
    } else {
      lines(wrap(name, width));
      lines(pair(`  ${rate} x ${qty}`, total, width));
    }
  });
  lines(pair('Total Qty', String(model.totalQuantity), width));

  // Totals
  p.text(rule);
  if (model.showSubtotal) lines(pair('Subtotal', formatReceiptNaira(model.subtotal), width));
  if (model.tax > 0) lines(pair('Tax', formatReceiptNaira(model.tax), width));
  model.adjustmentLines.forEach((line) => {
    lines(pair(line.label, `${line.type === 'subtract' ? '-' : ''}${formatReceiptNaira(line.amount)}`, width));
  });
  p.bold(true);
  lines(pair('TOTAL', formatReceiptNaira(model.total), width));
  p.bold(bodyBold);

  // Payment (none on a receipt printed before payment)
  if (model.tenderPayments.length > 0) {
    p.text(rule);
    heading('PAYMENT');
    model.tenderPayments.forEach((payment) => lines(pair(payment.name, formatReceiptNaira(payment.amount), width)));
    if (model.change > 0) {
      p.bold(true);
      lines(pair('Change', formatReceiptNaira(model.change), width));
      p.bold(bodyBold);
    }
  }

  // Footer
  p.text(rule).align(1);
  if (model.refundDays > 0) lines(wrap(`Refund within ${model.refundDays} days with receipt`, width));
  if (model.qrUrl) {
    if (model.qrDescription) lines(wrap(model.qrDescription, width));
    p.qrCode(model.qrUrl, paperWidth === 58 ? 3 : 4).feed(1);
  }
  if (model.receiptMessage) {
    String(model.receiptMessage).split(/\r?\n/).forEach((paragraph) => lines(wrap(paragraph, width)));
  }
  p.bold(true);
  lines(wrap('THANK YOU FOR SHOPPING WITH US!', width));
  p.text(model.status).bold(false).align(0);

  return p.cut().toBytes();
}
