/**
 * PrintPreview - branded receipt preview shown before printing.
 * Opened by receiptPrinting.js via the "printPreview:show" window event; receipts that arrive
 * while one is open are queued.
 *
 * Browser: Print opens the browser print dialog. Desktop app: Print sends the receipt to this till's
 * Windows printer (or the Windows print dialog, per Printer Settings); "Choose printer" always opens
 * the Windows print dialog.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPrint, faSliders, faTimes } from '@fortawesome/free-solid-svg-icons';
import { getStoreLogo } from '@/src/lib/logoCache';
import { printHtmlDocument } from '@/src/lib/printDocument';
import { describeDesktopPrintTarget, getDesktopPrintTarget } from '@/src/lib/printerConfig';
import { isDesktopApp } from '@/src/lib/desktopClient';
import { showToast } from '@/src/components/common/Toast';

const formatNaira = (amount) =>
  `₦${(Number(amount) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PrintPreview() {
  const [current, setCurrent] = useState(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [desktop, setDesktop] = useState(false);
  const currentRef = useRef(null);
  const queueRef = useRef([]);

  useEffect(() => {
    setDesktop(isDesktopApp());
  }, []);

  const showNext = useCallback(() => {
    const next = queueRef.current.shift() || null;
    currentRef.current = next;
    setQueuedCount(queueRef.current.length);
    setCurrent(next);
  }, []);

  useEffect(() => {
    const handleShow = (event) => {
      const { receiptHTML = '', companyName = '', transaction = null, printerSettings = null } = event.detail || {};
      const entry = { receiptHTML, companyName, transaction, printerSettings };
      if (currentRef.current) {
        queueRef.current.push(entry);
        setQueuedCount(queueRef.current.length);
      } else {
        currentRef.current = entry;
        setCurrent(entry);
      }
    };

    window.addEventListener('printPreview:show', handleShow);
    return () => window.removeEventListener('printPreview:show', handleShow);
  }, []);

  if (!current) return null;

  const printerSettings = current.printerSettings || undefined;
  const silentTarget = desktop && getDesktopPrintTarget(printerSettings).silent;

  const handlePrint = (dialog = false) => {
    const { receiptHTML } = current;
    // Close first so the preview doesn't sit behind a print dialog
    showNext();
    setTimeout(async () => {
      const result = await printHtmlDocument(receiptHTML, { printerSettings, dialog });
      if (!result.ok && !result.canceled) showToast(`Receipt not printed: ${result.error}`, 'error', 6000);
      else if (result.ok && desktop && silentTarget && !dialog) showToast('Receipt sent to the printer', 'success', 2500);
    }, 50);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-gray-200">
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
            <h2 className="font-bold text-lg text-white">{current.companyName || 'Print Receipt'}</h2>
            <p className="text-cyan-200 text-xs">
              {desktop ? `Printer: ${describeDesktopPrintTarget(printerSettings)}` : 'Review and print your receipt'}
              {queuedCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-amber-500 text-white text-[10px] rounded-full font-bold">
                  +{queuedCount} more
                </span>
              )}
            </p>
          </div>
          <button
            onClick={showNext}
            aria-label="Close preview"
            className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center transition"
          >
            <FontAwesomeIcon icon={faTimes} className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 bg-gray-50">
          <div className="bg-white rounded-lg shadow-inner border border-gray-200 overflow-hidden max-h-[70vh] overflow-y-auto">
            <iframe
              srcDoc={current.receiptHTML}
              className="w-full min-h-[500px] border-0"
              title="Receipt Preview"
              sandbox="allow-same-origin"
            />
          </div>
        </div>

        {current.transaction && (
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-200">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Items: {current.transaction.items?.length || 0}</span>
              <span className="font-bold text-gray-900">{formatNaira(current.transaction.total)}</span>
            </div>
          </div>
        )}

        <div className="px-5 py-4 bg-white border-t border-gray-200 flex gap-3">
          <button
            onClick={showNext}
            className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition"
          >
            Cancel
          </button>
          {silentTarget && (
            <button
              onClick={() => handlePrint(true)}
              title="Open the Windows print dialog to pick a printer or copies"
              className="flex-1 px-3 py-3 whitespace-nowrap text-sm bg-white hover:bg-gray-50 text-cyan-800 border border-cyan-300 font-semibold rounded-xl transition flex items-center justify-center gap-2"
            >
              <FontAwesomeIcon icon={faSliders} className="w-4 h-4" />
              Choose printer
            </button>
          )}
          <button
            onClick={() => handlePrint(false)}
            className="flex-[2] px-4 py-3 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-700 hover:to-cyan-800 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg"
          >
            <FontAwesomeIcon icon={faPrint} className="w-4 h-4" />
            Print Receipt
          </button>
        </div>
      </div>
    </div>
  );
}
