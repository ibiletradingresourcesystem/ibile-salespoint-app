import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import Image from "next/image";
import { useStaff } from "../../context/StaffContext";
import OpenTillModal from "../pos/OpenTillModal";
import ClockInOutModal from "../common/ClockInOutModal";
import { syncCategories, syncProducts } from "../../lib/indexedDB";
import { syncPendingTillOpens, syncPendingTillCloses, syncPendingTransactions } from "../../lib/offlineSync";
import { getStoreLogo, setStoreLogo } from "../../lib/logoCache";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClock,
  faQuestionCircle,
  faPowerOff,
  faX,
  faRedo,
  faSync,
} from "@fortawesome/free-solid-svg-icons";
import { normalizeStaffList, normalizeStaffMember } from "@/src/lib/posPermissions";
import { getUiSettings } from "@/src/lib/uiSettings";
import { primePosBootstrapFromCache, primePosBootstrapFromLiveData } from "@/src/lib/posBootstrap";

const normalizeLocationToken = (value) => String(value || "").trim().toLowerCase();

const getLocationId = (location) => String(location?._id || location?.id || "").trim();

const getLocationTokens = (location) => [
  location?._id,
  location?.id,
  location?.name,
  location?.code,
].map(normalizeLocationToken).filter(Boolean);

const getVisibleLocations = (locationList = [], visibleLocationIds = []) => {
  if (!Array.isArray(locationList) || locationList.length === 0) return [];
  if (!Array.isArray(visibleLocationIds) || visibleLocationIds.length === 0) return locationList;

  const visibleTokens = new Set(
    visibleLocationIds
      .flatMap((item) => (item && typeof item === "object" ? getLocationTokens(item) : [normalizeLocationToken(item)]))
      .filter(Boolean)
  );

  if (visibleTokens.size === 0) return locationList;

  const filteredLocations = locationList.filter((location) =>
    getLocationTokens(location).some((token) => visibleTokens.has(token))
  );

  return filteredLocations.length > 0 ? filteredLocations : locationList;
};

const pickLocationId = (locationList = [], preferredId = "") => {
  if (!Array.isArray(locationList) || locationList.length === 0) return "";

  const preferredToken = normalizeLocationToken(preferredId);
  if (preferredToken) {
    const preferredLocation = locationList.find((location) => getLocationTokens(location).includes(preferredToken));
    if (preferredLocation) return getLocationId(preferredLocation);
  }

  return getLocationId(locationList[0]);
};

/**
 * Professional POS Login Page
 * Matches modern POS system design with:
 * - Store/Location selection (left side)
 * - PIN/Passcode entry (right side)
 * - Real-time clock and status
 */
export default function StaffLogin() {
  const router = useRouter();
  const { login, setCurrentTill, setCachedTenders } = useStaff();

  const [stores, setStores] = useState([]);
  const [locations, setLocations] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedStaff, setSelectedStaff] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStep, setLoadingStep] = useState("");
  const [error, setError] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [currentTime, setCurrentTime] = useState("");
  const [hasPendingTransactions, setHasPendingTransactions] = useState(true);
  const [currentTillDisplay, setCurrentTillDisplay] = useState("TILL 1"); // Display only
  const [showOpenTillModal, setShowOpenTillModal] = useState(false);
  const [loginData, setLoginData] = useState(null); // Store login data to use after till opens
  const [activeTills, setActiveTills] = useState([]); // Track active open tills by location
  const [pendingTillCloseIds, setPendingTillCloseIds] = useState([]);
  const [syncingPendingCloses, setSyncingPendingCloses] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [showClockModal, setShowClockModal] = useState(false);
  const [resumeTill, setResumeTill] = useState(null); // Till awaiting PIN to resume
  const [loginSettings, setLoginSettings] = useState(() => {
    const ui = getUiSettings();
    return ui.login || {};
  });

  const isRestrictedStaffRole = useCallback((role) => {
    const normalized = String(role || "").trim().toLowerCase();
    return normalized === "staff" || normalized === "lower staff";
  }, []);

  const isNonAdminRole = useCallback((role) => {
    const normalized = String(role || "").trim().toLowerCase();
    return normalized !== "admin";
  }, []);

  const resolveStaffLocationId = useCallback((member) => {
    if (!member) return "";
    const directId = member.locationId?.toString?.() || member.locationId || "";
    const directLocation = directId
      ? locations.find((loc) => getLocationTokens(loc).includes(normalizeLocationToken(directId)))
      : null;
    if (directLocation) {
      return getLocationId(directLocation);
    }

    if (member.locationName) {
      const matched = locations.find((loc) => loc.name === member.locationName);
      if (matched?._id) return String(matched._id);
    }

    if (member.location) {
      const matched = locations.find(
        (loc) => String(loc._id) === String(member.location) || loc.name === member.location
      );
      if (matched?._id) return String(matched._id);
    }

    return "";
  }, [locations]);

  const runWithTimeout = async (promise, ms = 8000) => {
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ timedOut: true }), ms);
    });
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timeoutId);
    return result;
  };

  const openHelpChat = useCallback((topic = "login") => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("help:open", {
        detail: {
          source: "staff-login",
          topic,
        },
      })
    );
  }, []);

  const getLoginErrorMessage = useCallback((statusCode, payload = {}) => {
    const code = payload?.code;
    if (code === "INVALID_CREDENTIALS") {
      return "Incorrect passcode for selected staff. Please try again.";
    }
    if (code === "STAFF_NOT_FOUND") {
      return "Selected staff account was not found. Refresh data and try again.";
    }
    if (code === "STAFF_INACTIVE") {
      return "This staff account is inactive. Contact an admin.";
    }
    if (code === "LOCATION_NOT_FOUND") {
      return "Selected location is unavailable. Refresh locations and retry.";
    }
    if (code === "LOCATION_INACTIVE") {
      return "Selected location is inactive. Choose another location.";
    }
    if (code === "INVALID_PIN_FORMAT") {
      return "Passcode must be exactly 4 digits.";
    }
    if (statusCode >= 500) {
      return "Login service is unavailable. You can continue in offline mode if data is cached.";
    }
    return payload?.message || "Unable to log in. Please check your details and try again.";
  }, []);

  const preloadPosShell = useCallback(async (staffData, locationData) => {
    const normalizedStaffData = normalizeStaffMember(staffData);
    primePosBootstrapFromCache({ staff: normalizedStaffData, location: locationData });

    try {
      const settingsRequest = normalizedStaffData?.storeId
        ? fetch(`/api/ui-settings?storeId=${encodeURIComponent(normalizedStaffData.storeId)}`)
        : Promise.resolve(null);

      const [storeResult, settingsResult] = await Promise.allSettled([
        fetch("/api/store/init"),
        settingsRequest,
      ]);

      let storeData = null;
      let uiSettings = null;

      if (storeResult.status === "fulfilled" && storeResult.value?.ok) {
        const liveStoreData = await storeResult.value.json();
        storeData = {
          ...liveStoreData,
          location: locationData?.name || liveStoreData?.location,
          address: locationData?.address || liveStoreData?.address || "",
          phone: locationData?.phone || liveStoreData?.phone || "",
        };
      }

      if (settingsResult.status === "fulfilled" && settingsResult.value?.ok) {
        const settingsPayload = await settingsResult.value.json();
        uiSettings = settingsPayload?.settings || null;
      }

      primePosBootstrapFromLiveData({
        staff: normalizedStaffData,
        location: locationData,
        storeData,
        uiSettings,
      });
    } catch (error) {
      primePosBootstrapFromCache({ staff: normalizedStaffData, location: locationData });
    }
  }, []);

  /* Load cached staff and locations from localStorage */
  const loadCachedData = useCallback(() => {
    try {
      const cachedStaff = localStorage.getItem('cachedStaff');
      const cachedLocations = localStorage.getItem('cachedLocations');
      const cachedLocationsMetadata = localStorage.getItem('locations_metadata');
      const cachedStore = localStorage.getItem('cachedStore');

      // Load cached store first
      if (cachedStore) {
        const storeObj = JSON.parse(cachedStore);
        setStores([storeObj]);
        setSelectedStore(storeObj._id);
        console.log(`✅ Loaded store from cache: ${storeObj.name}`);
      } else {
        // Create a default store for offline mode if none cached
        const defaultStore = { _id: 'offline-store', name: 'Offline Store' };
        setStores([defaultStore]);
        setSelectedStore(defaultStore._id);
        console.log(`📦 Using default offline store`);
      }

      if (cachedStaff) {
        const staffArray = normalizeStaffList(JSON.parse(cachedStaff));
        setStaff(staffArray);
        console.log(`✅ Loaded ${staffArray.length} staff from cache`);
      }

      if (cachedLocations) {
        const locationsArray = JSON.parse(cachedLocations);
        setLocations(locationsArray);
        if (locationsArray.length > 0) {
          setSelectedLocation((currentLocation) => pickLocationId(locationsArray, currentLocation));
        }
        console.log(`✅ Loaded ${locationsArray.length} locations from cache`);
        console.log(`📍 Locations available offline: ${locationsArray.map(l => l.name).join(', ')}`);
      } else {
        console.log(`⚠️ No cached locations found. Please sync when online.`);
      }

      // Log metadata about cached data
      if (cachedLocationsMetadata) {
        try {
          const metadata = JSON.parse(cachedLocationsMetadata);
          console.log(`⏱️ Locations last synced: ${new Date(metadata.lastSynced).toLocaleString()}`);
        } catch (e) {
          console.warn("Could not parse metadata:", e);
        }
      }
    } catch (error) {
      console.error("Failed to load cached data:", error);
    }
  }, []);

  const preloadTendersForLocations = useCallback(async (locationsList = []) => {
    if (!Array.isArray(locationsList) || locationsList.length === 0) return;

    await Promise.all(
      locationsList.map(async (loc) => {
        if (!loc?._id) return;
        try {
          const tendersRes = await fetch('/api/location/tenders?locationId=' + loc._id);
          if (!tendersRes.ok) return;
          const tendersData = await tendersRes.json();
          if (tendersData?.success) {
            setCachedTenders(loc._id, tendersData.tenders || []);
          }
        } catch (err) {
          // ignore tender preload errors
        }
      })
    );
  }, [setCachedTenders]);

  const cacheCategoriesForOffline = useCallback(async () => {
    const categoriesResponse = await fetch('/api/categories');
    if (!categoriesResponse.ok) {
      throw new Error(`Failed to sync categories: ${categoriesResponse.status}`);
    }

    const categoriesData = await categoriesResponse.json();
    const categories = categoriesData.data || [];
    await syncCategories(categories);
    localStorage.setItem('cachedCategories', JSON.stringify(categories));
    console.log(`✅ Cached ${categories.length} categories for offline`);
    return categories;
  }, []);

  const cacheProductsForLocations = useCallback(async (locationsList = []) => {
    if (!Array.isArray(locationsList) || locationsList.length === 0) {
      await syncProducts([], { replace: true });
      localStorage.removeItem('cachedProducts');
      return [];
    }

    const productGroups = await Promise.all(
      locationsList
        .filter((loc) => loc?._id)
        .map(async (loc) => {
          try {
            const productsResponse = await fetch(`/api/products?locationId=${encodeURIComponent(loc._id)}`);
            if (!productsResponse.ok) {
              console.warn(`⚠️ Could not sync products for ${loc.name}: ${productsResponse.status}`);
              return [];
            }

            const productsData = await productsResponse.json();
            const products = productsData.data || [];
            console.log(`✅ Synced ${products.length} products for ${loc.name}`);
            return products;
          } catch (prodErr) {
            console.warn(`⚠️ Could not sync products for ${loc?.name || loc?._id}:`, prodErr.message);
            return [];
          }
        })
    );

    const productMap = new Map();
    productGroups.flat().forEach((product) => {
      if (product?._id) {
        productMap.set(String(product._id), product);
      }
    });

    const products = Array.from(productMap.values());
    await syncProducts(products, { replace: true });

    if (products.length > 0) {
      localStorage.setItem('cachedProducts', JSON.stringify(products));
    } else {
      localStorage.removeItem('cachedProducts');
    }

    console.log(`✅ Cached ${products.length} location-scoped products for offline`);
    return products;
  }, []);

  // Get closed till IDs from IndexedDB
  // includeSynced=false: only unsynced (for banner display)
  // includeSynced=true: all closes (for resume-prevention check)
  const getPendingTillCloseIds = useCallback(async (includeSynced = false) => {
    try {
      const request = indexedDB.open('SalesPOS', 3);
      return await new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('till_closes')) {
            resolve([]);
            return;
          }
          const tx = db.transaction(['till_closes', 'till_opens'], 'readonly');
          const store = tx.objectStore('till_closes');
          const opensStore = tx.objectStore('till_opens');
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const closes = getAll.result || [];
            // Filter based on whether we want all closes or only unsynced
            const filteredCloses = includeSynced
              ? closes.filter(close => close && close._id)
              : closes.filter(close => close && close._id && close.synced !== true);
            const closeIds = filteredCloses.map(close => String(close._id));
            const mapPromises = closeIds.map((id) => new Promise((res) => {
              if (!id.startsWith('offline-till-')) return res(null);
              const openReq = opensStore.get(id);
              openReq.onsuccess = () => {
                res(openReq.result?.serverTillId ? String(openReq.result.serverTillId) : null);
              };
              openReq.onerror = () => res(null);
            }));
            Promise.all(mapPromises).then((mapped) => {
              const combined = new Set(closeIds);
              mapped.filter(Boolean).forEach(id => combined.add(id));
              resolve([...combined]);
            });
          };
          getAll.onerror = () => reject(getAll.error);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('Failed to read pending till closes:', err);
      return [];
    }
  }, []);

  const refreshPendingTillCloseIds = useCallback(async () => {
    // For the banner, only show unsynced closes
    const ids = await getPendingTillCloseIds(false);
    setPendingTillCloseIds(ids);
    return ids;
  }, [getPendingTillCloseIds]);

  const handleSyncPendingCloses = async () => {
    if (!isOnline || syncingPendingCloses) return;
    setSyncingPendingCloses(true);
    try {
      await runWithTimeout(
        (async () => {
          await syncPendingTillOpens();
          await syncPendingTransactions();
          await syncPendingTillCloses();
        })(),
        12000
      );
      await refreshPendingTillCloseIds();
    } catch (err) {
      console.warn('⚠️ Pending close sync failed:', err?.message || err);
    } finally {
      setSyncingPendingCloses(false);
    }
  };

  /* Track time */
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const date = now.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      setCurrentTime(`${currentTillDisplay} - ${date} - ${hours}:${minutes}`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [currentTillDisplay]);

  /* Track online/offline status */
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  /* Fetch stores/locations and staff */
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoadingData(true);
        setLoadingProgress(0);
        setLoadingStep("Initializing...");
        console.log("🔄 [LOGIN] Starting data fetch...");
        
        // If offline, load from cache immediately
        if (!navigator.onLine) {
          console.log("📱 OFFLINE MODE - Loading cached data...");
          setLoadingProgress(50);
          setLoadingStep("Loading cached data...");
          loadCachedData();
          
          // Load saved till as active till for offline display
          try {
            const savedTill = localStorage.getItem("till");
            if (savedTill) {
              const till = JSON.parse(savedTill);
              if (till && till._id) {
                // Use includeSynced=true to check ALL closes (not just unsynced)
                const closedTillIds = await getPendingTillCloseIds(true);
                const isPendingClosed = closedTillIds.includes(String(till._id));
                if (!isPendingClosed) {
                  // Compute actual sales from IndexedDB transactions
                  try {
                    const { getOfflineTillSales } = await import('../../lib/offlineSync');
                    const offlineSales = await getOfflineTillSales(till._id);
                    till.totalSales = offlineSales.totalSales || till.totalSales || 0;
                    till.transactionCount = offlineSales.transactionCount || till.transactionCount || 0;
                  } catch (e) {
                    console.warn('⚠️ Could not compute offline sales:', e);
                  }
                  console.log("📋 Showing saved open till in offline mode:", till._id, "Sales:", till.totalSales);
                  setActiveTills([till]);
                } else {
                  console.log("📋 Saved till is pending close, not showing as active");
                  setActiveTills([]);
                }
              }
            }
          } catch (err) {
            console.warn("⚠️ Could not load offline till for display:", err);
          }
          
          setLoadingProgress(100);
          setLoadingStep("Complete!");
          setLoadingData(false);
          return;
        }
        
        // Step 1: Fetch store and locations
        setLoadingProgress(15);
        setLoadingStep("Fetching stores and locations...");
        console.log("🔄 [LOGIN] Fetching store and locations...");
        const response = await fetch("/api/store/init-locations");
        console.log(`📡 [LOGIN] Store API response status: ${response.status}`);
        
        if (response.ok) {
          const data = await response.json();
          console.log("📦 [LOGIN] Store API response data:", data);
          
          // Store is returned as an object with locations array
          if (data.store) {
            console.log(`✅ [LOGIN] Store found: "${data.store.storeName}"`);
            const storeObj = {
              _id: data.store._id,
              name: data.store.storeName || data.store.companyName || "Default Store",
            };
            setStores([storeObj]);
            setSelectedStore(storeObj._id);
            // Cache store for offline use
            localStorage.setItem('cachedStore', JSON.stringify(storeObj));
            // Cache store logo permanently
            if (data.store.logo) {
              setStoreLogo(data.store.logo);
            }
            
            // Set locations from store
            if (Array.isArray(data.store.locations)) {
              const activeLocations = data.store.locations.filter(loc => loc.isActive !== false);
              console.log(`✅ [LOGIN] Found ${activeLocations.length} active locations:`, activeLocations.map(l => l.name));
              setLocations(activeLocations);
              // Cache locations for offline use
              localStorage.setItem('cachedLocations', JSON.stringify(activeLocations));
              // Store metadata about when locations were synced
              localStorage.setItem('locations_metadata', JSON.stringify({
                lastSynced: new Date().toISOString(),
                count: activeLocations.length,
                locationNames: activeLocations.map(l => l.name)
              }));
              console.log(`💾 Locations cached for offline access (${activeLocations.length} locations)`);
              preloadTendersForLocations(activeLocations);
              // Auto-select first location
              if (activeLocations.length > 0) {
                setSelectedLocation((currentLocation) => pickLocationId(activeLocations, currentLocation));
              }
            }
          }
        } else {
          console.error(`❌ [LOGIN] Store API error: ${response.status}`);
        }
        
        // Step 2: Fetch staff members
        setLoadingProgress(35);
        setLoadingStep("Fetching staff members...");
        console.log("🔄 [LOGIN] Fetching staff members...");
        const staffResponse = await fetch("/api/staff/list");
        console.log(`📡 [LOGIN] Staff API response status: ${staffResponse.status}`);
        
        if (staffResponse.ok) {
          const staffData = await staffResponse.json();
          console.log("📦 [LOGIN] Staff API response data:", staffData);
          
          // API returns { success: true, count: X, data: [...] }
          const staffList = staffData.data || staffData || [];
          const staffArray = normalizeStaffList(Array.isArray(staffList) ? staffList : []);
          console.log(`✅ [LOGIN] Found ${staffArray.length} staff members:`, staffArray.map(s => ({ name: s.name, role: s.role })));
          
          setStaff(staffArray);
          // Cache staff for offline use
          localStorage.setItem('cachedStaff', JSON.stringify(staffArray));
          console.log(`✅ [LOGIN] Cached ${staffArray.length} staff members`);
        } else {
          console.error(`❌ [LOGIN] Staff API error: ${staffResponse.status}`);
        }

        // Pre-cache categories for offline use
        setLoadingProgress(50);
        setLoadingStep("Pre-caching categories...");
        console.log("📦 Pre-caching categories for offline use...");
        try {
          await cacheCategoriesForOffline();
        } catch (catErr) {
          console.warn("⚠️ Could not pre-cache categories:", catErr.message);
        }

        // Keep initial login light. Products are synced per location when needed.
        setLoadingProgress(60);
        setLoadingStep("Preparing location data...");
        console.log("📦 Skipping global product preload. Products will sync per location when needed.");

        // Try to sync any pending offline data before showing active tills
        setLoadingProgress(75);
        setLoadingStep("Syncing pending data...");
        try {
          await runWithTimeout(
            (async () => {
              await syncPendingTillOpens();
              await syncPendingTransactions();
              await syncPendingTillCloses();
            })(),
            12000
          );
        } catch (syncErr) {
          console.warn('⚠️ Login preload sync failed:', syncErr?.message || syncErr);
        }

        // Fetch active open tills for all locations
        setLoadingProgress(85);
        setLoadingStep("Fetching active tills...");
        const tillsResponse = await fetch("/api/till/active");
        if (tillsResponse.ok) {
          const tillsData = await tillsResponse.json();
          console.log("📋 Active tills fetched:", tillsData);
          const pendingCloseIds = await refreshPendingTillCloseIds();
          const tillsList = Array.isArray(tillsData.tills) ? tillsData.tills : [];
          const filtered = pendingCloseIds.length
            ? tillsList.filter(till => !pendingCloseIds.includes(String(till?._id)))
            : tillsList;
          setActiveTills(filtered);
        } else {
          console.log("ℹ️ No active tills endpoint or no open tills");
          setActiveTills([]);
        }

        setLoadingProgress(100);
        setLoadingStep("Complete!");

      } catch (error) {
        console.error("Failed to fetch data:", error);
        // Load from cache on error
        console.log("📦 Loading cached data due to fetch error...");
        loadCachedData();
      } finally {
        setLoadingData(false);
      }
    };

    fetchData();
  }, [cacheCategoriesForOffline, loadCachedData, preloadTendersForLocations, refreshPendingTillCloseIds, getPendingTillCloseIds]);

  /* Refresh staff/locations data when coming online */
  useEffect(() => {
    if (isOnline) {
      console.log("🌐 Online detected - refreshing staff and location data");
      const fetchData = async () => {
        try {
          // Fetch staff
          const staffResponse = await fetch("/api/staff/list");
          if (staffResponse.ok) {
            const staffData = await staffResponse.json();
            const staffList = staffData.data || staffData || [];
            const staffArray = normalizeStaffList(Array.isArray(staffList) ? staffList : []);
            setStaff(staffArray);
            console.log(`✅ Refreshed staff data: ${staffArray.length} members`);
          }

          // Fetch locations
          const locResponse = await fetch("/api/store/init-locations");
          if (locResponse.ok) {
            const locData = await locResponse.json();
            if (locData.store && Array.isArray(locData.store.locations)) {
              const refreshedLocations = locData.store.locations.filter(loc => loc.isActive !== false);
              setLocations(refreshedLocations);
              setSelectedLocation((currentLocation) => pickLocationId(refreshedLocations, currentLocation));
              localStorage.setItem('cachedLocations', JSON.stringify(refreshedLocations));
              console.log(`✅ Refreshed locations data: ${locData.store.locations.length} locations`);
            }
          }
        } catch (error) {
          console.error("Failed to refresh data:", error);
        }
      };

      fetchData();
    }
  }, [isOnline]);

  const attemptOfflineLogin = useCallback(async (reason) => {
    console.log(`📱 OFFLINE LOGIN - ${reason}`);
    console.log(`   Available locations from cache: ${locations.map(l => l.name).join(', ')}`);
    console.log(`   Available staff from cache: ${staff.map(s => s.name).join(', ')}`);

    const selectedStaffData = normalizeStaffMember(staff.find(s => s._id === selectedStaff));
    const selectedLocationData = locations.find(loc => loc._id === selectedLocation);

    if (!selectedStaffData || !selectedLocationData) {
      const missingItem = !selectedStaffData ? 'Staff' : 'Location';
      console.error(`❌ ${missingItem} not found in local cached data`);
      setError(`${missingItem} data not available offline. Please sync with server when online.`);
      return false;
    }

    console.log("✅ Login successful (OFFLINE MODE)!");
    console.log("📍 Staff:", selectedStaffData.name, "Location:", selectedLocationData.name);
    console.log("⚠️ NOTE: Running in OFFLINE mode - PIN validation skipped");

    void preloadPosShell(selectedStaffData, selectedLocationData);

    // Offline: check if there's an existing open till to resume
    const savedTill = localStorage.getItem("till");
    if (savedTill) {
      // Use includeSynced=true to check ALL closes (not just unsynced)
      const closedTillIds = await getPendingTillCloseIds(true);
      const till = JSON.parse(savedTill);
      const isPendingClosed = closedTillIds.includes(String(till?._id));
      if (isPendingClosed) {
        // Till was closed offline, remove it and open a new one
        console.log("📴 Saved till was closed offline (pending sync), opening new till");
        localStorage.removeItem("till");
      } else if (till && till._id && till.locationId === selectedLocationData._id) {
        // Till is still open and matches selected location - resume it
        console.log("✅ Resuming existing open till offline:", till._id);
        login(selectedStaffData, selectedLocationData);
        setCurrentTill(till);
        router.push("/");
        return true;
      } else if (till && till._id) {
        // Till exists but for a different location - resume it anyway (till belongs to location)
        console.log("✅ Resuming existing open till (different location) offline:", till._id);
        login(selectedStaffData, selectedLocationData);
        setCurrentTill(till);
        router.push("/");
        return true;
      }
    }

    // No existing open till - show OpenTillModal to create one
    setLoginData({ staff: selectedStaffData, location: selectedLocationData });
    setShowOpenTillModal(true);
    return true;
  }, [locations, staff, selectedStaff, selectedLocation, login, setCurrentTill, router, setError, getPendingTillCloseIds, preloadPosShell]);

  const handleLogin = useCallback(async () => {
    if (!selectedStore || !selectedLocation || !selectedStaff || pin.length !== 4) {
      setError("Please select store, location, staff, and enter 4-digit passcode");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const loginPayload = {
        store: selectedStore,
        location: selectedLocation,
        staff: selectedStaff,
        pin: pin,
      };

      console.log("🔐 Sending login request:", loginPayload);

      // Try to login online first
      if (isOnline) {
        const response = await fetch("/api/staff/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(loginPayload),
        });

        console.log("📨 Login response status:", response.status);
        let data = {};
        try {
          data = await response.json();
        } catch (parseError) {
          data = {};
        }
        console.log("📨 Login response data:", data);

        if (response.ok && data?.staff && data?.location) {
          console.log("✅ Login successful (ONLINE)!");
          console.log("📍 Staff:", data.staff?.name, "Location:", data.location?.name);
          const normalizedStaffData = normalizeStaffMember(data.staff);
          void preloadPosShell(normalizedStaffData, data.location);
          
          // Sync pending offline till/transactions before checking current till
          try {
            await syncPendingTillOpens();
            await syncPendingTransactions();
            await syncPendingTillCloses();
          } catch (err) {
            console.warn('⚠️ Sync before till check failed:', err?.message || err);
          }

          // Check if till is already open for this location
          console.log("🔍 Checking for existing open till for location:", selectedLocation);
          const tillCheckResponse = await fetch(
            `/api/till/current?locationId=${selectedLocation}`
          );
          
          if (tillCheckResponse.ok) {
            // Till is already open, retrieve it and proceed to POS
            const tillData = await tillCheckResponse.json();
            console.log("✅ Existing till found - Till ID:", tillData.till?._id);
            console.log("   Till Status:", tillData.till?.status);
            console.log("   Opening Balance:", tillData.till?.openingBalance);
            
            login(normalizedStaffData, data.location);
            setCurrentTill(tillData.till);
            router.push("/");
          } else {
            // No open till, show OpenTillModal
            console.log("❌ No open till found - showing OpenTillModal");
            setLoginData({ staff: normalizedStaffData, location: data.location });
            setShowOpenTillModal(true);
          }
        } else {
          console.error("Login failed:", data?.message || response.statusText);
          if (!navigator.onLine && await attemptOfflineLogin("Connection lost during login")) {
            return;
          }
          if (response.status >= 500 && await attemptOfflineLogin("Server unavailable")) {
            return;
          }
          if (data?.code === "INVALID_CREDENTIALS") {
            setPin("");
          }
          setError(getLoginErrorMessage(response.status, data));
        }
      } else {
        // OFFLINE MODE - Use cached staff and till data
        if (await attemptOfflineLogin("Offline mode")) {
          return;
        }
      }
    } catch (error) {
      console.error("❌ Login error:", error);

      if (await attemptOfflineLogin("Network error")) {
        return;
      }

      setError("Login failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [selectedStore, selectedLocation, selectedStaff, pin, isOnline, login, setCurrentTill, router, attemptOfflineLogin, getLoginErrorMessage, preloadPosShell]);

  const handlePinClick = (digit) => {
    if (pin.length < 4) {
      setPin(pin + digit);
    }
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
  };

  const handleTillOpened = (till) => {
    // Till has been opened, now proceed to POS
    if (loginData) {
      console.log("📋 Till opened, storing till in context:", till);
      login(loginData.staff, loginData.location);
      void preloadPosShell(loginData.staff, loginData.location);
      
      // IMPORTANT: Set the till in context so it's available throughout the app
      setCurrentTill(till);
      
      router.push("/");
    }
  };

  const handleResumeRequest = (till) => {
    // Set the till to resume and pre-select the staff member so user can enter PIN
    const tillStaffId = String(till?.staffId || "");
    const tillLocationId = String(till?.locationId || "");

    setResumeTill(till);
    setSelectedStaff(tillStaffId);

    const loc = locations.find(
      (locationItem) => String(locationItem?._id || locationItem?.id || "") === tillLocationId
    );
    if (loc?._id || loc?.id) {
      setSelectedLocation(String(loc._id || loc.id));
    } else if (tillLocationId) {
      setSelectedLocation(tillLocationId);
    }

    setPin("");
    setError("");
  };

  const handleQuickLogin = useCallback(async (till) => {
    // Resume an existing till after PIN verification
    try {
      setLoading(true);
      setError("");

      const tillStaffId = String(till?.staffId || "");
      const tillLocationId = String(till?.locationId || "");
      const tillStoreId = String(till?.storeId || selectedStore || "");

      console.log("🚀 Quick login to existing till:", till);
      console.log("   Looking for staff ID:", tillStaffId);
      console.log("   Looking for location ID:", tillLocationId);

      // Find the staff and location data from the till
      let staffMember = staff.find(
        (staffItem) => String(staffItem?._id || staffItem?.id || "") === tillStaffId
      );
      let location = locations.find(
        (locationItem) => String(locationItem?._id || locationItem?.id || "") === tillLocationId
      );

      // If not found in local data, refresh and try again
      if (!staffMember || !location) {
        console.log("⚠️ Staff or location not found in local data - refreshing...");
        
        // Refresh staff data
        const staffResponse = await fetch("/api/staff/list");
        if (staffResponse.ok) {
          const staffData = await staffResponse.json();
          const staffList = staffData.data || staffData || [];
          const refreshedStaff = normalizeStaffList(Array.isArray(staffList) ? staffList : []);
          setStaff(refreshedStaff);
          staffMember = refreshedStaff.find(
            (staffItem) => String(staffItem?._id || staffItem?.id || "") === tillStaffId
          );
        }

        // Refresh locations data
        const locResponse = await fetch("/api/store/init-locations");
        if (locResponse.ok) {
          const locData = await locResponse.json();
          if (locData.store && Array.isArray(locData.store.locations)) {
            const allLocations = locData.store.locations;
            const refreshedLocations = allLocations.filter(loc => loc.isActive !== false);
            setLocations(refreshedLocations);
            location = allLocations.find(
              (locationItem) => String(locationItem?._id || locationItem?.id || "") === tillLocationId
            ) || allLocations.find(
              (locationItem) => String(locationItem?.name || "").trim().toLowerCase() === String(till?.locationName || "").trim().toLowerCase()
            );
          }
        }
      }

      if (!location && tillLocationId) {
        location = {
          _id: tillLocationId,
          name: till.locationName || "Unknown Location",
        };
      }

      if (!staffMember || !location) {
        console.error("❌ Could not find staff or location even after refresh");
        setError("Could not find staff or location for this till. Please log in normally.");
        setResumeTill(null);
        return;
      }

      // Verify PIN online before resuming
      if (isOnline) {
        const response = await fetch("/api/staff/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store: tillStoreId,
            staff: staffMember._id,
            pin: pin,
          }),
        });

        if (!response.ok) {
          let data = {};
          try { data = await response.json(); } catch (e) {}
          setPin("");
          setError(data?.message || "Incorrect passcode. Please try again.");
          return;
        }
      }

      console.log("✅ Found staff:", staffMember.name, "and location:", location.name);

      // Ensure resumed session reflects the till's actual location
      const sessionStaff = normalizeStaffMember({
        ...staffMember,
        locationId: location?._id || tillLocationId,
        locationName: location?.name || till.locationName || staffMember?.locationName,
      });

      void preloadPosShell(sessionStaff, location);

      login(sessionStaff, location);
      setCurrentTill(till);
      setResumeTill(null);
      
      console.log("✅ Quick login successful! Proceeding to POS");
      router.push("/");
    } catch (error) {
      console.error("❌ Quick login error:", error);
      setError("Failed to resume till. Please log in normally.");
    } finally {
      setLoading(false);
    }
  }, [staff, locations, isOnline, selectedStore, pin, login, setCurrentTill, router, preloadPosShell]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === "Enter" && pin.length === 4 && selectedStore && selectedLocation && selectedStaff) {
      if (resumeTill) {
        handleQuickLogin(resumeTill);
      } else {
        handleLogin();
      }
    }
  }, [pin, selectedStore, selectedLocation, selectedStaff, handleLogin, resumeTill, handleQuickLogin]);

  useEffect(() => {
    window.addEventListener("keypress", handleKeyPress);
    return () => window.removeEventListener("keypress", handleKeyPress);
  }, [handleKeyPress]);

  useEffect(() => {
    if (!selectedStaff) return;
    const member = staff.find((item) => String(item._id) === String(selectedStaff));
    if (!member || !isNonAdminRole(member.role)) return;

    const assignedLocationId = resolveStaffLocationId(member);
    if (assignedLocationId && assignedLocationId !== selectedLocation) {
      setSelectedLocation(assignedLocationId);
    }
  }, [selectedStaff, staff, selectedLocation, isNonAdminRole, resolveStaffLocationId]);

  // Handle refresh of store/location data
  const handleRefreshData = async () => {
    setLoadingData(true);
    setLoadingProgress(0);
    setLoadingStep(isOnline ? "Syncing system data..." : "Loading cached data...");
    let shouldHardRefresh = false;
    try {
      // Try online first
      if (isOnline) {
        setLoadingProgress(15);
        setLoadingStep("Syncing stores and locations...");
        const storeResponse = await fetch("/api/store/init-locations");
        if (!storeResponse.ok) {
          throw new Error(`Failed to sync locations: ${storeResponse.status}`);
        }

        const storeData = await storeResponse.json();
        if (!storeData.store) {
          throw new Error('Store data missing from cloud sync');
        }

        const storeObj = {
          _id: storeData.store._id,
          name: storeData.store.storeName || storeData.store.companyName || storeData.store.name || "Default Store",
        };
        setStores([storeObj]);
        setSelectedStore(storeObj._id);
        localStorage.setItem('cachedStore', JSON.stringify(storeObj));

        const activeLocations = storeData.store.locations?.filter(loc => loc.isActive !== false) || [];
        setLocations(activeLocations);
        if (activeLocations.length > 0) {
          setSelectedLocation((currentLocation) => pickLocationId(activeLocations, currentLocation));
        }
        localStorage.setItem("cachedLocations", JSON.stringify(activeLocations));
        localStorage.setItem("locations_metadata", JSON.stringify({
          lastSynced: new Date().toISOString(),
          count: activeLocations.length,
          locationNames: activeLocations.map(l => l.name)
        }));
        await preloadTendersForLocations(activeLocations);
        console.log("✅ Refreshed locations from cloud and cached for offline");
        
        setLoadingProgress(40);
        setLoadingStep("Syncing staff...");
        const staffResponse = await fetch("/api/staff/list");
        if (!staffResponse.ok) {
          throw new Error(`Failed to sync staff: ${staffResponse.status}`);
        }

        const staffData = await staffResponse.json();
        const staffList = staffData.data || staffData || [];
        const refreshedStaff = normalizeStaffList(Array.isArray(staffList) ? staffList : []);
        setStaff(refreshedStaff);
        localStorage.setItem("cachedStaff", JSON.stringify(refreshedStaff));
        console.log("✅ Refreshed staff from cloud");

        setLoadingProgress(60);
        setLoadingStep("Syncing categories...");
        await cacheCategoriesForOffline();

        setLoadingProgress(80);
        setLoadingStep("Syncing products...");
        await cacheProductsForLocations(activeLocations);

        setLoadingProgress(92);
        setLoadingStep("Syncing pending offline data...");
        try {
          await runWithTimeout(
            (async () => {
              await syncPendingTillOpens();
              await syncPendingTransactions();
              await syncPendingTillCloses();
            })(),
            12000
          );
        } catch (syncErr) {
          console.warn('⚠️ Full sync pending-data step failed:', syncErr?.message || syncErr);
        }

        setLoadingProgress(100);
        setLoadingStep("Reloading system...");
        shouldHardRefresh = true;
      } else {
        // Offline - load from localStorage
        setLoadingProgress(60);
        loadCachedData();
        console.log("📱 Refreshed data from local storage (offline)");
      }
    } catch (error) {
      console.error("Failed to refresh data:", error);
      loadCachedData();
    } finally {
      if (shouldHardRefresh && typeof window !== 'undefined') {
        window.location.reload();
        return;
      }
      setLoadingData(false);
    }
  };

  // Handle exit/close system
  const handleExitSystem = () => {
    if (typeof window !== 'undefined') {
      // Try to close window (works if opened as popup)
      window.close();
      // If window.close() doesn't work (main window), redirect to blank
      setTimeout(() => {
        window.location.href = "about:blank";
      }, 100);
    }
  };

  return (
    <div className="h-screen bg-gradient-to-b from-cyan-600 to-cyan-700 flex flex-col overflow-hidden pos-mobile-scale">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-red-600 text-white py-1 px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faX} className="w-3 h-3" />
            <span className="font-semibold text-sm">Offline mode</span>
          </div>
          <button
            type="button"
            onClick={() => openHelpChat("offline")}
            className="underline hover:text-red-100 text-sm"
          >
            Learn more &gt;
          </button>
        </div>
      )}

      {/* Pending Till Close Banner */}
      {isOnline && pendingTillCloseIds.length > 0 && (
        <div className="bg-yellow-500 text-yellow-900 py-2 px-4 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-sm font-semibold">
            Pending till close sync: {pendingTillCloseIds.length}
          </div>
          <button
            onClick={handleSyncPendingCloses}
            disabled={syncingPendingCloses}
            className="px-4 py-1.5 bg-yellow-700 hover:bg-yellow-800 text-white rounded text-sm font-bold transition disabled:opacity-60"
          >
            {syncingPendingCloses ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="bg-cyan-700 px-4 py-2 flex items-center justify-between border-b-4 border-cyan-800 flex-shrink-0">
        {/* Clock In/Out Button */}
        {loginSettings.showClockInOut !== false && (
          <button
            onClick={() => setShowClockModal(true)}
            className="px-4 py-1.5 border-2 border-white text-white rounded-full font-semibold text-sm hover:bg-cyan-600 transition flex items-center gap-2"
          >
            <FontAwesomeIcon icon={faClock} className="w-4 h-4" />
            CLOCK IN / OUT
          </button>
        )}
        {loginSettings.showClockInOut === false && <div />}

        {/* Center Logo */}
        <div className="text-center flex flex-col items-center">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center mx-auto mb-1 shadow-lg overflow-hidden relative">
            <Image 
              src={getStoreLogo()} 
              alt="Store Logo" 
              width={32}
              height={32}
              className="object-contain"
              onError={(e) => {
                e.target.src = '/images/placeholder.jpg';
              }}
              unoptimized
            />
          </div>
          <p className="text-white font-bold text-xs">{currentTime}</p>
        </div>

        {/* Right Buttons */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => openHelpChat("login")}
            className="px-4 py-1.5 border-2 border-white text-white rounded-full font-semibold text-sm hover:bg-cyan-600 transition flex items-center gap-2"
          >
            <FontAwesomeIcon icon={faQuestionCircle} className="w-4 h-4" />
            HELP
          </button>
          {loginSettings.showExitButton !== false && (
            <button
              onClick={handleExitSystem}
              className="px-4 py-1.5 bg-red-600 text-white rounded-full font-semibold text-sm hover:bg-red-700 transition flex items-center gap-2"
            >
              <FontAwesomeIcon icon={faPowerOff} className="w-4 h-4" />
              EXIT
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Side - Store/Location/Staff Selection */}
        <div className="flex-1 overflow-y-auto p-4 bg-gradient-to-b from-cyan-600 to-cyan-700">
          {/* Active Open Tills Alert */}
          {activeTills && activeTills.length > 0 && (
            <div className="mb-4 bg-yellow-400 bg-opacity-90 border-l-4 border-yellow-600 p-3 rounded-lg">
              <p className="text-yellow-900 font-bold mb-2 flex items-center gap-2 text-sm">
                ⏱️ ACTIVE OPEN TILL{activeTills.length > 1 ? 'S' : ''}
              </p>
              <div className="space-y-2">
                {activeTills.map((till) => (
                  <div key={till._id} className="text-yellow-900 text-xs bg-white bg-opacity-60 p-2 rounded flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-semibold">{till.staffName} @ {till.locationName || 'Unknown Location'}</div>
                      <div className="text-xs opacity-80">
                        Opened: {new Date(till.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        {' | '}Sales: ₦{till.totalSales?.toLocaleString('en-NG') || '0'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleResumeRequest(till)}
                      disabled={loading}
                      className={`ml-2 px-3 py-1.5 font-bold text-xs rounded whitespace-nowrap transition disabled:opacity-50 ${
                        resumeTill?._id === till._id
                          ? 'bg-yellow-600 text-white ring-2 ring-yellow-300'
                          : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      {resumeTill?._id === till._id ? '⬅ ENTER PIN' : 'RESUME'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Transactions Indicator */}
          {hasPendingTransactions && (
            <div className="mb-4">
              <p className="text-white font-bold text-sm flex items-center gap-2">
                📋 HAS PENDING TRANSACTIONS
              </p>
            </div>
          )}

          {loadingData ? (
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
                <p className="text-white font-bold text-lg mb-2">Loading POS Data...</p>
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
          ) : (
            <>
              {/* Sync Data Button - Always Visible */}
              <div className="mb-4 p-3 bg-cyan-800 rounded-lg border-2 border-cyan-600">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-semibold text-xs">
                    {isOnline ? '🌐 ONLINE' : '📴 OFFLINE MODE'}
                  </span>
                  <span className="text-cyan-300 text-xs">
                    {locations.length} location{locations.length !== 1 ? 's' : ''} cached
                  </span>
                </div>
                <button
                  onClick={handleRefreshData}
                  disabled={loadingData}
                  className="w-full px-4 py-3 bg-yellow-500 hover:bg-yellow-400 text-cyan-900 font-bold rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50 text-sm shadow-md"
                >
                  <FontAwesomeIcon icon={faSync} className={`w-4 h-4 flex-shrink-0 ${loadingData ? 'animate-spin' : ''}`} />
                  <span>{loadingData ? 'Syncing...' : (isOnline ? 'Sync Data' : 'Load Cached Data')}</span>
                </button>
                {/* Sync Status */}
                {(() => {
                  try {
                    const metadata = JSON.parse(localStorage.getItem('locations_metadata') || '{}');
                    if (metadata.lastSynced) {
                      const syncDate = new Date(metadata.lastSynced);
                      const timeAgo = Math.round((Date.now() - syncDate.getTime()) / 60000);
                      return (
                        <p className="text-xs text-cyan-300 mt-2 text-center">
                          Last synced: {timeAgo < 60 ? `${timeAgo} mins ago` : syncDate.toLocaleString()}
                        </p>
                      );
                    }
                    return <p className="text-xs text-yellow-300 mt-2 text-center">⚠️ Never synced - click to sync</p>;
                  } catch (e) {
                    return null;
                  }
                })()}
              </div>

              {/* Store Selection Grid */}
              <div className="mb-4">
                <p className="text-white font-semibold text-xs mb-2">SELECT STORE</p>
                <div className="grid grid-cols-2 gap-2">
                  {stores.length === 0 ? (
                    <div className="text-white col-span-2 text-sm">No stores available</div>
                  ) : (
                    stores.map((store) => (
                      <button
                        key={store._id}
                        onClick={() => {
                          setSelectedStore(store._id);
                          setSelectedLocation((currentLocation) => pickLocationId(locations, currentLocation));
                          setSelectedStaff("");
                        }}
                        className={`py-2 px-2 rounded-lg font-bold text-xs transition transform hover:scale-105 ${
                          selectedStore === store._id
                            ? "bg-cyan-900 text-white ring-2 ring-yellow-400"
                            : "bg-cyan-800 text-white hover:bg-cyan-700"
                        }`}
                      >
                        {store.name}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Location Selection Bar */}
              {(selectedStore || locations.length > 0) && (
                <div className="mb-4 bg-cyan-800/80 rounded-xl p-3 border border-cyan-600 shadow-lg">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-white font-bold text-xs flex items-center gap-2">
                      📍 SELECT LOCATION {!isOnline && <span className="text-yellow-300 font-normal">(Cached)</span>}
                    </label>
                    <button
                      onClick={handleRefreshData}
                      disabled={loadingData}
                      className="px-2.5 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg transition border border-cyan-600 disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5"
                      title="Refresh locations from cloud/local"
                    >
                      <FontAwesomeIcon icon={faRedo} className={`w-3 h-3 ${loadingData ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {(() => {
                      const visibleIds = loginSettings.visibleLocationIds || [];
                      const filteredLocations = getVisibleLocations(locations, visibleIds);
                      return filteredLocations.map((loc) => (
                        <button
                          key={getLocationId(loc) || loc.name}
                          onClick={() => {
                            setSelectedLocation(getLocationId(loc));
                            setSelectedStaff("");
                          }}
                          className={`px-3 py-2.5 rounded-lg font-bold text-xs transition-all ${
                            getLocationTokens(loc).includes(normalizeLocationToken(selectedLocation))
                              ? "bg-yellow-400 text-cyan-900 ring-2 ring-yellow-300 shadow-md"
                              : "bg-cyan-700 text-white hover:bg-cyan-600 border border-cyan-600"
                          }`}
                        >
                          {loc.name || "Location"}
                        </button>
                      ));
                    })()}
                  </div>
                  {locations.length === 0 && (
                    <p className="text-yellow-300 text-xs mt-2 text-center">
                      ⚠️ No locations cached. Please sync when online.
                    </p>
                  )}
                </div>
              )}

              {/* Staff Cards */}
              {(selectedStore || locations.length > 0) && (
                <div>
                  <p className="text-white font-semibold text-xs mb-2">SELECT STAFF</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 max-h-[60vh] overflow-y-auto">
                    {staff.length === 0 ? (
                      <div className="text-white text-center py-4 bg-cyan-800 rounded-lg text-sm col-span-full">
                        No staff available
                      </div>
                    ) : (
                      staff.map((member) => (
                        <button
                          key={member._id}
                          onClick={() => {
                            setSelectedStaff(member._id);
                            if (isNonAdminRole(member.role)) {
                              const assignedLocationId = resolveStaffLocationId(member);
                              if (assignedLocationId) {
                                setSelectedLocation(assignedLocationId);
                              }
                            }
                          }}
                          className={`p-3 rounded-lg text-center font-semibold transition flex flex-col items-center gap-1 ${
                            selectedStaff === member._id
                              ? "bg-yellow-400 text-cyan-900 ring-2 ring-yellow-300 shadow-lg"
                              : "bg-cyan-800 text-white hover:bg-cyan-700"
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-base font-bold ${
                            selectedStaff === member._id
                              ? "bg-cyan-700 text-white"
                              : "bg-cyan-600 text-white"
                          }`}>
                            {member.name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div className="font-bold text-xs leading-tight break-words w-full">{member.name}</div>
                          <div className={`text-[10px] capitalize px-2 py-0.5 rounded-full ${
                            selectedStaff === member._id
                              ? "bg-cyan-600 text-white"
                              : "bg-cyan-900/40 text-cyan-200"
                          }`}>{member.role || 'Staff'}</div>
                          {isNonAdminRole(member.role) && resolveStaffLocationId(member) && (
                            <div className={`text-[10px] px-2 py-0.5 rounded-full ${
                              selectedStaff === member._id
                                ? "bg-white/80 text-cyan-900"
                                : "bg-cyan-700 text-cyan-100"
                            }`}>
                              {locations.find((loc) => String(loc._id) === String(resolveStaffLocationId(member)))?.name || member.locationName || "Assigned location"}
                            </div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Divider */}
        <div className="w-0.5 bg-cyan-800"></div>

        {/* Right Side - PIN Entry */}
        <div className="w-2/5 bg-gradient-to-b from-cyan-700 to-cyan-800 p-4 flex items-center justify-center">
          <div className="w-full max-w-sm bg-cyan-900/30 border border-cyan-500/60 rounded-2xl p-5 shadow-2xl backdrop-blur-sm flex flex-col items-center">
          {/* Title */}
          <h2 className="text-white font-bold text-lg mb-4 tracking-wide text-center">
            PLEASE ENTER YOUR PASSCODE
          </h2>

          {/* PIN Display */}
          <div className="mb-4">
            <div className="text-4xl tracking-widest text-white font-bold text-center">
              {pin.split("").map((_, i) => (
                <span key={i}>●</span>
              ))}
              {[...Array(4 - pin.length)].map((_, i) => (
                <span key={`empty-${i}`} className="opacity-50">
                  ●
                </span>
              ))}
            </div>
          </div>

          {/* Separator Line */}
          <div className="w-full max-w-xs h-0.5 bg-white/30 mb-4"></div>

          {/* Numeric Keypad */}
          <div className="grid grid-cols-3 gap-2 mb-4 w-full max-w-xs">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handlePinClick(num.toString())}
                className="h-12 bg-cyan-800 border border-cyan-500/60 shadow-md backdrop-blur-sm hover:bg-cyan-600 text-white font-bold text-xl rounded-lg transition active:scale-95"
              >
                {num}
              </button>
            ))}

            {/* 0 and Backspace */}
            <button
              onClick={() => handlePinClick("0")}
              className="col-span-2 h-12 bg-cyan-800 border border-cyan-500/60 shadow-md backdrop-blur-sm hover:bg-cyan-600 text-white font-bold text-xl rounded-lg transition active:scale-95"
            >
              0
            </button>
            <button
              onClick={handleBackspace}
              className="h-12 bg-cyan-800 border border-cyan-500/60 shadow-md backdrop-blur-sm hover:bg-cyan-600 text-white font-bold text-lg rounded-lg transition active:scale-95"
            >
              ⌫
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="w-full max-w-xs mb-3 p-2.5 bg-red-600/95 text-white rounded-lg text-xs text-center font-semibold border border-red-400">
              {error}
            </div>
          )}

          {/* Login Button - Same width as keypad */}
          <button
            onClick={resumeTill ? () => handleQuickLogin(resumeTill) : handleLogin}
            disabled={loading || pin.length !== 4 || !selectedStore || !selectedLocation || !selectedStaff}
            className={`w-full max-w-xs py-3 font-bold text-base border border-cyan-500/60 shadow-md backdrop-blur-sm rounded-lg transition ${
              pin.length === 4 && selectedStore && selectedLocation && selectedStaff && !loading
                ? "bg-cyan-400 hover:bg-cyan-300 text-cyan-900"
                : "bg-gray-400 text-gray-600 cursor-not-allowed"
            }`}
          >
            {loading ? "LOGGING IN..." : resumeTill ? "RESUME TILL" : "LOGIN"}
          </button>

          {/* Cancel Resume */}
          {resumeTill && (
            <button
              onClick={() => { setResumeTill(null); setPin(""); setError(""); }}
              className="w-full max-w-xs py-2 mt-2 text-xs text-white/70 hover:text-white underline transition"
            >
              Cancel &amp; go back
            </button>
          )}

          {/* Info Text */}
          <p className="text-white/60 text-xs mt-3 text-center">
            Enter 4-digit passcode and select a Staff & Location to continue
          </p>
          </div>
        </div>
      </div>

      {/* Open Till Modal */}
      <OpenTillModal
        isOpen={showOpenTillModal}
        onClose={() => {
          setShowOpenTillModal(false);
          setLoginData(null);
        }}
        onTillOpened={handleTillOpened}
        staffData={loginData?.staff}
        locationData={loginData?.location}
      />

      {/* Clock In/Out Modal */}
      <ClockInOutModal
        isOpen={showClockModal}
        onClose={() => setShowClockModal(false)}
        staff={staff}
        locations={locations}
        selectedLocation={selectedLocation}
      />
    </div>
  );
}

