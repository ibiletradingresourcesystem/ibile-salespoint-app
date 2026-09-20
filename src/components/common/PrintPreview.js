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
import { describeDesktopPrintTarget, getDesktopPrintTarget, sendDirectPrint } from '@/src/lib/printerConfig';
import { isDesktopApp } from '@/src/lib/desktopClient';
import { showToast } from '@/src/components/common/Toast';
import { getUiSettings } from '@/src/lib/uiSettings';

/**
 * Settings → Receipt preview size. Sizes are in rem so they follow Settings → Content scale,
 * and the class names are written out in full so Tailwind keeps them.
 */
const PREVIEW_SIZES = {
  compact: { card: 'max-w-md', body: 'max-h-[55vh]', sheet: 'min-h-[20rem]' },
  standard: { card: 'max-w-lg', body: 'max-h-[70vh]', sheet: 'min-h-[28rem]' },
  large: { card: 'max-w-2xl', body: 'max-h-[78vh]', sheet: 'min-h-[34rem]' },
  'extra-large': { card: 'max-w-4xl', body: 'max-h-[86vh]', sheet: 'min-h-[40rem]' },
};

const formatNaira = (amount) =>
  `₦${(Number(amount) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PrintPreview() {
  const [current, setCurrent] = useState(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [desktop, setDesktop] = useState(false);
  const [previewSize, setPreviewSize] = useState('standard');
  const currentRef = useRef(null);
  const queueRef = useRef([]);

  useEffect(() => {
    setDesktop(isDesktopApp());
  }, []);

  // Follow Settings → Receipt preview size, including while a preview is open
  useEffect(() => {
    const apply = (settings) => setPreviewSize(settings?.system?.receiptPreviewSize || 'standard');
    apply(getUiSettings());
    const onUpdate = (event) => apply(event.detail);
    window.addEventListener('uiSettings:updated', onUpdate);
    return () => window.removeEventListener('uiSettings:updated', onUpdate);
  }, []);

  const showNext = useCallback(() => {
    const next = queueRef.current.shift() || null;
    currentRef.current = next;
    setQueuedCount(queueRef.current.length);
    setCurrent(next);
  }, []);

  useEffect(() => {
    const handleShow = (event) => {
      const {
        receiptHTML = '',
        companyName = '',
        transaction = null,
        printerSettings = null,
        receiptSettings = null,
      } = event.detail || {};
      const entry = { receiptHTML, companyName, transaction, printerSettings, receiptSettings };
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

  const size = PREVIEW_SIZES[previewSize] || PREVIEW_SIZES.standard;
  const printerSettings = current.printerSettings || undefined;
  const silentTarget = desktop && getDesktopPrintTarget(printerSettings).silent;
  // This till prints thermal commands straight to the printer: the preview does the same
  const printsDirect = Boolean(current.receiptSettings) && ['direct', 'both'].includes(printerSettings?.printMethod);
  const thermalName =
    printerSettings?.connectionMode === 'network'
      ? `${printerSettings?.ip}:${printerSettings?.port}`
      : printerSettings?.printerName || 'the thermal printer';

  const handlePrint = (dialog = false) => {
    const { receiptHTML, transaction, receiptSettings } = current;
    // Close first so the preview doesn't sit behind a print dialog
    showNext();
    setTimeout(async () => {
      // Thermal printing, unless the user asked for the Windows print dialog instead
      if (printsDirect && !dialog) {
        const direct = await sendDirectPrint(transaction, receiptSettings, printerSettings);
        if (direct.success) {
          showToast(`Receipt sent to ${thermalName}`, 'success', 2500);
          return;
        }
        if (printerSettings?.printMethod === 'direct') {
          showToast(`Receipt not printed: ${direct.message}`, 'error', 6000);
          return;
        }
        // "Thermal, Windows printer if it fails" — fall through to the designed printout
        console.warn('Direct print failed, using the fallback printing:', direct.message);
      }

      const result = await printHtmlDocument(receiptHTML, { printerSettings, dialog });
      if (!result.ok && !result.canceled) showToast(`Receipt not printed: ${result.error}`, 'error', 6000);
      else if (result.ok && desktop && silentTarget && !dialog) showToast('Receipt sent to the printer', 'success', 2500);
    }, 50);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${size.card} mx-4 overflow-hidden border border-gray-200`}>
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
              {printsDirect
                ? `Thermal printer: ${thermalName}`
                : desktop
                  ? `Printer: ${describeDesktopPrintTarget(printerSettings)}`
                  : 'Review and print your receipt'}
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
          <div className={`bg-white rounded-lg shadow-inner border border-gray-200 overflow-hidden ${size.body} overflow-y-auto`}>
            <iframe
              srcDoc={current.receiptHTML}
              className={`w-full ${size.sheet} border-0`}
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
          {(silentTarget || printsDirect) && (
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
