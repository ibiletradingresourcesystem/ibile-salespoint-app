/**
 * TopBar Component
 * 
 * Persistent top navigation showing:
 * - Store name and till info
 * - Date and time (live updated)
 * - Offline mode banner when disconnected
 * - Tab navigation (MENU, CUSTOMERS, ORDERS)
 * - Search and logout icons
 */

import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSignOutAlt,
  faX,
  faWifi,
  faBars,
  faSync,
} from '@fortawesome/free-solid-svg-icons';
import { useCart } from '../../context/CartContext';

export default function TopBar({ activeTab, onTabChange, onLogout, storeData, staffData, onToggleSidebar }) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const { isOnline, pendingSyncCount } = useCart();
  const [apiDown, setApiDown] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let intervalId = null;

    const checkApi = async () => {
      if (!isOnline) {
        setApiDown(false);
        return;
      }
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('/api/transactions', { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.status === 503 || res.status >= 500) {
          setApiDown(true);
        } else {
          setApiDown(false);
        }
      } catch (err) {
        setApiDown(true);
      }
    };

    checkApi();
    intervalId = setInterval(checkApi, 20000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isOnline]);

  const formatDate = (date) => {
    return date.toLocaleDateString('en-NG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-NG', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Get store and staff info from props or defaults
  const storeName = storeData?.name || 'STORE NAME';
  const storeLocation = storeData?.location || 'STORE LOCATION';
  const staffName = staffData?.name || 'Staff';
  const staffRole = staffData?.role || 'Attendant';
  const locationName = staffData?.location?.name || storeLocation || staffData?.locationName;

  return (
    <div className="flex flex-col bg-gradient-to-r from-primary-600 to-primary-700 text-white text-sm sm:text-base">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 flex items-center justify-between gap-2 text-sm font-medium text-white">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faX} className="w-4 h-4" />
            <span>OFFLINE MODE - Changes will sync when online</span>
          </div>
          {pendingSyncCount > 0 && (
            <div className="bg-white text-amber-700 px-3 py-1 rounded-lg font-bold text-xs">
              {pendingSyncCount} pending
            </div>
          )}
        </div>
      )}

      {isOnline && apiDown && (
        <div className="bg-yellow-500 px-4 py-2 flex items-center justify-between gap-2 text-sm font-semibold text-yellow-900">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faSync} className="w-4 h-4" />
            <span>SERVER UNAVAILABLE (503) - Working offline, will sync later</span>
          </div>
        </div>
      )}

      {/* Main Top Bar - Primary Section with Store Info */}
      <div className="px-2.5 py-2 sm:px-3 sm:py-3 flex items-center justify-between gap-2 sm:gap-3">
        {/* Left: Hamburger + Store & Staff Info */}
        <div className="flex items-center gap-3 flex-1">
          {/* Hamburger - Visible only for senior staff */}
          {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 sm:p-2 hover:bg-white/20 rounded transition-colors duration-base touch-manipulation min-h-9 min-w-9 sm:min-h-10 sm:min-w-10"
            title="Toggle menu"
          >
            <FontAwesomeIcon icon={faBars} className="w-5 h-5" />
          </button>
          )}

          {/* Store & Location Info */}
          <div className="flex-1">
            <div className="text-xs sm:text-sm font-semibold">{storeName}</div>
            <div className="text-[10px] sm:text-xs opacity-90">{locationName}</div>
          </div>

          {/* Staff Details */}
          <div className="hidden sm:block border-l border-white/30 pl-3">
            <div className="text-sm font-semibold">{staffName}</div>
            <div className="text-xs opacity-90">{staffRole}</div>
          </div>

          {/* Date & Time */}
          <div className="hidden sm:block border-l border-white/30 pl-3">
            <div className="text-xs opacity-90">{formatDate(currentTime)}</div>
            <div className="text-xs opacity-90">{formatTime(currentTime)}</div>
          </div>
        </div>

        {/* Right: Search & Logout */}
        <div className="flex items-center gap-2">
          {/* Online/Offline Status Indicator */}
          <div className="text-xs flex items-center gap-1.5">
            <FontAwesomeIcon 
              icon={isOnline ? faWifi : faX} 
              className={`w-4 h-4 ${isOnline ? 'text-green-300' : 'text-amber-300'}`}
            />
            {pendingSyncCount > 0 && (
              <span className="bg-primary-400 text-white px-2 py-0.5 rounded-full text-xs font-bold animate-pulse">
                {pendingSyncCount}
              </span>
            )}
          </div>
          <button
            onClick={onLogout}
            className="p-1.5 sm:p-2 hover:bg-white/20 rounded transition-colors duration-base touch-manipulation min-h-9 min-w-9 sm:min-h-10 sm:min-w-10"
            title="Logout or switch user"
          >
            <FontAwesomeIcon icon={faSignOutAlt} className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
