/**
 * End-of-day report as ESC/POS bytes, for a till that prints straight to a thermal printer.
 *
 * Receipts have always had this path; the report only had the designed HTML one, which went to
 * whichever printer the settings named — on a direct thermal till that is the raw ESC/POS queue,
 * and an HTML page sent there does not come out as a report. Same content and order as the printed
 * design in CloseTillModal.
 */
import EscPosBuilder, { toPrinterText } from './escpos';

// Characters per line for [normal font, compact font]
const COLUMNS = { 80: [48, 64], 58: [32, 42] };

const money = (amount) =>
  `N${(Number(amount) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

/** "left            right", or the right part on its own line when both do not fit */
function pair(left, right, width) {
  const l = toPrinterText(left);
  const r = toPrinterText(right);
  if (l.length + r.length + 1 <= width) return [`${l}${r.padStart(width - l.length)}`];
  return [...wrap(l, width), r.padStart(width)];
}

const tenderAmounts = (tender) => [money(tender.expected), money(tender.counted), money(tender.variance)];

/**
 * How the tenders are laid out for this roll: a table when the amounts and a readable name fit on
 * one line, otherwise each tender's figures stacked under its name. A 58 mm roll is 32 characters,
 * which three money columns fill on their own.
 */
function tenderLayout(tenders, width) {
  const widest = Math.max(0, ...tenders.flatMap((tender) => tenderAmounts(tender).map((value) => value.length)));
  const column = widest + 1;
  const nameWidth = width - column * 3;
  return nameWidth >= 8 ? { table: true, column, nameWidth } : { table: false };
}

const tenderRow = (tender, { column, nameWidth }) =>
  `${toPrinterText(tender.name).slice(0, nameWidth).padEnd(nameWidth)}${tenderAmounts(tender)
    .map((value) => value.padStart(column))
    .join('')}`;

/**
 * @param {Object} report {
 *   storeName, locationName, staffName, openedAt, closedAt, transactionCount,
 *   openingBalance, totalSales, expectedClosing, totalCounted, totalVariance,
 *   tenders: [{ name, expected, counted, variance }], closingNotes
 * }
 */
export function buildEscposEndOfDay(report = {}, { paperWidth = 80, textSize = 'auto' } = {}) {
  const compact = textSize === 'small';
  const width = (COLUMNS[paperWidth] || COLUMNS[80])[compact ? 1 : 0];
  const rule = '-'.repeat(width);

  const p = new EscPosBuilder().init().font(compact);
  const lines = (list) => list.forEach((line) => p.text(line));
  const heading = (text) => p.bold(true).text(text).bold(false);

  p.align(1).bold(true).size(1, 2);
  lines(wrap('END OF DAY REPORT', width));
  p.size(1, 1);
  if (report.storeName) lines(wrap(report.storeName, width));
  p.bold(false);
  if (report.locationName) lines(wrap(report.locationName, width));
  if (report.closedAt) lines(wrap(report.closedAt, width));

  p.align(0).text(rule);
  heading('TILL SESSION');
  if (report.openedAt) lines(pair('Opened', report.openedAt, width));
  if (report.closedAt) lines(pair('Closed', report.closedAt, width));
  if (report.staffName) lines(pair('Staff', report.staffName, width));
  lines(pair('Transactions', String(report.transactionCount || 0), width));

  p.text(rule);
  heading('FINANCIAL SUMMARY');
  lines(pair('Opening balance', money(report.openingBalance), width));
  lines(pair('Total sales', money(report.totalSales), width));
  p.bold(true);
  lines(pair('Expected closing', money(report.expectedClosing), width));
  p.bold(false);

  const tenders = Array.isArray(report.tenders) ? report.tenders : [];
  if (tenders.length > 0) {
    p.text(rule);
    heading('TENDER RECONCILIATION');
    const layout = tenderLayout(tenders, width);
    if (layout.table) {
      p.bold(true).text(
        `${'TENDER'.padEnd(layout.nameWidth)}${['EXPECTED', 'COUNTED', 'VAR.']
          .map((label) => label.padStart(layout.column))
          .join('')}`
      ).bold(false);
      tenders.forEach((tender) => p.text(tenderRow(tender, layout)));
    } else {
      tenders.forEach((tender, index) => {
        if (index > 0) p.text('');
        p.bold(true).text(toPrinterText(tender.name).slice(0, width)).bold(false);
        lines(pair('  Expected', money(tender.expected), width));
        lines(pair('  Counted', money(tender.counted), width));
        lines(pair('  Variance', money(tender.variance), width));
      });
    }
  }

  p.text(rule);
  p.bold(true);
  lines(pair('Total counted', money(report.totalCounted), width));
  const variance = Number(report.totalVariance) || 0;
  lines(pair('Variance', `${money(variance)} ${variance === 0 ? 'OK' : variance > 0 ? 'OVER' : 'SHORT'}`, width));
  p.bold(false);

  if (report.closingNotes) {
    p.text(rule);
    heading('NOTES');
    lines(wrap(report.closingNotes, width));
  }

  p.text(rule).align(1).bold(true);
  lines(wrap('- End of Report -', width));
  p.bold(false);
  if (report.printedAt) lines(wrap(`Printed: ${report.printedAt}`, width));

  return p.cut().toBytes();
}
