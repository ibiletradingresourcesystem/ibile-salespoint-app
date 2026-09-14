/**
 * Printer Settings Page
 *
 * This till's receipt printer: how receipts print, paper size / print area, and the direct
 * (thermal) printer connection. Receipt design comes from the management app's Receipt Settings.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { useStaff } from '@/src/context/StaffContext';
import { hasPosPermission } from '@/src/lib/posPermissions';
import { showConfirm } from '@/src/components/common/ConfirmDialog';
import { showToast } from '@/src/components/common/Toast';
import {
  MAX_SIDE_MARGIN,
  PAPER_PROFILES,
  getPrinterSettings,
  setPrinterSettings,
  getDefaultPrinterSettings,
  getPrinterStatus,
  normalizePrinterSettings,
} from '@/src/lib/printerConfig';
import { printTransactionReceipt } from '@/src/lib/receiptPrinting';
import { getUiSettings, saveUiSettings } from '@/src/lib/uiSettings';

const PRINT_METHOD_OPTIONS = [
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

export default function PrinterSettings() {
  const router = useRouter();
  const { staff, location } = useStaff();
  const [settings, setSettings] = useState(getDefaultPrinterSettings());
  const [showPreview, setShowPreview] = useState(true);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testPrinting, setTestPrinting] = useState(false);
  const canAccessPrinterSettings = hasPosPermission(staff, 'printerSettingsAccess');

  const usesDirect = settings.printMethod !== 'browser';
  const usesBrowser = settings.printMethod !== 'direct';

  const checkPrinter = useCallback(async (printerSettings) => {
    setChecking(true);
    try {
      setStatus(await getPrinterStatus(printerSettings));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (staff && !canAccessPrinterSettings) {
      router.replace('/');
      return;
    }
    const saved = getPrinterSettings();
    setSettings(saved);
    setShowPreview(getUiSettings().system?.showPrintPreview !== false);
    if (saved.printMethod !== 'browser') checkPrinter(saved);
  }, [canAccessPrinterSettings, checkPrinter, router, staff]);

  const update = (changes) => {
    setSettings((prev) => ({ ...prev, ...changes }));
  };

  const handlePaperChange = (paperWidth) => {
    const { sideMargin } = PAPER_PROFILES[paperWidth];
    update({ paperWidth, marginLeft: sideMargin, marginRight: sideMargin });
  };

  const handleMethodChange = (printMethod) => {
    update({ printMethod });
    if (printMethod !== 'browser' && !status) checkPrinter({ ...settings, printMethod });
  };

  const saveSettings = () => {
    const normalized = normalizePrinterSettings(settings);
    const saved = setPrinterSettings(normalized);
    const ui = getUiSettings();
    saveUiSettings({ ...ui, system: { ...ui.system, showPrintPreview: showPreview } });
    setSettings(normalized);
    return saved;
  };

  const handleSave = () => {
    setSaving(true);
    try {
      if (saveSettings()) showToast('Printer settings saved', 'success');
      else showToast('Could not save printer settings', 'error');
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
      });
      if (result.success) {
        showToast(result.method === 'direct' ? 'Test receipt sent to the printer' : 'Test receipt ready to print', 'success');
      } else if (result.method !== 'direct') {
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
    showToast('Printer settings reset', 'success');
  };

  if (staff && !canAccessPrinterSettings) {
    return <div className="max-w-3xl mx-auto p-6 text-center text-gray-600">You do not have permission to access printer settings.</div>;
  }

  const inputClass = 'w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500';
  const printerOptions = status?.printers || [];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-sm py-2 -mx-6 px-6 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
        >
          <FontAwesomeIcon icon={faArrowLeft} className="w-4 h-4" />
          <span>Back</span>
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-lg">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-t-lg">
          <h1 className="text-3xl font-bold">🖨️ Printer Settings</h1>
          <p className="text-blue-100 mt-2">
            How this till prints receipts. The receipt design (logo, company details, font, QR code and messages)
            is set in the management app under Setup → Receipt Settings.
          </p>
        </div>

        <div className="p-6 space-y-8">
          {/* Print method */}
          <section>
            <h2 className="text-lg font-bold text-gray-800 mb-3">How receipts print</h2>
            <div className="space-y-2">
              {PRINT_METHOD_OPTIONS.map((option) => (
                <label key={option.value} className={`flex items-start cursor-pointer p-3 border rounded-lg hover:bg-gray-50 ${
                  settings.printMethod === option.value ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'
                }`}>
                  <input
                    type="radio"
                    name="printMethod"
                    value={option.value}
                    checked={settings.printMethod === option.value}
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
          </section>

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
              {usesBrowser && (
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
            {usesBrowser && (
              <p className="text-sm text-gray-500 mt-2">
                Blank space kept on each side of browser printouts. If text is cut off on one side, raise that side&apos;s margin by
                1–2 mm and print a test receipt; if there is too much blank space, lower it. The default is{' '}
                {PAPER_PROFILES[settings.paperWidth].sideMargin} mm per side.
              </p>
            )}
          </section>

          {/* Browser printing */}
          {usesBrowser && (
            <section className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
              <h2 className="text-lg font-bold text-gray-800">Browser printing</h2>
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
                Browsers always show their print dialog. In it, choose the receipt printer and leave Margins and Scale on Default;
                the browser remembers these for next time.
              </p>
            </section>
          )}

          {/* Direct printer */}
          {usesDirect && (
            <section className="p-4 border border-gray-200 rounded-lg space-y-4">
              <h2 className="text-lg font-bold text-gray-800">Thermal printer connection</h2>

              <div className="flex gap-6">
                {[
                  { value: 'usb', label: '🔌 USB (installed on this computer)' },
                  { value: 'network', label: '🌐 Network (IP address)' },
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
                    <span className="ml-2 font-medium text-gray-700">{mode.label}</span>
                  </label>
                ))}
              </div>

              {settings.connectionMode === 'usb' ? (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Windows printer</label>
                  {printerOptions.length > 0 ? (
                    <select
                      value={printerOptions.includes(settings.printerName) ? settings.printerName : ''}
                      onChange={(e) => update({ printerName: e.target.value })}
                      className={inputClass}
                    >
                      <option value="" disabled>Select the receipt printer</option>
                      {printerOptions.map((name) => (
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
                {status && (
                  <span className={`text-sm px-3 py-1.5 rounded border ${
                    status.available
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}>
                    {status.available ? '✅ ' : '⚠️ '}{status.message}
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-500">
                Direct printing uses the printer&apos;s built-in font. The logo and the font family chosen in Receipt Settings
                appear on browser printouts only; font size and bold text are applied on direct printouts too.
              </p>
            </section>
          )}

          <div className="flex flex-wrap gap-3 pt-6 border-t border-gray-200">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 min-w-[10rem] px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 font-semibold"
            >
              {saving ? 'Saving…' : '💾 Save Settings'}
            </button>
            <button
              onClick={handleTestPrint}
              disabled={testPrinting}
              className="px-6 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition disabled:opacity-50 font-semibold"
            >
              {testPrinting ? 'Printing…' : '🧾 Print test receipt'}
            </button>
            <button
              onClick={handleResetDefaults}
              className="px-6 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition"
            >
              ↻ Reset Defaults
            </button>
          </div>
          <p className="text-xs text-gray-500 -mt-4">
            The test receipt uses the settings on this page, even before you save them.
          </p>
        </div>
      </div>
    </div>
  );
}
