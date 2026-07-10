/**
 * Receipt Printing Utility
 * 
 * Handles automatic receipt generation and printing after payment completion
 * Supports both browser printing and direct thermal printer (ESC/POS)
 * Fetches receipt settings from API and generates formatted receipts
 */

import { getPrinterSettings, sendDirectPrint } from './printerConfig';
import { getStoreLogo } from './logoCache';
import { getUiSettings } from './uiSettings';
import {
  buildReceiptViewModel,
  escapeHtml,
  formatReceiptNaira,
} from './receiptViewModel';

/**
 * Get receipt settings from API with local caching
 * Uses localStorage cache first, then refreshes from API in background
 * @returns {Promise<Object>} Receipt settings including logo, company info, messages
 */
const RECEIPT_SETTINGS_CACHE_KEY = 'cachedReceiptSettings';

function getCachedReceiptSettings() {
  try {
    const cached = localStorage.getItem(RECEIPT_SETTINGS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {}
  return null;
}

function cacheReceiptSettings(settings) {
  try {
    localStorage.setItem(RECEIPT_SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch {}
}

function mergeDirectorMemoAccount(settings = {}) {
  try {
    const uiSettings = getUiSettings();
    return {
      ...settings,
      directorMemoAccount: uiSettings.system?.directorMemoAccount || settings.directorMemoAccount,
    };
  } catch {
    return settings;
  }
}

export async function getReceiptSettings() {
  // Always use cached logo from logoCache for the logo field
  const cachedLogo = getStoreLogo();
  const cached = getCachedReceiptSettings();

  // Get current location ID for per-location QR
  let locationId = '';
  try {
    const savedLocation = localStorage.getItem('location');
    if (savedLocation) {
      const loc = JSON.parse(savedLocation);
      locationId = loc?._id || '';
    }
  } catch {}

  const apiUrl = locationId
    ? `/api/receipt-settings?locationId=${encodeURIComponent(locationId)}`
    : '/api/receipt-settings';

  // If we have cached settings, return immediately and refresh in background
  if (cached) {
    const result = mergeDirectorMemoAccount({ ...cached, companyLogo: cachedLogo });
    // Background refresh if online (non-blocking)
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      fetch(apiUrl, { signal: AbortSignal.timeout(3000) })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.settings) cacheReceiptSettings(data.settings); })
        .catch(() => {});
    }
    return result;
  }

  // No cache — must fetch (but only if online)
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return mergeDirectorMemoAccount({
      companyDisplayName: 'Store',
      companyLogo: cachedLogo,
      storePhone: '',
      email: '',
      website: '',
      businessAddress: '',
      refundDays: 0,
      receiptMessage: '',
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error('Failed to fetch receipt settings');
    }
    const data = await response.json();
    const settings = data.settings || {};
    cacheReceiptSettings(settings);
    return mergeDirectorMemoAccount({ ...settings, companyLogo: cachedLogo || settings.companyLogo });
  } catch (error) {
    console.error('❌ Error fetching receipt settings:', error);
    return mergeDirectorMemoAccount({
      companyDisplayName: 'Store',
      companyLogo: cachedLogo,
      storePhone: '',
      email: '',
      website: '',
      businessAddress: '',
      refundDays: 0,
      receiptMessage: '',
    });
  }
}

/**
 * Print transaction receipt using thermal printer (ESC/POS) or browser
 * @param {Object} transaction - Transaction object with items, totals, payment details
 * @param {Object} receiptSettings - Receipt settings (logo, company info, messages)
 * @returns {Promise<void>}
 */
/**
 * Print transaction receipt using thermal printer (ESC/POS) or browser
 * @param {Object} transaction - Transaction object with items, totals, payment details
 * @param {Object} receiptSettings - Receipt settings (logo, company info, messages)
 * @returns {Promise<void>}
 */
export async function printTransactionReceipt(transaction, receiptSettings) {
  try {
    if (!transaction) {
      console.warn('⚠️ No transaction to print');
      return;
    }

    // Use provided settings or get them (cached on client)
    const settings = mergeDirectorMemoAccount(receiptSettings || (await getReceiptSettings()));

    // Get printer settings
    const printerSettings = getPrinterSettings();

    const shouldTryDirect = printerSettings.enabled &&
      (printerSettings.printMethod === 'direct' || printerSettings.printMethod === 'both') &&
      (printerSettings.connectionMode === 'usb' || printerSettings.connectionMode === 'network');

    const shouldTryBrowser = !printerSettings.enabled ||
      printerSettings.printMethod === 'browser' ||
      printerSettings.printMethod === 'both';

    let directSuccess = false;

    // Try direct thermal print if configured
    if (shouldTryDirect) {
      try {
        const directResult = await sendDirectPrint(transaction, settings, printerSettings).catch(() => null);
        directSuccess = directResult?.success === true;
        if (directSuccess) {
          console.log('🖨️ Direct print succeeded');
        }
      } catch (error) {
        console.warn('⚠️ Direct print failed, will try fallback');
      }
    }

    if (printerSettings.enabled && printerSettings.autoPrint && !directSuccess) {
      printerSettings.autoPrint = false;
    }

    // If autoPrint is enabled, skip browser dialog entirely regardless of result
    if (printerSettings.enabled && printerSettings.autoPrint) {
      if (directSuccess) {
        console.log('🖨️ Auto-printed via direct print (no dialog)');
      } else {
        console.warn('⚠️ Auto-print enabled but direct print failed — skipping browser dialog');
      }
      return;
    }

    // If method is direct-only, don't fall back to browser
    if (printerSettings.enabled && printerSettings.printMethod === 'direct') {
      if (!directSuccess) {
        console.warn('⚠️ Direct print failed — direct-only mode, no browser fallback');
      }
      return;
    }

    // Skip browser print if direct already succeeded (method = 'both')
    if (directSuccess) {
      return;
    }

    // Show browser print dialog for 'browser' or 'both' (when direct failed) methods
    if (!shouldTryBrowser) return;

    console.log('🖨️ Showing branded print preview...');
    
    const receiptHTML = generateReceiptHTML(transaction, settings);

    // Check if user wants the print preview modal or silent print
    let showPreview = true;
    try {
      const stored = localStorage.getItem('uiSettings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.system?.showPrintPreview === false) showPreview = false;
      }
    } catch (e) {}

    if (!showPreview) {
      // Silent print — skip modal, print directly via hidden iframe
      console.log('🖨️ Silent print mode — skipping preview modal');
      silentPrintHTML(receiptHTML);
      return;
    }

    // Try to show branded print preview overlay (if component is mounted)
    try {
      const printEvent = new CustomEvent('printPreview:show', {
        detail: {
          receiptHTML,
          companyName: settings?.companyDisplayName || '',
          transaction,
        },
      });
      window.dispatchEvent(printEvent);
      console.log('✅ Branded print preview dispatched');
      return; // The PrintPreview component handles the actual printing
    } catch (previewError) {
      console.warn('⚠️ Branded preview failed, falling back to iframe print:', previewError);
    }
    
    // Fallback: direct iframe print if branded preview isn't available
    console.log('🖨️ Fallback: Showing print dialog...');
    
    // Create iframe for printing
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    // Write HTML to iframe
    iframe.contentDocument.write(receiptHTML);
    iframe.contentDocument.close();

    // Print with proper timing and cleanup
    try {
      iframe.contentWindow.focus();
      
      let hasPrinted = false; // Flag to ensure print happens only once
      let cleanupScheduled = false;
      
      // Function to clean up iframe after print
      const cleanupIframe = () => {
        if (cleanupScheduled) return;
        cleanupScheduled = true;
        
        // Wait a bit before cleanup to ensure print dialog is handled
        setTimeout(() => {
          try {
            if (iframe.parentNode) {
              document.body.removeChild(iframe);
              console.log('🧹 Print iframe cleaned up');
            }
          } catch (e) {
            // Ignore cleanup errors
          }
        }, 3000); // Wait 3 seconds after print to cleanup
      };
      
      // Function to safely print
      const doPrint = () => {
        if (!hasPrinted) {
          hasPrinted = true;
          try {
            console.log('🖨️ Triggering print dialog...');
            iframe.contentWindow.print();
            console.log('✅ Print dialog triggered');
            cleanupIframe();
          } catch (e) {
            console.error('Print error:', e);
            cleanupIframe();
          }
        }
      };

      // Wait for all images to load before printing
      const waitForImages = () => {
        const images = iframe.contentDocument.querySelectorAll('img');
        if (images.length === 0) {
          doPrint();
          return;
        }
        let loaded = 0;
        const onImageReady = () => {
          loaded++;
          if (loaded >= images.length) doPrint();
        };
        images.forEach((img) => {
          if (img.complete) {
            onImageReady();
          } else {
            img.addEventListener('load', onImageReady, { once: true });
            img.addEventListener('error', onImageReady, { once: true });
          }
        });
      };
      
      // Listen for afterprint event (fires when print dialog closes)
      iframe.contentWindow.addEventListener('afterprint', () => {
        console.log('📄 Print dialog closed');
        cleanupIframe();
      }, { once: true });
      
      // Wait for document load, then wait for images
      iframe.contentWindow.addEventListener('load', waitForImages, { once: true });
      
      // Fallback: if load already fired
      if (iframe.contentDocument.readyState === 'complete') {
        waitForImages();
      }
      
      // Safety timeout: ensure print happens within 1.5 seconds even if images fail
      setTimeout(() => {
        doPrint();
      }, 1500);
      
      // Final safety cleanup (if nothing else triggered)
      setTimeout(() => {
        cleanupIframe();
      }, 8000); // Max 8 seconds before cleanup
    } catch (printError) {
      console.error('❌ Print error:', printError);
      try {
        document.body.removeChild(iframe);
      } catch (e) {
        // Ignore
      }
    }

  } catch (error) {
    console.error('❌ Error printing receipt:', error);
  }
}

/**
 * Silent print — sends receipt HTML to printer via a hidden iframe
 * Uses a print-specific CSS approach that tries to bypass the OS dialog.
 * Falls back to iframe.contentWindow.print() which may still show the dialog
 * on some browsers, but avoids the branded preview modal.
 */
function silentPrintHTML(html) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'absolute';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  iframe.contentDocument.write(html);
  iframe.contentDocument.close();

  let hasPrinted = false;
  const doPrint = () => {
    if (hasPrinted) return;
    hasPrinted = true;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.error('Silent print error:', e);
    }
    setTimeout(() => {
      try { if (iframe.parentNode) document.body.removeChild(iframe); } catch (e) {}
    }, 3000);
  };

  const waitForImages = () => {
    const images = iframe.contentDocument.querySelectorAll('img');
    if (images.length === 0) { doPrint(); return; }
    let loaded = 0;
    const onReady = () => { loaded++; if (loaded >= images.length) doPrint(); };
    images.forEach((img) => {
      if (img.complete) onReady();
      else {
        img.addEventListener('load', onReady, { once: true });
        img.addEventListener('error', onReady, { once: true });
      }
    });
  };

  if (iframe.contentDocument.readyState === 'complete') {
    waitForImages();
  } else {
    iframe.contentWindow.addEventListener('load', waitForImages, { once: true });
  }
  setTimeout(doPrint, 1500);
}

/**
 * Generate receipt HTML for printing
 * @param {Object} transaction - Transaction details
 * @param {Object} settings - Receipt settings
 * @returns {string} HTML string
 */
function generateReceiptHTML(transaction, settings) {
  const fallbackLogo = getStoreLogo();
  const model = buildReceiptViewModel(transaction, {
    ...settings,
    companyLogo: settings?.companyLogo || fallbackLogo,
  });

  // Resolve font family from settings
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
  const resolvedFontFamily = FONT_FAMILY_MAP[model.fontFamily] || FONT_FAMILY_MAP['Arial'];

  const toAbsoluteAssetUrl = (src) => {
    if (!src || src === '/images/placeholder.jpg') return '';
    if (src.startsWith('http') || src.startsWith('data:')) return src;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
  };

  const companyLogo = toAbsoluteAssetUrl(model.companyLogo);
  const qrImageSrc = toAbsoluteAssetUrl(model.qrImageSrc);

  const itemsHTML = model.items.map((item) => `
    <tr>
      <td class="item-name">${escapeHtml(item.name)}</td>
      <td class="price-col">${formatReceiptNaira(item.unitPrice)}</td>
      <td class="qty">${escapeHtml(String(item.quantity))}</td>
      <td class="total-col">${formatReceiptNaira(item.lineTotal)}</td>
    </tr>
  `).join('');

  const adjustmentRows = model.adjustmentLines.map((line) => `
    <div class="total-row">
      <span>${escapeHtml(line.label)}</span>
      <span>${line.type === 'subtract' ? '-' : ''}${formatReceiptNaira(line.amount)}</span>
    </div>
  `).join('');

  const paymentItemsHTML = model.tenderPayments.map((payment) => `
    <tr>
      <td>${escapeHtml(payment.name)}</td>
      <td class="num">${formatReceiptNaira(payment.amount)}</td>
    </tr>
  `).join('');

  const changeHTML = model.change > 0 ? `
    <div class="total-row change-row">
      <span>Change</span>
      <span>${formatReceiptNaira(model.change)}</span>
    </div>
  ` : '';

  const directorMemoHTML = model.directorMemoAccount?.active ? `
    <div class="detail-row director-row">
      <span>Director</span>
      <span>${escapeHtml(model.directorMemoAccount.name)}</span>
    </div>
  ` : '';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Transaction Receipt</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            background: white;
          }
          body {
            font-family: ${resolvedFontFamily};
            font-size: ${model.fontSize}pt;
            line-height: 1.18;
            overflow-x: hidden;
          }
          .receipt-page {
            width: 58mm;
            min-width: 58mm;
            max-width: 58mm;
            margin: 0 auto;
            padding: 0;
            background: white;
            display: flex;
            justify-content: center;
          }
          .receipt {
            width: 100%;
            margin: 0;
            padding: 1mm 0;
            color: #000;
            text-align: center;
          }
          .header {
            text-align: center;
            border-bottom: 0.5px dashed #444;
            padding-bottom: 1.5mm;
            margin-bottom: 1mm;
          }
          .logo {
            max-width: 30mm;
            max-height: 12mm;
            width: auto;
            height: auto;
            display: block;
            margin: 0 auto 1mm auto;
            filter: grayscale(100%);
          }
          .company-name {
            font-weight: bold;
            font-size: 1.25em;
            letter-spacing: 0.08em;
            margin: 0.5mm 0;
            text-transform: uppercase;
          }
          .company-info {
            font-size: 0.92em;
            line-height: 1.18;
            word-break: break-word;
          }
          .details {
            font-size: 0.9em;
            margin: 1mm 0;
            text-align: left;
          }
          .detail-row {
            display: flex;
            justify-content: space-between;
            margin: 0.2mm 0;
            text-align: left;
          }
          .items-section {
            border-top: 0.5px dashed #444;
            padding: 1mm 0;
            margin: 1mm 0;
            text-align: left;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            border-spacing: 0;
            table-layout: fixed;
            font-size: 0.9em;
            text-align: left;
            font-variant-numeric: tabular-nums;
          }
          .items-table th,
          .items-table td {
            padding: 0.2mm 0;
            vertical-align: top;
          }
          .items-table th {
            font-size: 0.92em;
            text-transform: uppercase;
            font-weight: bold;
            padding-bottom: 0.5mm;
          }
          .item-name {
            width: 38%;
            overflow-wrap: anywhere;
            padding-right: 0.5mm !important;
          }
          .price-col {
            width: 22%;
            text-align: right;
            white-space: nowrap;
          }
          .qty {
            width: 10%;
            text-align: center;
            white-space: nowrap;
          }
          .total-col {
            width: 30%;
            text-align: right;
            white-space: nowrap;
          }
          .num {
            text-align: right;
            white-space: nowrap;
          }
          .qty-total-row {
            border-top: 0.5px dotted #888;
            padding-top: 0.5mm;
            margin-top: 0.5mm;
          }
          .totals {
            border-top: 0.5px dashed #444;
            padding-top: 1mm;
            margin: 1mm 0;
            font-size: 0.92em;
            text-align: left;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            margin: 0.2mm 0;
            text-align: left;
          }
          .final-total {
            font-weight: bold;
            font-size: 1.08em;
            border-top: 0.5px dashed #444;
            padding-top: 0.8mm;
            margin: 0.8mm 0;
          }
          .payment-section {
            border-top: 0.5px dashed #444;
            padding: 1mm 0;
            margin: 1mm 0;
            text-align: left;
          }
          .payment-title {
            font-weight: bold;
            font-size: 0.9em;
            margin-bottom: 0.3mm;
            text-transform: uppercase;
          }
          .payment-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9em;
          }
          .payment-table td {
            padding: 0.2mm 0;
          }
          .footer-section {
            border-top: 0.5px dashed #444;
            text-align: center;
            padding-top: 1mm;
            margin-top: 1mm;
          }
          .status-box {
            text-align: center;
            font-weight: bold;
            font-size: 1em;
            padding: 0.8mm 0;
            margin: 1mm 0;
            text-transform: uppercase;
          }
          .message {
            text-align: center;
            font-size: 0.84em;
            margin: 0.5mm 0;
            white-space: pre-wrap;
          }
          .qr-section {
            text-align: center;
            margin: 1mm 0;
            padding: 1mm 0;
          }
          .qr-section img {
            width: 18mm;
            height: 18mm;
            display: block;
            margin: 0.5mm auto 0;
          }
          .muted { font-size: 0.82em; }
          .change-row { font-weight: bold; }
          @media print {
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              height: auto;
              background: white;
              overflow-x: hidden;
            }
            .receipt-page {
              width: 58mm;
              min-width: 58mm;
              max-width: 58mm;
              margin: 0 auto !important;
              padding: 0 !important;
            }
            .receipt {
              width: 100%;
              margin: 0;
              padding: 0.5mm 0;
            }
            @page {
              size: 58mm auto;
              margin: 0;
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="receipt-page">
        <div class="receipt">
          <div class="header">
            ${companyLogo ? `<div style="text-align: center;"><img src="${escapeHtml(companyLogo)}" class="logo" alt="Logo" onerror="this.style.display='none'"></div>` : ''}
            <div class="company-name">${escapeHtml(model.companyName)}</div>
            <div class="company-info">
              <div>${escapeHtml(model.locationName)}</div>
              ${model.address ? `<div>${escapeHtml(model.address)}</div>` : ''}
              ${model.contactLine ? `<div>${escapeHtml(model.contactLine)}</div>` : ''}
              ${model.taxNumber ? `<div>Tax ID: ${escapeHtml(model.taxNumber)}</div>` : ''}
            </div>
          </div>

          <div class="details">
            <div style="font-weight: bold; margin-bottom: 0.5mm; text-transform: uppercase;">${escapeHtml(model.title)}</div>
            <div class="detail-row">
              <span>${escapeHtml(model.dateTime)}</span>
              <span>${escapeHtml(model.receiptId)}</span>
            </div>
            <div class="detail-row">
              <span>Staff: ${escapeHtml(model.staffName)}</span>
              <span>${escapeHtml(model.status)}</span>
            </div>
            ${directorMemoHTML}
          </div>

          <div class="items-section">
            <table class="items-table">
              <colgroup>
                <col style="width: 38%;">
                <col style="width: 22%;">
                <col style="width: 10%;">
                <col style="width: 30%;">
              </colgroup>
              <thead>
                <tr>
                  <th class="item-name">Item</th>
                  <th class="price-col">Rate</th>
                  <th class="qty">Qty</th>
                  <th class="total-col">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHTML}
                <tr class="qty-total-row">
                  <td class="item-name muted">Total Qty</td>
                  <td></td>
                  <td class="qty muted">${escapeHtml(String(model.totalQuantity))}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="totals">
            <div class="total-row">
              <span>Subtotal</span>
              <span>${formatReceiptNaira(model.subtotal)}</span>
            </div>
            ${model.tax > 0 ? `<div class="total-row"><span>Tax</span><span>${formatReceiptNaira(model.tax)}</span></div>` : ''}
            ${adjustmentRows}
            <div class="final-total">
              <div class="total-row">
                <span>TOTAL</span>
                <span>${formatReceiptNaira(model.total)}</span>
              </div>
            </div>
          </div>

          <div class="payment-section">
            <div class="payment-title">Payment</div>
            <table class="payment-table">
              <tbody>
                ${paymentItemsHTML}
              </tbody>
            </table>
            ${changeHTML}
          </div>

          <div class="footer-section">
            ${model.refundDays > 0 ? `<div class="message">Refund within ${escapeHtml(String(model.refundDays))} days with receipt</div>` : ''}

            ${(qrImageSrc || model.qrUrl) ? `
              <div class="qr-section">
                ${model.qrDescription ? `<div class="muted">${escapeHtml(model.qrDescription)}</div>` : ''}
                ${qrImageSrc ? `<img src="${escapeHtml(qrImageSrc)}" alt="QR Code" onerror="this.style.display='none'">` : `<div class="muted">${escapeHtml(model.qrUrl)}</div>`}
              </div>
            ` : ''}

            ${model.receiptMessage ? `<div class="message">${escapeHtml(model.receiptMessage)}</div>` : ''}

            <div class="status-box">THANK YOU</div>
            <div class="status-box">${escapeHtml(model.status)}</div>
          </div>
        </div>
        </div>
      </body>
    </html>
  `;
}
