/**
 * Sidebar Component
 * 
 * Persistent left navigation with accordion menus.
 * - Logo at top
 * - Expandable accordion sections (Admin, Print, Stock, Apps)
 * - Cloud sync status with timestamp
 * - Settings, Support at bottom
 * 
 * Touch-first design: Large buttons, no hover dependency
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Image from 'next/image';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { getStoreLogo } from '../../lib/logoCache';
import {
  faBars,
  faTimes,
  faGear,
  faQuestionCircle,
  faCloud,
  faChevronDown,
  faChevronRight,
  faClock,
  faUndo,
  faFileAlt,
  faTimesCircle,
  faPiggyBank,
  faExchangeAlt,
  faPrint,
  faImage,
  faBox,
  faSyncAlt,
} from '@fortawesome/free-solid-svg-icons';
import { useCart } from '../../context/CartContext';
import { useStaff } from '../../context/StaffContext';
import { checkPrinterAvailable } from '@/src/lib/printerConfig';
import { getUiSettings } from '@/src/lib/uiSettings';
import { hasPosPermission } from '@/src/lib/posPermissions';
import CloseTillModal from './CloseTillModal';
import AdjustFloatModal from './AdjustFloatModal';

const baseMenuSections = [
  {
    id: 'admin',
    label: 'Admin',
    icon: faGear,
    items: [
      { id: 'adjustFloat', label: 'Adjust Float', icon: faClock },
      { id: 'closeTill', label: 'Close Till', icon: faTimesCircle },
      // Hidden for now - showing only core till operations
      // { label: 'Back Office', icon: faFileAlt, hidden: true },
      // { label: 'No Sale', icon: faPiggyBank, hidden: true },
      // { label: 'Petty Cash', icon: faPiggyBank, hidden: true },
      // { label: 'Change Till Location', icon: faExchangeAlt, hidden: true },
    ],
  },
  {
    id: 'print',
    label: 'Print',
    icon: faPrint,
    items: [
      { label: 'Print Current', icon: faPrint },
      { label: 'Print Previous', icon: faPrint },
      { label: 'Print Gift Receipt', icon: faPrint },
      { label: 'Print Historic', icon: faPrint },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    icon: faImage,
    items: [
      { label: 'Stock Count', icon: faImage },
      { label: 'Stock Movement', icon: faImage },
    ],
  },
  {
    id: 'apps',
    label: 'Apps',
    icon: faBox,
    items: [
      { label: 'App Store', icon: faBox },
      { label: 'Manage Apps', icon: faBox },
    ],
  },
];

export default function Sidebar({ isOpen, onToggle, widthClass = 'w-56', mobileWidthClass = 'w-48' }) {
  const router = useRouter();
  const [expandedSections, setExpandedSections] = useState({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [showCloseTillModal, setShowCloseTillModal] = useState(false);
  const [showAdjustFloatModal, setShowAdjustFloatModal] = useState(false);
  const [printerAvailable, setPrinterAvailable] = useState(null);
  const [checkingPrinter, setCheckingPrinter] = useState(false);
  const [uiSettings, setUiSettings] = useState(getUiSettings());
  const { lastSyncTime, isOnline, pendingSyncCount, manualSync } = useCart();
  const { staff, till, setCurrentTill } = useStaff();
  const canAccessSettings = hasPosPermission(staff, 'settingsAccess');
  const canAccessPrinterSettings = hasPosPermission(staff, 'printerSettingsAccess');

  // Derive content scale classes from sidebar width setting
  const sidebarScale = uiSettings.layout?.sidebarWidth || 'standard';
  const scaleClasses = {
    compact: {
      text: 'text-[11px] sm:text-xs',
      heading: 'text-xs sm:text-sm',
      icon: 'w-3.5 h-3.5 sm:w-4 sm:h-4',
      iconLg: 'w-4 h-4 sm:w-5 sm:h-5',
      padding: 'px-2 py-2 sm:px-3 sm:py-2.5',
      paddingLg: 'px-2.5 py-2.5 sm:px-3 sm:py-3',
      gap: 'gap-2',
      logoSize: 32,
    },
    standard: {
      text: 'text-xs sm:text-sm',
      heading: 'text-sm sm:text-base',
      icon: 'w-4 h-4 sm:w-5 sm:h-5',
      iconLg: 'w-5 h-5 sm:w-6 sm:h-6',
      padding: 'px-4 py-3 sm:px-5 sm:py-4',
      paddingLg: 'px-3 py-3 sm:px-4 sm:py-4',
      gap: 'gap-3',
      logoSize: 40,
    },
    wide: {
      text: 'text-sm sm:text-base',
      heading: 'text-base sm:text-lg',
      icon: 'w-5 h-5 sm:w-6 sm:h-6',
      iconLg: 'w-6 h-6 sm:w-7 sm:h-7',
      padding: 'px-5 py-4 sm:px-6 sm:py-5',
      paddingLg: 'px-4 py-4 sm:px-5 sm:py-5',
      gap: 'gap-4',
      logoSize: 48,
    },
  }[sidebarScale] || {
    text: 'text-xs sm:text-sm',
    heading: 'text-sm sm:text-base',
    icon: 'w-4 h-4 sm:w-5 sm:h-5',
    iconLg: 'w-5 h-5 sm:w-6 sm:h-6',
    padding: 'px-4 py-3 sm:px-5 sm:py-4',
    paddingLg: 'px-3 py-3 sm:px-4 sm:py-4',
    gap: 'gap-3',
    logoSize: 40,
  };
  const [effectiveTill, setEffectiveTill] = useState(till || null);

  const [builtInPrinterAvailable, setBuiltInPrinterAvailable] = useState(false);

  // Check printer availability on mount only (not periodically)
  useEffect(() => {
    const checkPrinter = async () => {
      try {
        setCheckingPrinter(true);
        const available = await checkPrinterAvailable();
        setPrinterAvailable(available);

        // Also check for built-in / system printer via browser capability
        const hasBrowserPrint = typeof window !== 'undefined' && typeof window.print === 'function';
        setBuiltInPrinterAvailable(hasBrowserPrint);
      } catch (error) {
        console.warn('Failed to check printer:', error);
        setPrinterAvailable(false);
      } finally {
        setCheckingPrinter(false);
      }
    };

    // Check on mount only - NO periodic checking
    checkPrinter();
    
    return () => {
      // No interval to clear
    };
  }, []);

  useEffect(() => {
    const handleSettingsUpdate = (event) => {
      if (event?.detail) {
        setUiSettings(event.detail);
      } else {
        setUiSettings(getUiSettings());
      }
    };

    handleSettingsUpdate();
    window.addEventListener('uiSettings:updated', handleSettingsUpdate);
    return () => window.removeEventListener('uiSettings:updated', handleSettingsUpdate);
  }, []);

  useEffect(() => {
    if (till) {
      setEffectiveTill(till);
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      const persistedTill = localStorage.getItem('till');
      if (persistedTill) {
        const parsedTill = JSON.parse(persistedTill);
        setEffectiveTill(parsedTill);
        if (!till) {
          setCurrentTill(parsedTill);
        }
        return;
      }
    } catch (error) {
      console.warn('Failed to load persisted till:', error);
    }
    setEffectiveTill(null);
  }, [till, setCurrentTill]);

  const toggleSection = (sectionId) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const result = await manualSync();
      console.log('Manual sync result:', result);

      // After syncing transactions, also refresh store data (logo, products, categories)
      if (isOnline) {
        try {
          // Refresh store logo
          const storeRes = await fetch('/api/store/init-locations');
          if (storeRes.ok) {
            const { store } = await storeRes.json();
            if (store?.logo) {
              const { setStoreLogo } = await import('../../lib/logoCache');
              setStoreLogo(store.logo);
            }
          }

          // Notify MenuScreen to refresh products/categories
          window.dispatchEvent(new CustomEvent('sync:products-refresh'));
        } catch (refreshErr) {
          console.warn('Post-sync refresh failed:', refreshErr);
        }
      }
    } catch (err) {
      console.error('Manual sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenHelp = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('help:open', {
        detail: {
          source: 'sidebar-support',
          topic: 'support',
        },
      })
    );
  };

  const handleOpenPendingTransactions = () => {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent('pos:pending-transactions:open'));

    if (window.innerWidth < 768 && typeof onToggle === 'function') {
      onToggle();
    }
  };

  const formatSyncTime = (isoString) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const menuSections = baseMenuSections
    .filter((section) => {
      if (section.id === 'print') return uiSettings.sidebarSections?.print !== false;
      if (section.id === 'stock') return uiSettings.sidebarSections?.stock !== false;
      if (section.id === 'apps') return uiSettings.sidebarSections?.apps !== false;
      return true;
    })
    .map((section) => {
      if (section.id !== 'admin') return section;
      const allowAdjustFloat =
        uiSettings.adminControls?.adjustFloat !== false && hasPosPermission(staff, 'adjustFloat');
      const allowCloseTill = hasPosPermission(staff, 'closeTill');
      return {
        ...section,
        items: section.items.filter((item) => {
          if (item.id === 'adjustFloat') return allowAdjustFloat;
          if (item.id === 'closeTill') return allowCloseTill;
          return true;
        }),
      };
    });

  const sidebarContent = (
    <div className="flex flex-col h-full bg-gradient-to-b from-neutral-50 to-neutral-100 text-neutral-800 text-xs sm:text-sm">
      {/* Logo Section */}
      <div className="p-3 sm:p-4 bg-white border-b-2 border-primary-200 shadow-sm">
        <div className={`flex items-center ${scaleClasses.gap}`}>
          <Image 
            src={getStoreLogo()} 
            alt="Store Logo" 
            width={scaleClasses.logoSize}
            height={scaleClasses.logoSize}
            className="object-contain rounded-lg"
            onError={(e) => {
              e.target.onerror = null;
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
            unoptimized
          />
          <div className={`${scaleClasses.logoSize === 32 ? 'w-8 h-8' : scaleClasses.logoSize === 48 ? 'w-12 h-12' : 'w-10 h-10'} bg-primary-600 rounded-lg items-center justify-center hidden text-white font-bold text-lg`}>
            SP
          </div>
          <div className="hidden md:block flex-1">
            <div className={`${scaleClasses.heading} font-bold text-neutral-900`}>SalesPOS</div>
            <div className={`${scaleClasses.text} text-primary-600 font-semibold`}>Point of Sale</div>
          </div>
        </div>
      </div>

      {/* Scrollable Menu Sections */}
      <div className="flex-1 overflow-y-auto px-2.5 sm:px-3 py-3 sm:py-4 space-y-2">
        {menuSections.map(section => (
          <div key={section.id} className="rounded-lg bg-white border border-neutral-200 overflow-hidden shadow-sm">
            {/* Section Header */}
            <button
              onClick={() => toggleSection(section.id)}
              className={`w-full flex items-center ${scaleClasses.gap} ${scaleClasses.padding} hover:bg-primary-50 transition-colors duration-base text-left font-semibold text-neutral-800 hover:text-primary-700`}
            >
              <FontAwesomeIcon icon={section.icon} className={`${scaleClasses.iconLg} text-primary-600`} />
              <span className={`${scaleClasses.heading} font-semibold text-neutral-800 flex-1`}>
                {section.label}
              </span>
              <FontAwesomeIcon
                icon={expandedSections[section.id] ? faChevronDown : faChevronRight}
                className={`${scaleClasses.icon} text-primary-600 hidden md:inline`}
              />
            </button>

            {/* Section Items */}
            {expandedSections[section.id] && (
              <div className="bg-neutral-50 border-t border-neutral-200">
                {section.items.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      if (item.label === 'Close Till') {
                        setShowCloseTillModal(true);
                      } else if (item.label === 'Adjust Float') {
                        setShowAdjustFloatModal(true);
                      }
                    }}
                    disabled={(item.label === 'Close Till' || item.label === 'Adjust Float') && !effectiveTill}
                    className={`w-full flex items-center ${scaleClasses.gap} ${scaleClasses.padding} hover:bg-primary-100 border-l-4 border-transparent hover:border-primary-500 text-left font-semibold text-neutral-700 hover:text-primary-700 transition-colors duration-base disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <FontAwesomeIcon icon={item.icon} className={`${scaleClasses.icon} text-primary-500`} />
                    <span className={scaleClasses.heading}>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Bottom Section */}
      <div className="border-t-2 border-neutral-200 bg-white p-3 sm:p-4 space-y-3 sm:space-y-4 shadow-lg">
        {/* Cloud Sync Status */}
        <div className={`${scaleClasses.text} text-neutral-700 p-3 sm:p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border-2 border-blue-200 shadow-sm`}>
          <div className="flex items-center gap-2 mb-2">
            <FontAwesomeIcon
              icon={faCloud}
              className={`${scaleClasses.icon} ${isOnline ? 'text-green-600' : 'text-red-600'}`}
            />
            <span className={`${scaleClasses.text} font-bold ${isOnline ? 'text-green-700' : 'text-red-700'}`}>
              {isOnline ? '● Online' : '● Offline'}
            </span>
          </div>
          <div className={`text-neutral-600 mb-2 ${scaleClasses.text} font-medium`}>
            Last sync: {formatSyncTime(lastSyncTime)}
          </div>
          {pendingSyncCount > 0 && (
            <div className={`text-red-700 font-bold ${scaleClasses.text} mb-2`}>
              ⚠️ {pendingSyncCount} pending transaction{pendingSyncCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        <button
          onClick={handleOpenPendingTransactions}
          className={`w-full flex items-center justify-between gap-2 ${scaleClasses.paddingLg} rounded-lg border border-blue-200 bg-white text-neutral-800 hover:bg-blue-50 transition-colors duration-base ${scaleClasses.heading} font-bold shadow-sm`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <FontAwesomeIcon icon={faFileAlt} className={scaleClasses.icon} />
            <span className="truncate">Unsynced Transactions</span>
          </span>
          <span className={`min-w-[1.75rem] rounded-full px-2 py-0.5 text-[10px] font-bold ${
            pendingSyncCount > 0 ? 'bg-red-100 text-red-700' : 'bg-neutral-200 text-neutral-600'
          }`}>
            {pendingSyncCount}
          </span>
        </button>

        {/* Manual Sync Button */}
        {(pendingSyncCount > 0 || !isOnline) && (
          <button
            onClick={handleManualSync}
            disabled={isSyncing || !isOnline}
            className={`w-full flex items-center justify-center gap-2 ${scaleClasses.paddingLg} bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-neutral-400 disabled:cursor-not-allowed transition-colors duration-base ${scaleClasses.heading} font-bold shadow-md hover:shadow-lg`}
          >
            <FontAwesomeIcon icon={faSyncAlt} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing...' : !isOnline ? 'Offline' : 'Sync Now'}
          </button>
        )}

        {/* Settings & Support */}
        <div className="space-y-2 pt-2">
          {(canAccessSettings || canAccessPrinterSettings) && (
            <div className="flex items-center gap-2">
              {canAccessSettings && (
                <button 
                  onClick={() => {
                    onToggle();
                    router.push('/settings');
                  }}
                  className={`flex-1 flex items-center ${scaleClasses.gap} ${scaleClasses.paddingLg} rounded-lg text-left ${scaleClasses.heading} font-semibold transition-colors duration-base ${
                    router.pathname === '/settings' || router.pathname === '/printer-settings'
                      ? 'bg-primary-100 text-primary-700 shadow-md'
                      : 'text-neutral-700 hover:bg-neutral-100 hover:text-primary-600'
                  }`}
                >
                  <FontAwesomeIcon icon={faGear} className={scaleClasses.icon} />
                  <span className={scaleClasses.heading}>Settings</span>
                </button>
              )}
              {canAccessPrinterSettings && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      onToggle();
                      router.push('/printer-settings');
                    }}
                    title={
                      checkingPrinter
                        ? 'Checking printer...'
                        : printerAvailable === null
                        ? 'Printer status unknown'
                        : printerAvailable
                        ? 'Thermal Printer Connected — Click to open Printer Settings'
                        : builtInPrinterAvailable
                        ? 'System Printer Available (browser print) — Click to open Printer Settings'
                        : 'Thermal Printer Not Connected — Click to open Printer Settings'
                    }
                    className={`relative px-2.5 py-2.5 sm:px-3 sm:py-3 rounded-lg text-sm sm:text-base font-bold shadow-sm transition-colors ${
                      checkingPrinter
                        ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                        : printerAvailable
                        ? 'bg-green-100 text-green-800 border border-green-300 hover:bg-green-200'
                        : builtInPrinterAvailable
                        ? 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                        : 'bg-red-100 text-red-800 border border-red-300 hover:bg-red-200'
                    }`}
                  >
                    <FontAwesomeIcon icon={faPrint} className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${
                      checkingPrinter
                        ? 'bg-yellow-500 animate-pulse'
                        : printerAvailable
                        ? 'bg-green-500 animate-pulse'
                        : builtInPrinterAvailable
                        ? 'bg-blue-500 animate-pulse'
                        : 'bg-red-500'
                    }`} />
                    <span className="sr-only">
                      {checkingPrinter ? 'Checking...' : printerAvailable ? 'Active' : builtInPrinterAvailable ? 'System' : 'Inactive'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={handleOpenHelp}
            className={`w-full flex items-center ${scaleClasses.gap} ${scaleClasses.paddingLg} hover:bg-neutral-100 rounded-lg text-left ${scaleClasses.heading} font-semibold text-neutral-700 hover:text-primary-600 transition-colors duration-base`}
          >
            <FontAwesomeIcon icon={faQuestionCircle} className={scaleClasses.icon} />
            <span className={scaleClasses.heading}>Support</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar - Toggle with hamburger */}
      {isOpen && (
        <aside className={`hidden md:flex flex-col ${widthClass} bg-neutral-100 border-r border-neutral-300 h-screen overflow-y-auto`}>
          {sidebarContent}
        </aside>
      )}

      {/* Mobile Sidebar Overlay */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-30 md:hidden"
            onClick={onToggle}
          />
          <aside className={`fixed left-0 top-0 ${mobileWidthClass} h-screen bg-white z-40 overflow-y-auto md:hidden`}>
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Close Till Modal */}
      <CloseTillModal
        isOpen={showCloseTillModal}
        onClose={() => setShowCloseTillModal(false)}
        onTillClosed={() => {
          setShowCloseTillModal(false);
          // Optionally redirect or refresh
        }}
      />

      {/* Adjust Float Modal */}
      <AdjustFloatModal
        isOpen={showAdjustFloatModal}
        onClose={() => setShowAdjustFloatModal(false)}
      />
    </>
  );
}
