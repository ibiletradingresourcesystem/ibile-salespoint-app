/**
 * This till's receipt printer: how receipts print, paper size / print area, the Windows printer
 * (desktop app) and the direct (thermal) printer connection. Receipt design comes from the
 * management app's Receipt Settings.
 *
 * Used by the Printer Settings page and, in the desktop app, by SYSTEM → Printer settings on the
 * login screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faDesktop,
  faFloppyDisk,
  faNetworkWired,
  faPlug,
  faReceipt,
  faRotate,
  faRotateLeft,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { showConfirm } from '@/src/components/common/ConfirmDialog';
import { showToast } from '@/src/components/common/Toast';
import {
  MAX_SIDE_MARGIN,
  MIN_PAGE_WIDTH,
  MAX_PAGE_WIDTH,
  PAPER_PROFILES,
  describeDesktopPrintTarget,
  getDefaultPrinterSettings,
  getPrinterSettings,
  getPrinterStatus,
  getWindowsPrinterStatus,
  loadDesktopPrinterSettings,
  normalizePrinterSettings,
  setPrinterSettings,
} from '@/src/lib/printerConfig';
import { printTransactionReceipt } from '@/src/lib/receiptPrinting';
import { getUiSettings, saveUiSettings } from '@/src/lib/uiSettings';
import { isDesktopApp } from '@/src/lib/desktopClient';

const WEB_METHOD_OPTIONS = [
  {
    value: 'browser',
    label: 'Browser printing',
    description: 'Prints through the browser print dialog. Works when the POS is opened online or run on the till computer.',
  },
  {
    value: 'direct',
    label: 'Direct to thermal printer',
    description: 'Sends the receipt straight to the printer with no dialog. The POS must be running on the till computer.',
  },
  {
    value: 'both',
    label: 'Direct, with browser fallback',
    description: 'Tries direct printing first and uses browser printing if the printer can\'t be reached (e.g. when opened online).',
  },
];

const DESKTOP_METHOD_OPTIONS = [
  {
    value: 'windows',
    label: 'Windows printer (recommended)',
    description: 'Prints the full receipt design (logo, fonts, QR code) to the chosen printer with no dialog. Works with any printer installed in Windows, thermal or A4.',
  },
  {
    value: 'direct',
    label: 'Thermal printer — direct (ESC/POS)',
    description: 'Sends printer commands straight to a thermal printer by USB or network, with no dialog. Fastest; uses the printer\'s built-in font, without the logo.',
  },
  {
    value: 'both',
    label: 'Thermal direct, Windows printer if it fails',
    description: 'Tries the thermal printer directly and prints through Windows if it can\'t be reached.',
  },
  {
    value: 'browser',
    label: 'Print dialog',
    description: 'Opens the Windows print dialog for every receipt, to pick the printer and copies each time.',
  },
];

const PAPER_OPTIONS = [
  { value: 80, label: '80 mm roll' },
  { value: 58, label: '58 mm roll' },
];

function buildTestTransaction(staff, location) {
  const items = [
    { name: 'Test item with a long product name to check wrapping', quantity: 2, price: 1500 },
    { name: 'Second item', quantity: 1, price: 12500 },
  ];
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return {
    _id: `TEST${Date.now().toString().slice(-8)}`,
    createdAt: new Date().toISOString(),
    staffName: staff?.name || 'Test',
    locationName: location?.name || '',
    locationAddress: location?.address || '',
    items,
    subtotal,
    total: subtotal,
    amountPaid: 20000,
    change: 20000 - subtotal,
    tenderPayments: [{ tenderName: 'CASH', amount: 20000 }],
    status: 'completed',
  };
}

function StatusBadge({ status }) {
  if (!status) return null;
  return (
    <span className={`text-sm px-3 py-1.5 rounded border flex items-center gap-2 ${
      status.available ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'
    }`}>
      <FontAwesomeIcon icon={status.available ? faCircleCheck : faTriangleExclamation} className="w-4 h-4 flex-shrink-0" />
      {status.message}
    </span>
  );
}

export default function PrinterSettingsPanel({ staff = null, location = null, onSaved }) {
  const [desktop, setDesktop] = useState(false);
  const [settings, setSettings] = useState(getDefaultPrinterSettings());
  const [showPreview, setShowPreview] = useState(true);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [windowsPrinters, setWindowsPrinters] = useState([]);
  const [windowsStatus, setWindowsStatus] = useState(null);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testPrinting, setTestPrinting] = useState(false);

  const method = settings.printMethod;
  const usesDirect = method === 'direct' || method === 'both';
  const usesDesignedPrintout = method !== 'direct';
  // Desktop: where designed printouts (receipts, end-of-day report) go without a dialog
  const showWindowsPrinter = desktop && (method === 'windows' || method === 'both' || (method === 'direct' && settings.connectionMode === 'network'));

  const checkPrinter = useCallback(async (printerSettings) => {
    setChecking(true);
    try {
      setStatus(await getPrinterStatus(printerSettings));
    } finally {
      setChecking(false);
    }
  }, []);

  const refreshWindowsPrinters = useCallback(async (printerSettings) => {
    setLoadingPrinters(true);
    try {
      const result = await getWindowsPrinterStatus(printerSettings);
      setWindowsPrinters(result.printers);
      setWindowsStatus(result);
    } finally {
      setLoadingPrinters(false);
    }
  }, []);

  useEffect(() => {
    const onDesktop = isDesktopApp();
    setDesktop(onDesktop);
    (async () => {
      const saved = onDesktop ? await loadDesktopPrinterSettings() : getPrinterSettings();
      setSettings(saved);
      setShowPreview(getUiSettings().system?.showPrintPreview !== false);
      if (onDesktop) refreshWindowsPrinters(saved);
      if (saved.printMethod === 'direct' || saved.printMethod === 'both') checkPrinter(saved);
    })();
  }, [checkPrinter, refreshWindowsPrinters]);

  const update = (changes) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    if (desktop && ('windowsPrinterName' in changes || 'printMethod' in changes)) refreshWindowsPrinters(next);
  };

  const handlePaperChange = (paperWidth) => {
    const { sideMargin } = PAPER_PROFILES[paperWidth];
    update({ paperWidth, marginLeft: sideMargin, marginRight: sideMargin });
  };

  const handleMethodChange = (printMethod) => {
    update({ printMethod });
    if ((printMethod === 'direct' || printMethod === 'both') && !status) checkPrinter({ ...settings, printMethod });
  };

  const handleSave = () => {
    setSaving(true);
    try {
      const normalized = normalizePrinterSettings(settings);
      const saved = setPrinterSettings(normalized);
      const ui = getUiSettings();
      saveUiSettings({ ...ui, system: { ...ui.system, showPrintPreview: showPreview } });
      setSettings(normalized);
      if (saved) {
        showToast('Printer settings saved', 'success');
        onSaved?.(normalized);
      } else {
        showToast('Could not save printer settings', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setTestPrinting(true);
    try {
      const result = await printTransactionReceipt(buildTestTransaction(staff, location), null, {
        printerSettings: normalizePrinterSettings(settings),
        showPreview,
        // A test print ends with a bar across the page, so it is obvious whether the printout
        // reaches both edges of the paper
        widthRuler: true,
      });
      if (result.success) {
        showToast(
          result.method === 'direct' || (result.method === 'windows' && !showPreview) ? 'Test receipt sent to the printer' : 'Test receipt ready to print',
          'success'
        );
      } else if (result.method === 'none') {
        showToast(result.message || 'Test print failed', 'error');
      }
    } finally {
      setTestPrinting(false);
    }
  };

  const handleResetDefaults = async () => {
    const ok = await showConfirm('Reset this till\'s printer settings to the defaults?', {
      title: 'Reset Printer Settings',
      confirmLabel: 'Reset',
      variant: 'danger',
    });
    if (!ok) return;
    const defaults = getDefaultPrinterSettings();
    setSettings(defaults);
    setPrinterSettings(defaults);
    setStatus(null);
    if (desktop) refreshWindowsPrinters(defaults);
    showToast('Printer settings reset', 'success');
  };

  const inputClass = 'w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500';
  const methodOptions = desktop ? DESKTOP_METHOD_OPTIONS : WEB_METHOD_OPTIONS;
  // USB thermal printer names: straight from Windows in the desktop app, else from the server check
  const usbPrinterOptions = desktop && windowsPrinters.length > 0 ? windowsPrinters.map((printer) => printer.name) : status?.printers || [];
  const windowsPrinterLabel = method === 'both'
    ? 'Printer to use when the thermal printer can\'t be reached'
    : method === 'direct'
      ? 'Printer for the end-of-day report (network thermal printers have no Windows printer)'
      : 'Printer';

  return (
    <div className="p-6 space-y-8">
      {/* Print method */}
      <section>
        <h2 className="text-lg font-bold text-gray-800 mb-3">How receipts print</h2>
        <div className="space-y-2">
          {methodOptions.map((option) => (
            <label key={option.value} className={`flex items-start cursor-pointer p-3 border rounded-lg hover:bg-gray-50 ${
              method === option.value ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'
            }`}>
              <input
                type="radio"
                name="printMethod"
                value={option.value}
                checked={method === option.value}
                onChange={() => handleMethodChange(option.value)}
                className="w-4 h-4 mt-1"
              />
              <div className="ml-3">
                <p className="font-semibold text-gray-800">{option.label}</p>
                <p className="text-sm text-gray-500">{option.description}</p>
              </div>
            </label>
          ))}
        </div>
        {desktop && (
          <p className="text-xs text-gray-500 mt-2">
            Receipts and the end-of-day report go to: <strong>{describeDesktopPrintTarget(settings)}</strong>
          </p>
        )}
      </section>

      {/* Windows printer (desktop app) */}
      {showWindowsPrinter && (
        <section className="p-4 border border-gray-200 rounded-lg space-y-3">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <FontAwesomeIcon icon={faDesktop} className="w-4 h-4 text-gray-500" />
            Windows printer
          </h2>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{windowsPrinterLabel}</label>
            <div className="flex gap-2">
              <select
                value={settings.windowsPrinterName}
                onChange={(e) => update({ windowsPrinterName: e.target.value })}
                className={inputClass}
              >
                <option value="">Windows default printer{windowsPrinters.find((p) => p.isDefault) ? ` (${windowsPrinters.find((p) => p.isDefault).displayName})` : ''}</option>
                {windowsPrinters.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}{printer.isDefault ? ' — default' : ''}
                  </option>
                ))}
                {settings.windowsPrinterName && !windowsPrinters.some((p) => p.name === settings.windowsPrinterName) && (
                  <option value={settings.windowsPrinterName}>{settings.windowsPrinterName} (not installed)</option>
                )}
              </select>
              <button
                type="button"
                onClick={() => refreshWindowsPrinters(settings)}
                disabled={loadingPrinters}
                title="Refresh the printer list"
                className="px-3 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faRotate} className={`w-4 h-4 text-gray-600 ${loadingPrinters ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Printers installed in Windows Settings → Bluetooth &amp; devices → Printers &amp; scanners. Install the printer&apos;s driver first.
            </p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.fitToReceipt}
              onChange={(e) => update({ fitToReceipt: e.target.checked })}
              className="w-5 h-5 mt-0.5 rounded border-gray-300"
            />
            <span>
              <span className="font-semibold text-gray-700">Receipt roll: page length follows the receipt</span>
              <span className="block text-sm text-gray-500">On for thermal roll printers (no blank paper after the receipt). Turn off for A4 or Letter printers.</span>
            </span>
          </label>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Printed page width</label>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={settings.pageWidthMode || 'auto'}
                onChange={(e) => update({ pageWidthMode: e.target.value })}
                className={inputClass}
              >
                <option value="roll">Paper roll width ({settings.paperWidth} mm, recommended)</option>
                <option value="auto">Ask the printer for its paper size</option>
                <option value="custom">Set it myself</option>
              </select>
              {settings.pageWidthMode === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={MIN_PAGE_WIDTH}
                    max={MAX_PAGE_WIDTH}
                    step={0.5}
                    value={settings.pageWidthMm}
                    onChange={(e) => update({ pageWidthMm: e.target.value })}
                    className={`${inputClass} w-28`}
                  />
                  <span className="text-sm text-gray-600">mm</span>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              How wide the page sent to the printer is. The roll width is the size the printer driver already has, and
              Windows fits it to the area the printer can print — with the side margins at 0 the receipt covers all of
              it. Use &quot;Ask the printer&quot; only if the printout comes out narrower than the paper: it is exact,
              but a printer with no form that size can answer with an error slip instead of a receipt. Print a test
              receipt to check — it ends with a bar that should just reach both edges of the paper.
            </p>
          </div>
          <StatusBadge status={windowsStatus} />
        </section>
      )}

      {/* Paper */}
      <section>
        <h2 className="text-lg font-bold text-gray-800 mb-3">Paper</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Paper roll</label>
            <select
              value={settings.paperWidth}
              onChange={(e) => handlePaperChange(Number(e.target.value))}
              className={inputClass}
            >
              {PAPER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          {usesDesignedPrintout && (
            <>
              {[
                { key: 'marginLeft', label: 'Left margin (mm)' },
                { key: 'marginRight', label: 'Right margin (mm)' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">{field.label}</label>
                  <input
                    type="number"
                    min={0}
                    max={MAX_SIDE_MARGIN}
                    step={0.5}
                    value={settings[field.key]}
                    onChange={(e) => update({ [field.key]: e.target.value })}
                    className={inputClass}
                  />
                </div>
              ))}
            </>
          )}
        </div>
        {usesDesignedPrintout && (
          <p className="text-sm text-gray-500 mt-2">
            Blank space kept on each side of {desktop ? 'the printed receipt design' : 'browser printouts'}, on top of the edge the
            printer cannot reach. At the default of {PAPER_PROFILES[settings.paperWidth].sideMargin} mm the printout is as wide as the
            printer can print. If text is cut off on one side, raise that side&apos;s margin by 1–2 mm and print a test receipt.
          </p>
        )}
      </section>

      {/* Preview */}
      {usesDesignedPrintout && (
        <section className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
          <h2 className="text-lg font-bold text-gray-800">{desktop ? 'Receipt preview' : 'Browser printing'}</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showPreview}
              onChange={(e) => setShowPreview(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300"
            />
            <span className="font-semibold text-gray-700">Show receipt preview before printing</span>
          </label>
          <p className="text-sm text-gray-500">
            {desktop
              ? 'Off: receipts print as soon as a sale completes. On: a preview opens first; its Print button uses the printer above, and "Choose printer" opens the Windows print dialog.'
              : 'Browsers always show their print dialog. In it, choose the receipt printer and leave Margins and Scale on Default; the browser remembers these for next time.'}
          </p>
        </section>
      )}

      {/* Direct printer */}
      {usesDirect && (
        <section className="p-4 border border-gray-200 rounded-lg space-y-4">
          <h2 className="text-lg font-bold text-gray-800">Thermal printer connection</h2>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Text size on direct printouts</label>
            <select
              value={settings.thermalTextSize || 'auto'}
              onChange={(e) => update({ thermalTextSize: e.target.value })}
              className={inputClass}
            >
              <option value="auto">Follow Receipt Settings</option>
              <option value="standard">Standard (fewer, larger characters)</option>
              <option value="small">Small (more characters per line)</option>
            </select>
            <p className="text-sm text-gray-500 mt-1">
              A thermal printer has two built-in fonts, so direct printing cannot use every size. &quot;Follow Receipt
              Settings&quot; uses the small font when the font size in the management app (Setup → Receipts) is under 7pt.
              The store logo prints above the name on direct printouts as well.
            </p>
          </div>

          <div className="flex flex-wrap gap-6">
            {[
              { value: 'usb', label: 'USB (installed on this computer)', icon: faPlug },
              { value: 'network', label: 'Network (IP address)', icon: faNetworkWired },
            ].map((mode) => (
              <label key={mode.value} className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="connectionMode"
                  value={mode.value}
                  checked={settings.connectionMode === mode.value}
                  onChange={() => { update({ connectionMode: mode.value }); setStatus(null); }}
                  className="w-4 h-4"
                />
                <span className="ml-2 font-medium text-gray-700 flex items-center gap-2">
                  <FontAwesomeIcon icon={mode.icon} className="w-4 h-4 text-gray-500" />
                  {mode.label}
                </span>
              </label>
            ))}
          </div>

          {settings.connectionMode === 'usb' ? (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Windows printer</label>
              {usbPrinterOptions.length > 0 ? (
                <select
                  value={usbPrinterOptions.includes(settings.printerName) ? settings.printerName : ''}
                  onChange={(e) => update({ printerName: e.target.value })}
                  className={inputClass}
                >
                  <option value="" disabled>Select the receipt printer</option>
                  {usbPrinterOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={settings.printerName}
                  onChange={(e) => update({ printerName: e.target.value })}
                  placeholder="XP-80C"
                  className={inputClass}
                />
              )}
              <p className="text-xs text-gray-500 mt-1">
                The printer&apos;s name as shown in Windows Settings → Printers &amp; scanners. Install the printer&apos;s driver first.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Printer IP address</label>
                <input
                  type="text"
                  value={settings.ip}
                  onChange={(e) => update({ ip: e.target.value })}
                  placeholder="192.168.1.100"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Port</label>
                <input
                  type="number"
                  value={settings.port}
                  onChange={(e) => update({ port: e.target.value })}
                  placeholder="9100"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => checkPrinter(settings)}
              disabled={checking}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition disabled:opacity-50"
            >
              {checking ? 'Checking…' : 'Check printer'}
            </button>
            <StatusBadge status={status} />
          </div>

          <p className="text-sm text-gray-500">
            Direct printing uses the printer&apos;s built-in font. The logo and the font family chosen in Receipt Settings
            appear on {desktop ? 'Windows printer' : 'browser'} printouts only; font size and bold text are applied on direct printouts too.
          </p>
        </section>
      )}

      <div className="flex flex-wrap gap-3 pt-6 border-t border-gray-200">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 min-w-[10rem] px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 font-semibold flex items-center justify-center gap-2"
        >
          <FontAwesomeIcon icon={faFloppyDisk} className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        <button
          onClick={handleTestPrint}
          disabled={testPrinting}
          className="px-6 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition disabled:opacity-50 font-semibold flex items-center gap-2"
        >
          <FontAwesomeIcon icon={faReceipt} className="w-4 h-4" />
          {testPrinting ? 'Printing…' : 'Print test receipt'}
        </button>
        <button
          onClick={handleResetDefaults}
          className="px-6 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition flex items-center gap-2"
        >
          <FontAwesomeIcon icon={faRotateLeft} className="w-4 h-4" />
          Reset Defaults
        </button>
      </div>
      <p className="text-xs text-gray-500 -mt-4">
        The test receipt uses the settings on this page, even before you save them.
      </p>
    </div>
  );
}
