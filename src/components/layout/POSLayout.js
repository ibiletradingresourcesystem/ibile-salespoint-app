/**
 * POSLayout - Main POS Layout
 * 
 * Database-driven layout for professional POS system.
 * Provides: CartProvider, Sidebar, TopBar, Screen content, CartPanel
 * Fetches store, staff, and till information from database.
 */

import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Image from "next/image";
import { useStaff } from "../../context/StaffContext";
import TopBar from "../pos/TopBar";
import TabNavigation from "../pos/TabNavigation";
import Sidebar from "../pos/Sidebar";
import CartPanel from "../pos/CartPanel";
import { CartProvider } from "../../context/CartContext";
import { useErrorHandler } from "../../hooks/useErrorHandler";
import { saveUiSettings } from "@/src/lib/uiSettings";
import { getUiSettings } from "@/src/lib/uiSettings";
import { getStoreLogo, setStoreLogo } from "@/src/lib/logoCache";
import { hasPosPermission } from "@/src/lib/posPermissions";
import { getOptimisticStoreData, primePosBootstrapFromLiveData, readPosBootstrap } from "@/src/lib/posBootstrap";

export default function POSLayout({ children }) {
  const router = useRouter();
  const { staff, location, logout } = useStaff();
  const { handleApiError, forceLoginRedirect } = useErrorHandler();
  const [storeData, setStoreData] = useState(() => getOptimisticStoreData({ location }));
  const [loading, setLoading] = useState(() => !staff);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStep, setLoadingStep] = useState("Initializing...");
  const [activeTab, setActiveTab] = useState("MENU");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uiSettings, setUiSettings] = useState(getUiSettings());

  // Check authentication - redirect to login if not logged in
  useEffect(() => {
    if (!staff) {
      console.log("⚠️ No staff logged in - redirecting to login page");
      router.push("/");
      return;
    }
  }, [staff, router]);

  // Fetch store and till data from database
  useEffect(() => {
    const bootstrap = readPosBootstrap({ location });
    if (bootstrap?.storeData) {
      setStoreData((currentValue) => currentValue || bootstrap.storeData);
    }
    if (bootstrap?.uiSettings) {
      setUiSettings(bootstrap.uiSettings);
    }
    if (staff) {
      setLoading(false);
    }
  }, [location, staff]);

  useEffect(() => {
    const fetchStoreData = async () => {
      const optimisticStoreData = getOptimisticStoreData({ location });

      try {
        if (!optimisticStoreData) {
          setLoadingProgress(0);
          setLoadingStep("Initializing...");
          setLoading(true);
        }
        
        if (!optimisticStoreData) {
          setLoadingProgress(20);
          setLoadingStep("Fetching store data...");
        }
        const response = await fetch("/api/store/init");
        
        // Check for auth errors
        const { ok: isOk, error } = await handleApiError(response, {
          context: 'POSLayout - fetchStoreData',
          showAlert: false
        });
        
        if (!isOk) {
          // If auth error, handleApiError will trigger logout
          // Use cached data or defaults for other errors
          let cachedStore = null;
          try {
            const cachedStoreRaw = localStorage.getItem('cachedStore');
            cachedStore = cachedStoreRaw ? JSON.parse(cachedStoreRaw) : null;
          } catch (err) {
            cachedStore = null;
          }
          setStoreData({
            name: cachedStore?.name || "Store Name",
            logo: getStoreLogo(),
            tillId: "Till_001",
            location: location?.name || "Store Location",
          });
          setLoading(false);
          return;
        }
        
        if (!optimisticStoreData) {
          setLoadingProgress(50);
          setLoadingStep("Processing store information...");
        }
        const data = await response.json();
        const resolvedStoreData = {
          ...data,
          location: location?.name || data?.location,
          address: location?.address || data?.address || "",
          phone: location?.phone || data?.phone || "",
        };
        setStoreData(resolvedStoreData);
        // Cache logo from store data if available
        if (resolvedStoreData.logo) {
          setStoreLogo(resolvedStoreData.logo);
        }
        primePosBootstrapFromLiveData({ staff, location, storeData: resolvedStoreData });
        
        if (!optimisticStoreData) {
          setLoadingProgress(80);
          setLoadingStep("Finalizing...");
        }
      } catch (err) {
        console.error("Failed to fetch store data:", err);
        // Use cached data or defaults if API fails
        let cachedStore = null;
        try {
          const cachedStoreRaw = localStorage.getItem('cachedStore');
          cachedStore = cachedStoreRaw ? JSON.parse(cachedStoreRaw) : null;
        } catch (error) {
          cachedStore = null;
        }
        setStoreData({
          name: cachedStore?.name || "Store Name",
          logo: getStoreLogo(),
          tillId: "Till_001",
          location: location?.name || "Store Location",
        });
      } finally {
        if (!optimisticStoreData) {
          setLoadingProgress(100);
          setLoadingStep("Complete!");
        }
        setLoading(false);
      }
    };

    fetchStoreData();
  }, [handleApiError, location, staff]);

  useEffect(() => {
    const fetchUiSettings = async () => {
      if (!staff?.storeId) return;
      try {
        const res = await fetch(`/api/ui-settings?storeId=${staff.storeId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.settings) {
          saveUiSettings(data.settings);
          primePosBootstrapFromLiveData({ staff, location, storeData, uiSettings: data.settings });
        }
      } catch (err) {
        // Keep local settings if offline
      }
    };

    fetchUiSettings();
  }, [location, staff, storeData]);

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

  const handleLogout = () => {
    localStorage.removeItem('staffMember');
    localStorage.removeItem('staffToken');
    logout();
    router.push("/");
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const canAccessSidebar = hasPosPermission(staff, "sidebarAccess");

  const densityClass = {
    compact: "text-[15px]",
    comfortable: "text-[17px]",
    spacious: "text-[19px]",
  }[uiSettings.layout?.contentDensity || "comfortable"] || "text-[17px]";

  const sidebarWidths = {
    compact: { desktop: "w-48", mobile: "w-40" },
    standard: { desktop: "w-56", mobile: "w-48" },
    wide: { desktop: "w-64", mobile: "w-56" },
  }[uiSettings.layout?.sidebarWidth || "standard"] || { desktop: "w-56", mobile: "w-48" };

  const cartPanelWidthClass = {
    compact: "w-[32%] min-w-[320px]",
    standard: "w-[37%] min-w-[360px]",
    wide: "w-[42%] min-w-[400px]",
  }[uiSettings.layout?.cartPanelWidth || "standard"] || "w-[37%] min-w-[360px]";

  // Show loading screen if not staff is not set yet
  if (!staff && loading === false) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-gradient-to-br from-cyan-600 to-cyan-700 rounded-xl shadow-2xl p-8 text-center w-full max-w-md">
          {/* Logo */}
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg overflow-hidden">
            <Image 
              src={getStoreLogo()} 
              alt="Store Logo" 
              width={90}
              height={90}
              className="object-contain"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = '/images/placeholder.jpg';
              }}
              unoptimized
            />
          </div>

          {/* Loading Text */}
          <p className="text-white font-bold text-lg mb-2">Not Logged In</p>
          <p className="text-cyan-100 text-sm mb-6 font-medium">Redirecting to login page...</p>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="w-full h-2 bg-cyan-900 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-cyan-300 to-green-300 rounded-full animate-pulse shadow-lg"
                style={{ width: '80%' }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-gradient-to-br from-cyan-600 to-cyan-700 rounded-xl shadow-2xl p-8 text-center w-full max-w-md">
          {/* Logo */}
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg overflow-hidden">
            <Image 
              src={getStoreLogo()} 
              alt="Store Logo" 
              width={90}
              height={90}
              className="object-contain"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = '/images/placeholder.jpg';
              }}
              unoptimized
            />
          </div>

          {/* Loading Text */}
          <p className="text-white font-bold text-lg mb-2">Loading POS System</p>
          <p className="text-cyan-100 text-sm mb-6 font-medium">{loadingStep || "Initializing..."}</p>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="w-full h-2 bg-cyan-900 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-cyan-300 to-green-300 rounded-full transition-all duration-300 shadow-lg"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <div className="mt-2 text-cyan-100 text-sm font-semibold">{loadingProgress}%</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CartProvider>
      <div className={`flex h-screen bg-neutral-50 flex-col md:flex-row ${densityClass} pos-mobile-scale`}>
        {/* Left Sidebar - Overlay Mode (senior staff only) */}
        {canAccessSidebar && (
        <div className="fixed inset-y-0 left-0 z-50">
          <Sidebar
            isOpen={sidebarOpen}
            onToggle={toggleSidebar}
            widthClass={sidebarWidths?.desktop}
            mobileWidthClass={sidebarWidths?.mobile}
          />
        </div>
        )}

        {/* Overlay Backdrop */}
        {canAccessSidebar && sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/30 z-40"
            onClick={toggleSidebar}
          />
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden gap-0">
          {/* Left: TopBar + Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top Bar - Store info and staff details */}
            <TopBar 
              onLogout={handleLogout}
              storeData={storeData}
              staffData={{
                ...staff,
                location,
                locationName: location?.name || staff?.locationName || null,
              }}
              onToggleSidebar={canAccessSidebar ? toggleSidebar : undefined}
            />

            {/* Screen content */}
            <div className="flex-1 overflow-auto">
              {React.cloneElement(children, { activeTab, onTabChange: setActiveTab })}
            </div>
          </div>

          {/* Right: TabNavigation + CartPanel - Full Height - 37% Width */}
          <div className={`hidden lg:flex ${cartPanelWidthClass} bg-white flex-col border-l border-neutral-200 overflow-hidden`}>
            {/* Tab Navigation - Screen Switching */}
            <div className="px-3 py-3 flex-shrink-0">
              <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />
            </div>

            {/* Cart Panel - Takes remaining height */}
            <div className="flex-1 overflow-y-auto">
              <CartPanel />
            </div>
          </div>
        </div>

        {/* Mobile: TabNavigation + Cart Panel (Bottom Sheet - Hidden on desktop) */}
        <div className="lg:hidden border-t border-neutral-200 bg-white flex flex-col">
          {/* Tab Navigation */}
          <div className="px-4 py-2 flex-shrink-0 border-b border-neutral-200">
            <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />
          </div>
          
          {/* Cart Panel - Only show on MENU tab to give ORDERS/CUSTOMERS full space */}
          {activeTab === 'MENU' && (
            <div className="max-h-[50vh] min-h-[30vh] overflow-y-auto flex-1">
              <CartPanel />
            </div>
          )}
        </div>
      </div>
    </CartProvider>
  );
}
