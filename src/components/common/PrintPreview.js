/**
 * PrintPreview - Branded print preview overlay
 * 
 * Shows a styled preview of the receipt before printing.
 * Replaces the raw browser print dialog trigger with a branded UI.
 */

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPrint, faTimes, faCheck } from '@fortawesome/free-solid-svg-icons';
import { getStoreLogo } from '@/src/lib/logoCache';

let resolvePromise = null;

/**
 * Show the branded print preview overlay.
 * @param {string} receiptHTML - The receipt HTML to preview and print
 * @param {Object} options - { companyName, transaction }
 * @returns {Promise<boolean>} true if user clicked Print, false if cancelled
 */
export function showPrintPreview(receiptHTML, options = {}) {
  return new Promise((resolve) => {
    resolvePromise = resolve;
    window.dispatchEvent(
      new CustomEvent('printPreview:show', {
        detail: { receiptHTML, ...options },
      })
    );
  });
}

export default function PrintPreview() {
  const [visible, setVisible] = useState(false);
  const [receiptHTML, setReceiptHTML] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [transaction, setTransaction] = useState(null);
  const [printing, setPrinting] = useState(false);
  const iframeRef = useRef(null);
  const queueRef = useRef([]);

  const showNext = () => {
    if (queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      setReceiptHTML(next.receiptHTML || '');
      setCompanyName(next.companyName || '');
      setTransaction(next.transaction || null);
      setVisible(true);
      setPrinting(false);
    }
  };

  useEffect(() => {
    const handleShow = (event) => {
      const { receiptHTML: html, companyName: name, transaction: tx } = event.detail || {};
      const entry = { receiptHTML: html, companyName: name, transaction: tx };

      if (visible || printing) {
        // Already showing a receipt — queue this one
        queueRef.current.push(entry);
        return;
      }

      setReceiptHTML(html || '');
      setCompanyName(name || '');
      setTransaction(tx || null);
      setVisible(true);
      setPrinting(false);
    };

    window.addEventListener('printPreview:show', handleShow);
    return () => window.removeEventListener('printPreview:show', handleShow);
  }, [visible, printing]);

  const handlePrint = () => {
    setPrinting(true);
    // Close the custom modal immediately so it doesn't overlap the OS print dialog
    setVisible(false);

    // Create a hidden iframe to print
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    iframe.contentDocument.write(receiptHTML);
    iframe.contentDocument.close();

    let hasPrinted = false;

    const doPrint = () => {
      if (hasPrinted) return;
      hasPrinted = true;

      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        console.error('Print error:', e);
      }

      setTimeout(() => {
        try {
          if (iframe.parentNode) document.body.removeChild(iframe);
        } catch (e) {}
        setPrinting(false);
        resolvePromise?.(true);
        resolvePromise = null;
        // Show next queued receipt
        showNext();
      }, 2000);
    };

    // Wait for images to load
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

    // Safety timeout (guarded by hasPrinted)
    setTimeout(doPrint, 1500);
  };

  const handleCancel = () => {
    setVisible(false);
    resolvePromise?.(false);
    resolvePromise = null;
    // Show next queued receipt
    setTimeout(showNext, 150);
  };

  if (!visible) return null;

  const formatNaira = (amount) =>
    `₦${(amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-gray-200">
        {/* Branded Header */}
        <div className="bg-gradient-to-r from-cyan-700 to-cyan-800 text-white px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow overflow-hidden">
            <Image
              src={getStoreLogo()}
              alt="Logo"
              width={32}
              height={32}
              className="object-contain"
              unoptimized
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-lg">{companyName || 'Print Receipt'}</h2>
            <p className="text-cyan-200 text-xs">
              Review and print your receipt
              {queueRef.current.length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-amber-500 text-white text-[10px] rounded-full font-bold">
                  +{queueRef.current.length} more
                </span>
              )}
            </p>
          </div>
          <button
            onClick={handleCancel}
            className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center transition"
          >
            <FontAwesomeIcon icon={faTimes} className="w-4 h-4" />
          </button>
        </div>

        {/* Receipt Preview */}
        <div className="p-4 bg-gray-50">
          <div className="bg-white rounded-lg shadow-inner border border-gray-200 overflow-hidden max-h-[70vh] overflow-y-auto">
            <iframe
              ref={iframeRef}
              srcDoc={receiptHTML}
              className="w-full min-h-[500px] border-0"
              title="Receipt Preview"
              sandbox="allow-same-origin"
            />
          </div>
        </div>

        {/* Transaction Summary */}
        {transaction && (
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-200">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Items: {transaction.items?.length || 0}</span>
              <span className="font-bold text-gray-900">{formatNaira(transaction.total)}</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="px-5 py-4 bg-white border-t border-gray-200 flex gap-3">
          <button
            onClick={handleCancel}
            disabled={printing}
            className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handlePrint}
            disabled={printing}
            className="flex-[2] px-4 py-3 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-700 hover:to-cyan-800 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-70 shadow-lg"
          >
            {printing ? (
              <>
                <FontAwesomeIcon icon={faCheck} className="w-4 h-4 animate-pulse" />
                Printing...
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faPrint} className="w-4 h-4" />
                Print Receipt
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
