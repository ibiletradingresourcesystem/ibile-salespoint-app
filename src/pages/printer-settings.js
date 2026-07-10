/**
 * Printer Settings Page
 * 
 * Configure thermal printer (Xprinter XP-D200N) connection and print settings
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faEye } from '@fortawesome/free-solid-svg-icons';
import { useStaff } from '@/src/context/StaffContext';
import { hasPosPermission } from '@/src/lib/posPermissions';
import { showConfirm } from '@/src/components/common/ConfirmDialog';
import { showToast } from '@/src/components/common/Toast';
import {
  getPrinterSettings,
  setPrinterSettings,
  getDefaultPrinterSettings,
  testPrinterConnection,
  getPrinterStatus,
} from '@/src/lib/printerConfig';
import { getUiSettings, saveUiSettings } from '@/src/lib/uiSettings';

export default function PrinterSettings() {
  const router = useRouter();
  const { staff } = useStaff();
  const [settings, setSettings] = useState(getDefaultPrinterSettings());
  const [uiSettings, setUiSettings] = useState(() => getUiSettings());
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [printerAvailable, setPrinterAvailable] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const canAccessPrinterSettings = hasPosPermission(staff, 'printerSettingsAccess');

  useEffect(() => {
    if (staff && !canAccessPrinterSettings) {
      router.replace('/');
      return;
    }

    // Load saved settings on mount
    const saved = getPrinterSettings();
    setSettings(saved);
    
    // Check printer availability on mount
    checkPrinterAvailability(saved);
  }, [canAccessPrinterSettings, router, staff]);

  // Check if printer is available
  const checkPrinterAvailability = async (printerSettings) => {
    try {
      setCheckingStatus(true);
      const result = await getPrinterStatus(printerSettings);
      setPrinterAvailable(result);
    } catch (error) {
      console.warn('Failed to check printer availability:', error);
      setPrinterAvailable({
        available: false,
        status: 'error',
        message: 'Could not check printer status',
      });
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      const saved = setPrinterSettings(settings);
      // Also persist the print preview toggle
      saveUiSettings(uiSettings);

      if (saved) {
        setSuccess('✅ Printer settings saved successfully!');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError('Failed to save printer settings');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUiSettingChange = (key, value) => {
    setUiSettings(prev => ({
      ...prev,
      system: { ...prev.system, [key]: value },
    }));
  };

  const handleTestConnection = async () => {
    try {
      setTestingConnection(true);
      setConnectionStatus(null);
      setError('');
      let result;

      if (settings.connectionMode === 'network') {
        result = await testPrinterConnection(settings);
        setConnectionStatus(result);
      } else {
        // USB mode: check printer status via status API
        result = await getPrinterStatus(settings);
        setConnectionStatus({
          success: result.available === true,
          message: result.available
            ? result.message || 'USB printer detected and ready'
            : result.message || 'USB printer not detected. Check connection and driver.',
        });
        result = {
          success: result.available === true,
          message: result.message || 'USB printer status checked',
        };
      }

      if (result.success) {
        setSuccess('✅ Printer connected successfully!');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(`❌ Connection failed: ${result.message}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleResetDefaults = async () => {
    const ok = await showConfirm('Reset to default settings?', {
      title: 'Reset Printer Settings',
      confirmLabel: 'Reset',
      variant: 'danger',
    });
    if (ok) {
      const defaults = getDefaultPrinterSettings();
      setSettings(defaults);
      setPrinterSettings(defaults);
      showToast('Reset to default settings', 'success');
    }
  };

  if (staff && !canAccessPrinterSettings) {
    return <div className="max-w-3xl mx-auto p-6 text-center text-gray-600">You do not have permission to access printer settings.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      {/* Back Button */}
      <button 
        onClick={() => router.back()}
        className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
      >
        <FontAwesomeIcon icon={faArrowLeft} className="w-4 h-4" />
        <span>Back</span>
      </button>

      <div className="bg-white rounded-lg shadow-lg">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-t-lg">
          <h1 className="text-3xl font-bold">🖨️ Printer Settings</h1>
          <p className="text-blue-100 mt-2">Configure Xprinter XP-D200N thermal printer</p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* USB Setup Guide */}
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <h3 className="font-bold text-purple-900 mb-2">📖 USB Printer Setup</h3>
            <p className="text-sm text-purple-900 mb-3">For USB (Direct) Connection:</p>
            <ol className="text-sm text-purple-900 space-y-1 list-decimal list-inside mb-3">
              <li>Connect Xprinter to USB port</li>
              <li>Install Xprinter driver and ensure it&apos;s running</li>
              <li>Select <strong>🔌 USB</strong> mode below</li>
              <li>Click <strong>Refresh</strong> to check if printer is detected</li>
            </ol>
            
            <div className="bg-white p-3 rounded border border-purple-200 text-sm">
              <p className="font-semibold text-purple-900 mb-2">❌ If printer still not detected:</p>
              <ul className="text-purple-800 space-y-1 list-disc list-inside">
                <li>Restart Xprinter driver application</li>
                <li>Check Windows Devices for &quot;Xprinter&quot; (right-click &gt; Printers)</li>
                <li>Ensure Print Spooler service is running (Services app)</li>
                <li>Try disconnecting and reconnecting the USB cable</li>
                <li>Check Device Manager for any yellow warning icons</li>
              </ul>
            </div>
            <p className="text-xs text-purple-800 mt-2 italic">Detection checks Windows printer queue and USB devices</p>
          </div>

          {/* Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
              {success}
            </div>
          )}

          {/* Printer Availability Status */}
          {printerAvailable && (
            <div className={`rounded-lg border-l-4 p-4 ${
              printerAvailable.available
                ? 'bg-green-50 border-green-500'
                : 'bg-yellow-50 border-yellow-500'
            }`}>
              <div className="flex items-center justify-between">
                <div className={printerAvailable.available ? 'text-green-800' : 'text-yellow-800'}>
                  <p className="font-bold flex items-center gap-2">
                    {printerAvailable.available ? (
                      <>
                        <span className="text-xl">✅</span>
                        Printer Available
                      </>
                    ) : (
                      <>
                        <span className="text-xl">⚠️</span>
                        Printer Unavailable
                      </>
                    )}
                  </p>
                  <p className="text-sm mt-1">{printerAvailable.message}</p>
                  {printerAvailable.details && (
                    <p className="text-xs mt-2 opacity-75">{printerAvailable.details}</p>
                  )}
                </div>
                <button
                  onClick={() => checkPrinterAvailability(settings)}
                  disabled={checkingStatus}
                  className="ml-4 px-3 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:bg-gray-400 transition"
                >
                  {checkingStatus ? 'Checking...' : 'Refresh'}
                </button>
              </div>
            </div>
          )}

          {/* Printer Status from Test Connection */}
          {connectionStatus && (
            <div className={`border-l-4 p-4 ${connectionStatus.success ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'}`}>
              <div className={connectionStatus.success ? 'text-green-800' : 'text-red-800'}>
                <p className="font-bold">
                  {connectionStatus.success ? '✅ Connected' : '❌ Disconnected'}
                </p>
                <p className="text-sm mt-1">{connectionStatus.message}</p>
              </div>
            </div>
          )}

          {/* Settings Form */}
          <div className="space-y-6">
            {/* Printer Enabled */}
            <div className="flex items-center gap-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => handleChange('enabled', e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300"
                />
                <span className="ml-3 font-semibold text-gray-700">Enable Thermal Printer</span>
              </label>
              <span className="text-sm text-gray-500">Uncheck to use only browser printing</span>
            </div>

            {/* Printer Type */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Printer Type
              </label>
              <select
                value={settings.type}
                onChange={(e) => handleChange('type', e.target.value)}
                className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
              >
                <option value="xprinter">Xprinter XP-D200N</option>
                <option value="generic">Generic ESC/POS</option>
                <option value="network">Network Printer</option>
              </select>
            </div>

            {/* Connection Mode */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Connection Mode
              </label>
              <div className="flex gap-4">
                {['usb', 'network'].map((mode) => (
                  <label key={mode} className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="connectionMode"
                      value={mode}
                      checked={settings.connectionMode === mode}
                      onChange={(e) => handleChange('connectionMode', e.target.value)}
                      className="w-4 h-4"
                    />
                    <span className="ml-2 capitalize font-medium text-gray-700">
                      {mode === 'usb' ? '🔌 USB' : '🌐 Network'}
                    </span>
                  </label>
                ))}
              </div>
              {settings.connectionMode === 'usb' && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded text-blue-800 text-sm">
                  <p className="font-semibold">✅ USB Mode</p>
                  <p className="mt-1">Printer will be detected via USB connection. Make sure printer is connected and Xprinter driver is installed.</p>
                </div>
              )}
            </div>

            {/* Network Settings - Only for Network mode */}
            {settings.connectionMode === 'network' && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Printer IP Address
                  </label>
                  <input
                    type="text"
                    value={settings.ip}
                    onChange={(e) => handleChange('ip', e.target.value)}
                    placeholder="192.168.1.100"
                    className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Find IP in printer settings or network device list
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Printer Port
                  </label>
                  <input
                    type="number"
                    value={settings.port}
                    onChange={(e) => handleChange('port', parseInt(e.target.value))}
                    placeholder="9100"
                    className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Default: 9100</p>
                </div>
              </>
            )}

            {/* Print Method */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Print Method
              </label>
              <div className="space-y-2">
                {[
                  { value: 'direct', label: '⚡ Direct (Fast, no dialog)', desc: 'Sends directly to printer' },
                  { value: 'browser', label: '🖱️ Browser (Manual dialog)', desc: 'Shows print dialog' },
                  { value: 'both', label: '🔄 Both (Try direct, fallback to browser)', desc: 'Best compatibility' },
                ].map((option) => (
                  <label key={option.value} className="flex items-start cursor-pointer p-3 border rounded hover:bg-gray-50">
                    <input
                      type="radio"
                      name="printMethod"
                      value={option.value}
                      checked={settings.printMethod === option.value}
                      onChange={(e) => handleChange('printMethod', e.target.value)}
                      className="w-4 h-4 mt-1"
                    />
                    <div className="ml-3">
                      <p className="font-medium text-gray-700">{option.label}</p>
                      <p className="text-xs text-gray-500">{option.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Paper Settings */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Paper Width (mm)
                </label>
                <input
                  type="number"
                  value={settings.paperWidth}
                  onChange={(e) => handleChange('paperWidth', parseInt(e.target.value))}
                  className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Paper Type
                </label>
                <select
                  value={settings.paperSize}
                  onChange={(e) => handleChange('paperSize', e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="receipt">Receipt</option>
                  <option value="label">Label</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>

            {/* Auto Print */}
            <div className="flex items-center gap-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoPrint}
                  onChange={(e) => handleChange('autoPrint', e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300"
                />
                <span className="ml-3 font-semibold text-gray-700">Auto Print without dialog</span>
              </label>
              <span className="text-sm text-gray-500">(For thermal printer only — skips all dialogs when direct print succeeds)</span>
            </div>

            {/* Browser Print Behavior */}
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4">
              <h3 className="font-bold text-gray-800">🖥️ Browser Print Behavior</h3>
              <p className="text-sm text-gray-600">Controls how receipts print when using browser-based printing (no thermal printer or fallback mode).</p>

              {/* Show Print Preview */}
              <div className="flex items-center gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={uiSettings.system?.showPrintPreview !== false}
                    onChange={(e) => handleUiSettingChange('showPrintPreview', e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300"
                  />
                  <span className="ml-3 font-semibold text-gray-700 flex items-center gap-2">
                    <FontAwesomeIcon icon={faEye} className="w-4 h-4 text-cyan-600" />
                    Show Print Preview Modal
                  </span>
                </label>
              </div>
              <p className="text-xs text-gray-500 ml-8">
                {uiSettings.system?.showPrintPreview !== false
                  ? '✅ Enabled — A branded preview modal is shown before printing. You can review the receipt and click Print.'
                  : '⚡ Disabled — Receipts are sent directly to the printer. The OS print dialog will still appear (browsers require it for security).'}
              </p>
              <div className="ml-8 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                <p className="font-semibold">💡 Note about silent printing:</p>
                <p className="mt-1">Browsers always show the OS print dialog for security reasons. To print completely silently (no dialog at all), use <strong>Direct</strong> print method with a thermal printer connected via USB or Network.</p>
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-4 pt-6 border-t border-gray-200">
            <button
              onClick={handleTestConnection}
              disabled={testingConnection || !settings.enabled}
              className="px-6 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition disabled:opacity-50"
            >
              {testingConnection ? '⏳ Testing...' : '🔗 Test Connection'}
            </button>

            <button
              onClick={handleSave}
              disabled={loading}
              className="flex-1 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 font-semibold"
            >
              {loading ? '⏳ Saving...' : '💾 Save Settings'}
            </button>

            <button
              onClick={handleResetDefaults}
              className="px-6 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition"
            >
              ↻ Reset Defaults
            </button>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-800">
            <p className="font-semibold mb-2">💡 Printer Setup Guide:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Find printer IP: Check printer display or router</li>
              <li>Default port: 9100 (for Xprinter)</li>
              <li>Test connection to verify setup</li>
              <li>After saving, receipts will print automatically</li>
              <li>Browser print will be used as fallback if direct print fails</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
