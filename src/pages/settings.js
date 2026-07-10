/**
 * Settings Page
 *
 * Configure sidebar visibility, till controls, layout sizing, and system scale.
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faChevronDown,
  faChevronRight,
  faPrint,
  faBoxes,
  faGripHorizontal,
  faClock,
  faCoins,
  faRulerCombined,
  faSlidersH,
  faShoppingCart,
  faMapMarkerAlt,
  faSignOutAlt,
  faUserClock,
  faEye,
  faSync,
} from '@fortawesome/free-solid-svg-icons';
import {
  getUiSettings,
  saveUiSettings,
  resetUiSettings,
  defaultUiSettings,
  DIRECTOR_MEMO_ACCOUNT_OPTIONS,
} from '@/src/lib/uiSettings';
import { useStaff } from '@/src/context/StaffContext';
import { hasPosPermission } from '@/src/lib/posPermissions';
import { showConfirm } from '@/src/components/common/ConfirmDialog';
import { showToast } from '@/src/components/common/Toast';

const DENSITY_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
];

const WIDTH_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'standard', label: 'Standard' },
  { value: 'wide', label: 'Wide' },
];

const PAYMENT_SCALE_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'standard', label: 'Standard' },
  { value: 'large', label: 'Large' },
];

const CONTENT_SCALE_MIN = 60;
const CONTENT_SCALE_MAX = 150;

export default function SettingsPage() {
  const router = useRouter();
  const { staff } = useStaff();
  const [settings, setSettings] = useState(getUiSettings());
  const [allLocations, setAllLocations] = useState([]);
  const [expanded, setExpanded] = useState({
    sidebar: true,
    till: true,
    cartButtons: true,
    layout: true,
    payment: true,
    system: true,
    systemPrint: true,
    login: true,
    summary: true,
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [saveLabel, setSaveLabel] = useState('Save Settings');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const canAccessSettings = hasPosPermission(staff, 'settingsAccess');

  // Track online/offline status
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    setSettings(getUiSettings());
  }, []);

  useEffect(() => {
    const fetchServerSettings = async () => {
      if (!staff?.storeId || !isOnline) return;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`/api/ui-settings?storeId=${staff.storeId}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.settings) {
          saveUiSettings(data.settings);
          setSettings(data.settings);
        }
      } catch (err) {
        // fallback to local settings
      }
    };

    fetchServerSettings();
  }, [staff?.storeId, isOnline]);

  // Fetch all locations for the location selector
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        // Try cached first
        const cached = localStorage.getItem('cachedLocations');
        if (cached) {
          setAllLocations(JSON.parse(cached));
        }
        // Then try API only if online
        if (!isOnline) return;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('/api/store/init-locations', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (data.store?.locations) {
            const active = data.store.locations.filter(loc => loc.isActive !== false);
            setAllLocations(active);
          }
        }
      } catch (err) {
        console.warn('Could not fetch locations for settings:', err);
      }
    };
    fetchLocations();
  }, [isOnline]);

  const toggleSection = (key) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateSidebarSection = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      sidebarSections: {
        ...prev.sidebarSections,
        [key]: value,
      },
    }));
  };

  const updateAdminControl = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      adminControls: {
        ...prev.adminControls,
        [key]: value,
      },
    }));
  };

  const updateCartPanelButton = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      cartPanelButtons: {
        ...(prev.cartPanelButtons || {}),
        [key]: value,
      },
    }));
  };

  const updateLayoutSetting = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        [key]: value,
      },
    }));
  };

  const updatePaymentSetting = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      payment: {
        ...prev.payment,
        [key]: value,
      },
    }));
  };

  const updateSystemSetting = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      system: {
        ...prev.system,
        [key]: value,
      },
    }));
  };

  const updateLoginSetting = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      login: {
        ...prev.login,
        [key]: value,
      },
    }));
  };

  const toggleLocationVisibility = (locationId) => {
    setSettings((prev) => {
      const current = prev.login?.visibleLocationIds || [];
      const next = current.includes(locationId)
        ? current.filter((id) => id !== locationId)
        : [...current, locationId];
      return {
        ...prev,
        login: {
          ...prev.login,
          visibleLocationIds: next,
        },
      };
    });
  };

  const adjustContentScale = (delta) => {
    const current = Number(settings.system?.contentScale || defaultUiSettings.system?.contentScale || 100);
    const next = Math.min(CONTENT_SCALE_MAX, Math.max(CONTENT_SCALE_MIN, current + delta));
    updateSystemSetting('contentScale', next);
  };

  const updateQuickAmount = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      payment: {
        ...prev.payment,
        quickAmounts: {
          ...(prev.payment?.quickAmounts || {}),
          [key]: value,
        },
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Always save locally first
      saveUiSettings(settings);

      if (staff?.storeId && isOnline) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const res = await fetch('/api/ui-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storeId: staff.storeId, settings }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            if (data?.settings) {
              saveUiSettings(data.settings);
              setSettings(data.settings);
            }
          }
        } catch (syncErr) {
          // Server save failed (offline or timeout) — local save already done
          console.warn('Settings saved locally only (server unreachable)');
        }
      }
      setSaveLabel('Saved');
      setSuccess('✅ Settings saved');
      setTimeout(() => {
        setSuccess('');
        setSaveLabel('Save Settings');
      }, 2500);
    } catch (err) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const ok = await showConfirm('Reset settings to defaults?', {
      title: 'Reset Settings',
      confirmLabel: 'Reset',
      variant: 'danger',
    });
    if (ok) {
      const defaults = resetUiSettings();
      setSettings(defaults);
      showToast('Settings reset to defaults', 'success');
    }
  };

  const summary = {
    sidebar: [
      settings.sidebarSections?.print ? 'Print' : null,
      settings.sidebarSections?.stock ? 'Stock' : null,
      settings.sidebarSections?.apps ? 'Apps' : null,
    ].filter(Boolean),
    till: [
      settings.adminControls?.openTillCashEntry ? 'Open Till cash entry enabled' : 'Open Till cash entry disabled',
      settings.adminControls?.adjustFloat ? 'Adjust Float enabled' : 'Adjust Float disabled',
    ],
    layout: [
      `Sidebar width: ${settings.layout?.sidebarWidth || defaultUiSettings.layout.sidebarWidth}`,
      `Cart panel width: ${settings.layout?.cartPanelWidth || defaultUiSettings.layout.cartPanelWidth}`,
      `Content density: ${settings.layout?.contentDensity || defaultUiSettings.layout.contentDensity}`,
    ],
    payment: [
      `Payment scale: ${settings.payment?.scale || defaultUiSettings.payment.scale}`,
      `Payment content size: ${settings.payment?.contentSize || defaultUiSettings.payment.contentSize}`,
      `Keypad size: ${settings.payment?.keypadSize || defaultUiSettings.payment.keypadSize}`,
      `Quick amounts: ${Object.entries(settings.payment?.quickAmounts || defaultUiSettings.payment.quickAmounts)
        .filter(([, enabled]) => enabled)
        .map(([label]) => (label === 'exact' ? 'Exact' : `₦${label}`))
        .join(', ') || 'None'}`,
    ],
    system: [
      `Content scale: ${settings.system?.contentScale || defaultUiSettings.system?.contentScale || 100}%`,
    ],
    login: [
      `Exit button: ${settings.login?.showExitButton !== false ? 'Shown' : 'Hidden'}`,
      `Clock In/Out: ${settings.login?.showClockInOut !== false ? 'Shown' : 'Hidden'}`,
      `Visible locations: ${(settings.login?.visibleLocationIds || []).length > 0 ? (settings.login.visibleLocationIds.length + ' selected') : 'All'}`,
    ],
  };

  // Settings page is accessible to all staff roles - settings are store-wide

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      {/* Back Button */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
        >
          <FontAwesomeIcon icon={faArrowLeft} className="w-4 h-4" />
          <span>Back</span>
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white p-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold">⚙️ System Settings</h1>
            {!isOnline && (
              <span className="bg-amber-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                OFFLINE — Saved locally
              </span>
            )}
          </div>
          <p className="text-slate-200 mt-2">
            Configure sidebar menus, till controls, layout spacing, and system scale
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center justify-between">
              <span>{success}</span>
              <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-1 rounded-full border border-green-200">
                Saved
              </span>
            </div>
          )}

          {/* Sidebar Sections */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('sidebar')}
              className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 text-left font-semibold text-gray-800"
            >
              <FontAwesomeIcon icon={faSlidersH} className="text-blue-600 w-5 h-5" />
              Sidebar Sections
              <span className="ml-auto">
                <FontAwesomeIcon icon={expanded.sidebar ? faChevronDown : faChevronRight} />
              </span>
            </button>
            {expanded.sidebar && (
              <div className="p-5 space-y-4 bg-white">
                <p className="text-sm text-gray-600">
                  Show or hide sidebar sections like Print, Stock, and Apps.
                </p>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={settings.sidebarSections?.print !== false}
                    onChange={(e) => updateSidebarSection('print', e.target.checked)}
                  />
                  <FontAwesomeIcon icon={faPrint} className="text-purple-600 w-4 h-4" />
                  <span className="font-semibold text-gray-700">Print</span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={settings.sidebarSections?.stock !== false}
                    onChange={(e) => updateSidebarSection('stock', e.target.checked)}
                  />
                  <FontAwesomeIcon icon={faBoxes} className="text-orange-600 w-4 h-4" />
                  <span className="font-semibold text-gray-700">Stock</span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={settings.sidebarSections?.apps !== false}
                    onChange={(e) => updateSidebarSection('apps', e.target.checked)}
                  />
                  <FontAwesomeIcon icon={faGripHorizontal} className="text-green-600 w-4 h-4" />
                  <span className="font-semibold text-gray-700">Apps</span>
                </label>
              </div>
            )}
          </div>

          {/* Till Controls */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('till')}
              className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 text-left font-semibold text-gray-800"
            >
              <FontAwesomeIcon icon={faCoins} className="text-amber-600 w-5 h-5" />
              Till Cash & Float
              <span className="ml-auto">
                <FontAwesomeIcon icon={expanded.till ? faChevronDown : faChevronRight} />
              </span>
            </button>
            {expanded.till && (
              <div className="p-5 space-y-4 bg-white">
                <p className="text-sm text-gray-600">
                  Control the Open Till cash entry and Adjust Float access.
                </p>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={settings.adminControls?.openTillCashEntry !== false}
                    onChange={(e) => updateAdminControl('openTillCashEntry', e.target.checked)}
                  />
                  <FontAwesomeIcon icon={faClock} className="text-blue-600 w-4 h-4" />
                  <span className="font-semibold text-gray-700">Open Till Cash Entry</span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={settings.adminControls?.adjustFloat !== false}
                    onChange={(e) => updateAdminControl('adjustFloat', e.target.checked)}
                  />
                  <FontAwesomeIcon icon={faCoins} className="text-emerald-600 w-4 h-4" />
                  <span className="font-semibold text-gray-700">Adjust Float (Add/Remove Cash)</span>
                </label>
              </div>
            )}
          </div>

          {/* Cart Panel Buttons */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('cartButtons')}
              className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 text-left font-semibold text-gray-800"
            >
              <FontAwesomeIcon icon={faShoppingCart} className="text-cyan-600 w-5 h-5" />
              Cart Panel Buttons
              <span className="ml-auto">
                <FontAwesomeIcon icon={expanded.cartButtons ? faChevronDown : faChevronRight} />
              </span>
            </button>
            {expanded.cartButtons && (
              <div className="p-5 space-y-4 bg-white">
                <p className="text-sm text-gray-600">
                  Control which action buttons are visible in the cart panel. Hidden buttons&apos; space is redistributed to visible ones.
                </p>
                {[
                  { key: 'print', label: 'Print', desc: 'Print current order receipt' },
                  { key: 'pettyCash', label: 'Petty Cash', desc: 'Record petty cash withdrawal' },
                  { key: 'adjust', label: 'Adjust Float', desc: 'Add/remove cash from till' },
                  { key: 'delete', label: 'Delete', desc: 'Clear the current cart' },
                  { key: 'hold', label: 'Hold', desc: 'Hold current order for later' },
                  { key: 'pay', label: 'Pay', desc: 'Proceed to payment' },
                ].map((btn) => (
                  <label key={btn.key} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.cartPanelButtons?.[btn.key] !== false}
                      onChange={(e) => updateCartPanelButton(btn.key, e.target.checked)}
                    />
                    <div>
                      <span className="font-semibold text-gray-700">{btn.label}</span>
                      <span className="text-xs text-gray-500 ml-2">{btn.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Layout & Spacing */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('layout')}
              className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 text-left font-semibold text-gray-800"
            >
              <FontAwesomeIcon icon={faRulerCombined} className="text-indigo-600 w-5 h-5" />
              Layout & Spacing
              <span className="ml-auto">
                <FontAwesomeIcon icon={expanded.layout ? faChevronDown : faChevronRight} />
              </span>
            </button>
            {expanded.layout && (
              <div className="p-5 space-y-4 bg-white">
                <p className="text-sm text-gray-600">
                  Adjust the visual spacing and sizing of the entire POS layout.
                </p>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Content Density
                  </label>
                  <select
                    value={settings.layout?.contentDensity || 'comfortable'}
                    onChange={(e) => updateLayoutSetting('contentDensity', e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                  >
                    {DENSITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Sidebar Width
                    </label>
                    <select
                      value={settings.layout?.sidebarWidth || 'standard'}
                      onChange={(e) => updateLayoutSetting('sidebarWidth', e.target.value)}
                      className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                    >
                      {WIDTH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Cart Panel Width
                    </label>
                    <select
                      value={settings.layout?.cartPanelWidth || 'standard'}
                      onChange={(e) => updateLayoutSetting('cartPanelWidth', e.target.value)}
                      className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                    >
                      {WIDTH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Complete Payment Styling */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('payment')}
              className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 text-left font-semibold text-gray-800"
            >
              <FontAwesomeIcon icon={faRulerCombined} className="text-emerald-600 w-5 h-5" />
              Complete Payment Styling
              <span className="ml-auto">
                <FontAwesomeIcon icon={expanded.payment ? faChevronDown : faChevronRight} />
              </span>
            </button>
            {expanded.payment && (
              <div className="p-5 space-y-4 bg-white">
                <p className="text-sm text-gray-600">
                  Control the payment screen scale, text size, and quick amount buttons.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Payment Scale
                    </label>
                    <select
                      value={settings.payment?.scale || 'standard'}
                      onChange={(e) => updatePaymentSetting('scale', e.target.value)}
                      className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                    >
                      {PAYMENT_SCALE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Payment Content Size
                    </label>
                    <select
                      value={settings.payment?.contentSize || 'standard'}
                      onChange={(e) => updatePaymentSetting('contentSize', e.target.value)}
                      className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                    >
                      {PAYMENT_SCALE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Keypad Size
                    </label>
                    <select
                      value={settings.payment?.keypadSize || 'standard'}
                      onChange={(e) => updatePaymentSetting('keypadSize', e.target.value)}
                      className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500"
                    >
                      {PAYMENT_SCALE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Quick Amount Buttons
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[500, 1000, 2000, 5000, 10000, 20000, 50000].map((amount) => (
                      <label key={amount} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={settings.payment?.quickAmounts?.[amount] !== false}
                          onChange={(e) => updateQuickAmount(amount, e.target.checked)}
                        />
                        <span className="text-sm font-semibold text-gray-700">₦{amount >= 1000 ? `${amount / 1000}K` : amount}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={settings.payment?.quickAmounts?.exact !== false}
                        onChange={(e) => updateQuickAmount('exact', e.target.checked)}
                      />
                      <span className="text-sm font-semibold text-gray-700">Exact</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Content Scale */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('system')}
              className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 text-left font-semibold text-gray-800"
            >
              <FontAwesomeIcon icon={faRulerCombined} className="text-cyan-600 w-5 h-5" />
              Content Scale
              <span className="ml-auto">
                <FontAwesomeIcon icon={expanded.system ? faChevronDown : faChevronRight} />
              </span>
            </button>
            {expanded.system && (
              <div className="p-5 space-y-4 bg-white">
                <p className="text-sm text-gray-600">
                  Scale content up or down for screens where resolution can&apos;t be adjusted.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => adjustContentScale(-5)}
                    className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded font-bold"
                  >
                    -5%
                  </button>
                  <input
                    type="range"
                    min={CONTENT_SCALE_MIN}
                    max={CONTENT_SCALE_MAX}
                    step={5}
                    value={Number(settings.system?.contentScale || 100)}
                    onChange={(e) => updateSystemSetting('contentScale', Number(e.target.value))}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => adjustContentScale(5)}
                    className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded font-bold"
                  >
                    +5%
                  </button>
                </div>
                <div className="text-sm font-semibold text-gray-700">
                  Current scale: {Number(settings.system?.contentScale || 100)}%
                </div>
              </div>
            )}
          </div>

          {/* System & Printing */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('systemPrint')}
              className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 text-left font-semibold text-gray-800"
            >
              <FontAwesomeIcon icon={faPrint} className="text-blue-600 w-5 h-5" />
              System &amp; Printing
              <span className="ml-auto">
                <FontAwesomeIcon icon={expanded.systemPrint ? faChevronDown : faChevronRight} />
              </span>
            </button>
            {expanded.systemPrint && (
              <div className="p-5 space-y-6 bg-white">
                {/* Print Preview Toggle */}
                <div>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.system?.showPrintPreview !== false}
                      onChange={(e) => updateSystemSetting('showPrintPreview', e.target.checked)}
                    />
                    <FontAwesomeIcon icon={faEye} className="text-cyan-600 w-4 h-4" />
                    <div>
                      <span className="font-semibold text-gray-700">Show Print Preview Modal</span>
                      <span className="block text-xs text-gray-500">
                        When enabled, a branded preview is shown before printing. When disabled, receipts print silently without any dialog.
                      </span>
                    </div>
                  </label>
                </div>

                {/* Auto Refresh Products Toggle */}
                <div className="border-t border-gray-100 pt-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.system?.autoRefreshProducts !== false}
                      onChange={(e) => updateSystemSetting('autoRefreshProducts', e.target.checked)}
                    />
                    <FontAwesomeIcon icon={faSync} className="text-green-600 w-4 h-4" />
                    <div>
                      <span className="font-semibold text-gray-700">Auto-Refresh Product Quantities</span>
                      <span className="block text-xs text-gray-500">
                        When online with good connection, product quantities refresh automatically after each sale. When offline, quantities update once connection returns.
                      </span>
                    </div>
                  </label>
                </div>

                {/* Open Printer Settings Link */}
                <div className="border-t border-gray-100 pt-4">
                  <button
                    onClick={() => router.push('/printer-settings')}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition flex items-center gap-2"
                  >
                    <FontAwesomeIcon icon={faPrint} className="w-4 h-4" />
                    Open Printer Settings
                  </button>
                  <p className="text-xs text-gray-500 mt-1">Configure thermal printer connection, print method, paper size, and more.</p>
                </div>
              </div>
            )}
          </div>

          {/* Login Page Settings */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('login')}
              className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 text-left font-semibold text-gray-800"
            >
              <FontAwesomeIcon icon={faMapMarkerAlt} className="text-teal-600 w-5 h-5" />
              Login Page Settings
              <span className="ml-auto">
                <FontAwesomeIcon icon={expanded.login ? faChevronDown : faChevronRight} />
              </span>
            </button>
            {expanded.login && (
              <div className="p-5 space-y-6 bg-white">
                {/* Visible Locations */}
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-1">Visible Locations on Login</p>
                  <p className="text-sm text-gray-600 mb-3">
                    Select which locations appear on the login page. If none are selected, all locations are shown.
                  </p>
                  {allLocations.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">No locations found. Connect to the server to load locations.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {allLocations.map((loc) => {
                        const isSelected = (settings.login?.visibleLocationIds || []).includes(loc._id);
                        return (
                          <label
                            key={loc._id}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                              isSelected
                                ? 'border-teal-400 bg-teal-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleLocationVisibility(loc._id)}
                              className="accent-teal-600"
                            />
                            <div>
                              <span className="font-semibold text-gray-800">{loc.name}</span>
                              {loc.address && (
                                <span className="block text-xs text-gray-500">{loc.address}</span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {(settings.login?.visibleLocationIds || []).length > 0 && (
                    <button
                      type="button"
                      onClick={() => updateLoginSetting('visibleLocationIds', [])}
                      className="mt-2 text-sm text-teal-600 hover:text-teal-700 underline"
                    >
                      Clear selection (show all)
                    </button>
                  )}
                </div>

                {/* Exit Button Toggle */}
                <div className="border-t border-gray-100 pt-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.login?.showExitButton !== false}
                      onChange={(e) => updateLoginSetting('showExitButton', e.target.checked)}
                    />
                    <FontAwesomeIcon icon={faSignOutAlt} className="text-red-500 w-4 h-4" />
                    <div>
                      <span className="font-semibold text-gray-700">Show Exit Button</span>
                      <span className="block text-xs text-gray-500">Show or hide the EXIT button on the login page</span>
                    </div>
                  </label>
                </div>

                {/* Clock In/Out Toggle */}
                <div className="border-t border-gray-100 pt-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.login?.showClockInOut !== false}
                      onChange={(e) => updateLoginSetting('showClockInOut', e.target.checked)}
                    />
                    <FontAwesomeIcon icon={faUserClock} className="text-blue-500 w-4 h-4" />
                    <div>
                      <span className="font-semibold text-gray-700">Show Clock In/Out Button</span>
                      <span className="block text-xs text-gray-500">Show or hide the Clock In/Out button on the login page</span>
                    </div>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('summary')}
              className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 text-left font-semibold text-gray-800"
            >
              <FontAwesomeIcon icon={faSlidersH} className="text-slate-600 w-5 h-5" />
              Full Summary
              <span className="ml-auto">
                <FontAwesomeIcon icon={expanded.summary ? faChevronDown : faChevronRight} />
              </span>
            </button>
            {expanded.summary && (
              <div className="p-5 space-y-4 bg-white text-sm text-gray-700">
                <div>
                  <div className="font-semibold text-gray-900 mb-1">Sidebar Sections</div>
                  <div>
                    {summary.sidebar.length > 0 ? summary.sidebar.join(', ') : 'None'}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-gray-900 mb-1">Till Controls</div>
                  <div>{summary.till.join(' | ')}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-900 mb-1">Layout</div>
                  <div>{summary.layout.join(' | ')}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-900 mb-1">Complete Payment</div>
                  <div>{summary.payment.join(' | ')}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-900 mb-1">System</div>
                  <div>{summary.system.join(' | ')}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-900 mb-1">Login Page</div>
                  <div>{summary.login.join(' | ')}</div>
                </div>
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-4 pt-6 border-t border-gray-200">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50 font-semibold"
            >
              {saving ? 'Saving...' : saveLabel}
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition"
            >
              Reset Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
