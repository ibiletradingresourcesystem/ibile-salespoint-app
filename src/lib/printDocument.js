/**
 * Browser printing helpers shared by receipts and the end-of-day report.
 */

/**
 * Page CSS for thermal rolls. With printWidth 'auto' the printout fills the page width the printer
 * driver gives the browser, edge to edge; a number fixes the width in mm for printers whose driver
 * page is wider than they can print. `leftMargin` shifts it right. On screen (the preview) it is
 * shown at `previewWidth` mm. Wrap the printout in <div class="print-page">.
 */
export function buildPrintPageCss({ printWidth, leftMargin, previewWidth }) {
  const fixedWidth = printWidth !== 'auto';
  return `
    @page { margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .print-page {
      width: ${fixedWidth ? `${printWidth}mm` : 'auto'};
      max-width: ${fixedWidth ? `${printWidth}mm` : 'none'};
      margin: 0 0 0 ${leftMargin}mm;
      padding: 0;
      color: #000;
      overflow-wrap: anywhere;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @media screen {
      .print-page { width: ${previewWidth}mm; max-width: ${previewWidth}mm; margin: 0 auto; }
    }
    img { max-width: 100%; }
  `;
}

/** Print a complete HTML document through a hidden iframe (shows the OS print dialog). */
export function printHtmlDocument(html) {
  if (typeof document === 'undefined') return;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    iframe.remove();
  };

  let printed = false;
  const print = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow.addEventListener('afterprint', () => setTimeout(remove, 500), { once: true });
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (error) {
      console.error('Print failed:', error);
    }
    // Some browsers never fire afterprint for iframes
    setTimeout(remove, 60000);
  };

  // Wait for the logo and QR images so they are not missing from the printout
  const images = Array.from(doc.images || []);
  const pending = images.filter((img) => !img.complete);
  if (pending.length === 0) {
    setTimeout(print, 50);
  } else {
    let remaining = pending.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) print();
    };
    pending.forEach((img) => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }
  setTimeout(print, 2500);
}
