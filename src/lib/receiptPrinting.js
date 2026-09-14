/**
 * Receipt printing.
 *
 * Content and styling come from the management app's Receipt Settings (/api/receipt-settings);
 * this till's printer settings decide how it prints (see printerConfig.js):
 *   - browser: branded preview (or straight to the OS print dialog) laid out at the printable width
 *   - direct:  ESC/POS straight to the thermal printer via the POS server (POS running on the till PC)
 *   - both:    direct first, browser printing if that fails
 */

import { getPrinterSettings, getPrintLayout, normalizePrinterSettings, sendDirectPrint } from './printerConfig';
import { buildPrintPageCss, printHtmlDocument } from './printDocument';
import { getStoreLogo, setStoreLogo } from './logoCache';
import { getUiSettings } from './uiSettings';
import { showToast } from '../components/common/Toast';
import {
  buildReceiptViewModel,
  escapeHtml,
  formatReceiptNaira,
  formatReceiptNairaCompact,
} from './receiptViewModel';

const RECEIPT_SETTINGS_CACHE_KEY = 'cachedReceiptSettings';
const SETTINGS_FETCH_TIMEOUT_MS = 2000;
const PLACEHOLDER_LOGO = '/images/placeholder.jpg';

const DEFAULT_RECEIPT_SETTINGS = {
  companyDisplayName: 'Store',
  storePhone: '',
  email: '',
  website: '',
  businessAddress: '',
  refundDays: 0,
  receiptMessage: '',
};

const FONT_FAMILY_MAP = {
  'Arial': "'Arial', 'Helvetica Neue', sans-serif",
  'Courier New': "'Courier New', 'Courier', monospace",
  'Times New Roman': "'Times New Roman', 'Times', serif",
  'Verdana': "'Verdana', 'Geneva', sans-serif",
  'Georgia': "'Georgia', 'Cambria', serif",
  'Tahoma': "'Tahoma', 'Geneva', sans-serif",
  'Roboto': "'Roboto', 'Arial', sans-serif",
  'Mono': "'Courier New', 'Lucida Console', monospace",
};

const FONT_WEIGHT_MAP = { light: 300, normal: 400, bold: 700 };

function getCurrentLocationId() {
  try {
    const saved = JSON.parse(localStorage.getItem('location') || 'null');
    return saved?._id ? String(saved._id) : '';
  } catch {
    return '';
  }
}

function readCachedSettings(cacheKey) {
  try {
    const cached = localStorage.getItem(cacheKey);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function writeCachedSettings(cacheKey, settings) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(settings));
  } catch {}
}

function isRealLogo(src) {
  return Boolean(src) && src !== PLACEHOLDER_LOGO;
}

function withLogoAndDirector(settings) {
  const logo = isRealLogo(settings.companyLogo) ? settings.companyLogo : getStoreLogo();
  let directorMemoAccount = settings.directorMemoAccount;
  try {
    directorMemoAccount = getUiSettings().system?.directorMemoAccount || directorMemoAccount;
  } catch {}
  return { ...settings, companyLogo: isRealLogo(logo) ? logo : '', directorMemoAccount };
}

/**
 * Latest receipt settings for this till's location. Fetched fresh when online so changes made in
 * the management app show on the very next receipt; falls back to the last saved copy offline.
 * @param {Object} [fallback] settings to use if nothing can be fetched or found in the cache
 */
export async function getReceiptSettings(fallback = null) {
  const locationId = getCurrentLocationId();
  const cacheKey = `${RECEIPT_SETTINGS_CACHE_KEY}:${locationId || 'default'}`;

  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    try {
      const url = locationId
        ? `/api/receipt-settings?locationId=${encodeURIComponent(locationId)}`
        : '/api/receipt-settings';
      const response = await fetch(url, { signal: AbortSignal.timeout(SETTINGS_FETCH_TIMEOUT_MS) });
      const data = response.ok ? await response.json() : null;
      if (data?.settings) {
        writeCachedSettings(cacheKey, data.settings);
        if (isRealLogo(data.settings.companyLogo)) setStoreLogo(data.settings.companyLogo);
        return withLogoAndDirector(data.settings);
      }
    } catch {
      // Slow or offline — use the saved copy below
    }
  }

  const cached = readCachedSettings(cacheKey) || readCachedSettings(`${RECEIPT_SETTINGS_CACHE_KEY}:default`);
  return withLogoAndDirector(cached || fallback || DEFAULT_RECEIPT_SETTINGS);
}

function toAbsoluteAssetUrl(src) {
  if (!isRealLogo(src)) return '';
  if (src.startsWith('http') || src.startsWith('data:')) return src;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
}

/**
 * Receipt as a complete HTML document, laid out at the printer's printable width.
 */
export function buildReceiptHtml(transaction, settings = {}, printerSettings = getPrinterSettings()) {
  const model = buildReceiptViewModel(transaction, settings);
  const layout = getPrintLayout(printerSettings);
  const fontFamily = FONT_FAMILY_MAP[model.fontFamily] || FONT_FAMILY_MAP.Arial;
  const fontWeight = FONT_WEIGHT_MAP[model.fontWeight] || 400;
  const companyLogo = toAbsoluteAssetUrl(model.companyLogo);
  const qrImageSrc = toAbsoluteAssetUrl(model.qrImageSrc);
  const isUnpaid = model.status === 'UNPAID';

  // Narrow rolls (58mm): the item name gets its own line so the amount columns never squeeze it
  const stackItems = layout.printWidth < 60;
  const itemRows = model.items.map((item) => {
    const amounts = `
            <td class="num">${formatReceiptNairaCompact(item.unitPrice)}</td>
            <td class="qty">${escapeHtml(String(item.quantity))}</td>
            <td class="num">${formatReceiptNairaCompact(item.lineTotal)}</td>`;
    return stackItems
      ? `
          <tr><td class="item-name" colspan="4">${escapeHtml(item.name)}</td></tr>
          <tr><td></td>${amounts}
          </tr>`
      : `
          <tr>
            <td class="item-name">${escapeHtml(item.name)}</td>${amounts}
          </tr>`;
  }).join('');

  const adjustmentRows = model.adjustmentLines.map((line) => `
          <div class="row"><span>${escapeHtml(line.label)}</span><span class="amount">${line.type === 'subtract' ? '-' : ''}${formatReceiptNaira(line.amount)}</span></div>`).join('');

  const paymentRows = model.tenderPayments.map((payment) => `
          <div class="row"><span>${escapeHtml(payment.name)}</span><span class="amount">${formatReceiptNaira(payment.amount)}</span></div>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Sales Receipt</title>
  <style>
    ${buildPrintPageCss(layout)}
    body {
      font-family: ${fontFamily};
      font-size: ${model.fontSize}pt;
      font-weight: ${fontWeight};
      line-height: 1.18;
    }
    .receipt { padding: 1mm 0 3mm; text-align: center; }
    .section { border-top: 0.5px dashed #444; padding: 1mm 0; margin: 1mm 0; text-align: left; }
    .header { padding-bottom: 1.5mm; }
    .logo { display: block; max-width: 30mm; max-height: 12mm; margin: 0 auto 1mm; filter: grayscale(100%) contrast(1.05); }
    .company-name { font-weight: 700; font-size: 1.25em; letter-spacing: 0.08em; text-transform: uppercase; margin: 0.5mm 0; }
    .company-info { font-size: 0.92em; }
    .title { font-weight: 700; text-transform: uppercase; margin-bottom: 0.5mm; }
    .row { display: flex; justify-content: space-between; gap: 2mm; margin: 0.2mm 0; }
    .row > span:first-child { min-width: 0; }
    .amount { white-space: nowrap; text-align: right; }
    /* Amount columns take the width their numbers need; only the item name wraps */
    .items { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 0.9em; font-variant-numeric: tabular-nums; }
    .items th, .items td { padding: 0.2mm 0; vertical-align: top; }
    .items th { font-weight: 700; text-transform: uppercase; text-align: left; white-space: nowrap; padding-bottom: 0.5mm; }
    .items .item-name { width: auto; }
    .items .num, .items .qty { width: 1%; white-space: nowrap; padding-left: 1.5mm; }
    .items .num { text-align: right; }
    .items .qty { text-align: center; }
    .total-qty { border-top: 0.5px dotted #888; margin-top: 0.5mm; padding-top: 0.5mm; font-size: 0.84em; }
    .grand-total { font-weight: 700; font-size: 1.08em; border-top: 0.5px dashed #444; padding-top: 0.8mm; margin-top: 0.8mm; }
    .change { font-weight: 700; }
    .footer { border-top: 0.5px dashed #444; padding-top: 1mm; margin-top: 1mm; text-align: center; font-size: 0.84em; }
    .message { white-space: pre-wrap; margin: 1mm 0; }
    .qr img { display: block; width: 18mm; height: 18mm; margin: 1mm auto; }
    .thanks { font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 1.5mm; }
    .status { font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 1mm; }
    .status.unpaid { border: 1px solid #000; padding: 1mm 0; }
  </style>
</head>
<body>
  <div class="print-page">
    <div class="receipt">
      <div class="header">
        ${companyLogo ? `<img src="${escapeHtml(companyLogo)}" class="logo" alt="" onerror="this.remove()">` : ''}
        <div class="company-name">${escapeHtml(model.companyName)}</div>
        <div class="company-info">
          <div>${escapeHtml(model.locationName)}</div>
          ${model.address ? `<div>${escapeHtml(model.address)}</div>` : ''}
          ${model.contactLine ? `<div>${escapeHtml(model.contactLine)}</div>` : ''}
          ${model.taxNumber ? `<div>Tax ID: ${escapeHtml(model.taxNumber)}</div>` : ''}
        </div>
      </div>

      <div class="section">
        <div class="title">${escapeHtml(model.title)}</div>
        <div class="row"><span>${escapeHtml(model.dateTime)}</span><span class="amount">${escapeHtml(model.receiptId)}</span></div>
        <div class="row"><span>Staff: ${escapeHtml(model.staffName)}</span><span class="amount">${escapeHtml(model.status)}</span></div>
        ${model.directorMemoAccount?.active ? `<div class="row"><span>Director</span><span>${escapeHtml(model.directorMemoAccount.name)}</span></div>` : ''}
      </div>

      <div class="section">
        <table class="items">
          <thead>
            <tr><th class="item-name">Item</th><th class="num">Rate</th><th class="qty">Qty</th><th class="num">Total</th></tr>
          </thead>
          <tbody>${itemRows}
          </tbody>
        </table>
        <div class="row total-qty"><span>Total Qty</span><span>${escapeHtml(String(model.totalQuantity))}</span></div>
      </div>

      <div class="section">
        <div class="row"><span>Subtotal</span><span class="amount">${formatReceiptNaira(model.subtotal)}</span></div>
        ${model.tax > 0 ? `<div class="row"><span>Tax</span><span class="amount">${formatReceiptNaira(model.tax)}</span></div>` : ''}${adjustmentRows}
        <div class="row grand-total"><span>TOTAL</span><span class="amount">${formatReceiptNaira(model.total)}</span></div>
      </div>

      <div class="section">
        <div class="title">Payment</div>${paymentRows}
        ${model.change > 0 ? `<div class="row change"><span>Change</span><span class="amount">${formatReceiptNaira(model.change)}</span></div>` : ''}
      </div>

      <div class="footer">
        ${model.refundDays > 0 ? `<div class="message">Refund within ${escapeHtml(String(model.refundDays))} days with receipt</div>` : ''}
        ${(qrImageSrc || model.qrUrl) ? `
        <div class="qr">
          ${model.qrDescription ? `<div>${escapeHtml(model.qrDescription)}</div>` : ''}
          ${qrImageSrc ? `<img src="${escapeHtml(qrImageSrc)}" alt="" onerror="this.remove()">` : `<div>${escapeHtml(model.qrUrl)}</div>`}
        </div>` : ''}
        ${model.receiptMessage ? `<div class="message">${escapeHtml(model.receiptMessage)}</div>` : ''}
        <div class="thanks">Thank you for shopping with us!</div>
        <div class="status${isUnpaid ? ' unpaid' : ''}">${escapeHtml(model.status)}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Print a receipt using this till's printer settings.
 * @param {Object} transaction
 * @param {Object} [receiptSettings] used only when the latest settings can't be fetched or found offline
 * @param {Object} [options] { printerSettings, showPreview } — overrides, e.g. for a test print
 * @returns {Promise<{ success: boolean, method: string, message?: string }>}
 */
export async function printTransactionReceipt(transaction, receiptSettings = null, options = {}) {
  if (!transaction) return { success: false, method: 'none', message: 'Nothing to print' };

  try {
    const printer = normalizePrinterSettings(options.printerSettings || getPrinterSettings());
    const settings = await getReceiptSettings(receiptSettings);

    if (printer.printMethod !== 'browser') {
      const result = await sendDirectPrint(transaction, settings, printer);
      if (result.success) return { success: true, method: 'direct' };

      if (printer.printMethod === 'direct') {
        showToast(`Receipt not printed: ${result.message}`, 'error', 6000);
        return { success: false, method: 'direct', message: result.message };
      }
      console.warn('Direct print failed, using browser printing:', result.message);
    }

    const receiptHTML = buildReceiptHtml(transaction, settings, printer);
    const showPreview = options.showPreview ?? getUiSettings().system?.showPrintPreview !== false;

    if (showPreview) {
      window.dispatchEvent(new CustomEvent('printPreview:show', {
        detail: { receiptHTML, companyName: settings.companyDisplayName || '', transaction },
      }));
    } else {
      printHtmlDocument(receiptHTML);
    }
    return { success: true, method: 'browser' };
  } catch (error) {
    console.error('Error printing receipt:', error);
    return { success: false, method: 'none', message: error.message };
  }
}
