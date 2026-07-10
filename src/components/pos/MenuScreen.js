/**
 * MenuScreen Component
 * 
 * MENU tab - displays product categories from database.
 * - Fetches categories and products from API
 * - Color-coded category buttons
 * - Touch-optimized spacing and sizing
 * - Category click loads products from database
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBaby,
  faCookie,
  faBreadSlice,
  faUtensils,
  faSoap,
  faHeart,
  faSnowflake,
  faBook,
  faShirt,
  faWineGlass,
  faLeaf,
  faSyncAlt,
  faWifi,
  faX,
  faSearch,
} from '@fortawesome/free-solid-svg-icons';
import { useCart } from '../../context/CartContext';
import PaymentPanel from './PaymentPanel';
import { useStaff } from '../../context/StaffContext';
import { getLocalCategories, getLocalProductsByCategory, syncCategories, syncProducts, getAllLocalProducts } from '../../lib/indexedDB';
import { initOfflineSync, getOnlineStatus, getImageUrl, shouldShowPlaceholder, syncPendingTransactions, syncPendingTillCloses } from '../../lib/offlineSync';
import { cleanupOldTransactions } from '../../lib/indexedDBCleanup';
import AlphaKeyboardModal from '../common/AlphaKeyboardModal';
import RoomReservationModal from './RoomReservationModal';
import {
  ROOM_STATUSES,
  getRoomReservationDetails,
  getRoomStatusLabel,
  isRoomProduct,
  isRoomUnavailable,
} from '../../lib/roomReservations';

// Color mapping for categories
const CATEGORY_COLORS = {
  'Bakery': 'from-amber-500 to-amber-600',
  'Drinks': 'from-blue-500 to-blue-600',
  'Food': 'from-orange-500 to-orange-600',
  'Hotel': 'from-purple-500 to-purple-600',
  'Wine': 'from-red-500 to-red-600',
};

const CATEGORY_ICONS = {
  'Bakery': faBreadSlice,
  'Drinks': faWineGlass,
  'Food': faUtensils,
  'Hotel': faBook,
  'Wine': faWineGlass,
};

const CATEGORY_ICON_BY_KEY = {
  bakery: faBreadSlice,
  bread: faBreadSlice,
  drinks: faWineGlass,
  drink: faWineGlass,
  beverage: faWineGlass,
  beverages: faWineGlass,
  food: faUtensils,
  hotel: faBook,
  wine: faWineGlass,
  wines: faWineGlass,
  baby: faBaby,
  babies: faBaby,
  cookie: faCookie,
  cookies: faCookie,
  cleaning: faSoap,
  beauty: faHeart,
  frozen: faSnowflake,
  clothing: faShirt,
  fashion: faShirt,
  natural: faLeaf,
  books: faBook,
};

const normalizeIconToken = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/^fa[srlbd]?[-_]/, '')
    .replace(/[\s_-]+/g, '')
    .trim();

const normalizeLocationToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const getCategoryPropertyValue = (category, keys = []) => {
  if (!Array.isArray(category?.properties)) return null;
  const normalizedKeys = keys.map((key) => normalizeIconToken(key));
  for (const prop of category.properties) {
    if (!prop || typeof prop !== 'object') continue;
    const propKey = normalizeIconToken(prop.name || prop.key || prop.label);
    if (!normalizedKeys.includes(propKey)) continue;
    if (typeof prop.value === 'string' && prop.value.trim()) return prop.value.trim();
    if (typeof prop.val === 'string' && prop.val.trim()) return prop.val.trim();
    if (typeof prop.text === 'string' && prop.text.trim()) return prop.text.trim();
    if (typeof prop.url === 'string' && prop.url.trim()) return prop.url.trim();
    if (Array.isArray(prop.values) && prop.values.length > 0) {
      const firstValue = prop.values[0];
      if (typeof firstValue === 'string' && firstValue.trim()) return firstValue.trim();
    }
  }
  return null;
};

const getCategoryImageUrl = (category) => {
  const firstImage = Array.isArray(category?.images) && category.images.length > 0
    ? category.images[0]
    : null;

  const candidates = [
    firstImage?.thumb,
    firstImage?.full,
    firstImage?.url,
    category?.image,
    category?.imageUrl,
    category?.thumbnail,
    getCategoryPropertyValue(category, ['image', 'imageUrl', 'thumbnail', 'iconImage', 'iconUrl']),
  ];

  const valid = candidates.find((url) => typeof url === 'string' && url.trim().length > 0);
  return valid ? valid.trim() : null;
};

const getProductImageUrl = (product) => {
  const firstImage = Array.isArray(product?.images) && product.images.length > 0
    ? product.images[0]
    : null;

  const candidates = [
    firstImage?.thumb,
    firstImage?.thumbnail,
    firstImage?.small,
    firstImage?.medium,
    firstImage?.url,
    firstImage?.secure_url,
    product?.thumbnail,
    product?.imageUrl,
    product?.image,
    firstImage?.full,
  ];

  const valid = candidates.find((url) => typeof url === 'string' && url.trim().length > 0);
  return valid ? valid.trim() : null;
};

const shouldBypassImageOptimization = (src) => {
  const value = String(src || '').toLowerCase();
  return value.includes('_thumb.') || value.includes('image-bucket-admin.s3.amazonaws.com');
};

const getCategoryIcon = (category) => {
  const configuredIcon = category?.icon
    || category?.iconName
    || getCategoryPropertyValue(category, ['icon', 'iconName']);

  const configuredKey = normalizeIconToken(configuredIcon);
  if (configuredKey && CATEGORY_ICON_BY_KEY[configuredKey]) {
    return CATEGORY_ICON_BY_KEY[configuredKey];
  }

  const nameKey = normalizeIconToken(category?.name);
  return CATEGORY_ICON_BY_KEY[nameKey] || CATEGORY_ICONS[category?.name] || faBook;
};

// Default categories to show if API fails and no cache exists
const DEFAULT_CATEGORIES = [
  { _id: '1', name: 'Bakery' },
  { _id: '2', name: 'Drinks' },
  { _id: '3', name: 'Food' },
  { _id: '4', name: 'Hotel' },
  { _id: '5', name: 'Wine' },
];

export default function MenuScreen() {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [products, setProducts] = useState([]);
  const [allProducts, setAllProducts] = useState([]); // All products for global search
  const [searchTerm, setSearchTerm] = useState(''); // Current input value
  const [appliedSearch, setAppliedSearch] = useState(''); // Search only applied on button click
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadingImages, setLoadingImages] = useState({}); // Track loading state for each product image
  const [failedImages, setFailedImages] = useState(new Set()); // Track failed images
  const [failedCategoryImages, setFailedCategoryImages] = useState(new Set()); // Track failed category images
  const [error, setError] = useState(null); // Track errors for data fetching
  const [isOnline, setIsOnline] = useState(true); // Track online status
  const [pendingTransactions, setPendingTransactions] = useState(0); // Track unsync'd transactions
  const [showSearchKeyboard, setShowSearchKeyboard] = useState(false);
  const [roomToBook, setRoomToBook] = useState(null);
  const imageObserver = useRef(null);
  const handleManualSyncRef = useRef(null);
  const { addItem, activeCart, showPaymentPanel } = useCart();
  const { location } = useStaff(); // Get store location

  const buildCartPayload = useCallback((product, overrides = {}) => ({
    id: product._id || product.id,
    name: product.name,
    price: product.salePriceIncTax,
    category: product.category,
    quantity: 1,
    productType: product.productType || 'standard',
    roomStatus: product.roomStatus || ROOM_STATUSES.AVAILABLE,
    currentBooking: product.currentBooking || null,
    ...overrides,
  }), []);

  const handleProductSelect = useCallback((product) => {
    if (isRoomProduct(product)) {
      if (isRoomUnavailable(product)) {
        setError(`${product.name || 'Room'} is ${getRoomStatusLabel(product.roomStatus).toLowerCase()} and cannot be booked.`);
        return;
      }
      setError(null);
      setRoomToBook(product);
      return;
    }

    addItem(buildCartPayload(product));
  }, [addItem, buildCartPayload]);

  const handleRoomBookingConfirm = useCallback((reservationDetails) => {
    if (!roomToBook) return;

    addItem(buildCartPayload(roomToBook, {
      productType: 'room',
      roomStatus: ROOM_STATUSES.RESERVED,
      reservationDetails,
    }));
    setError(null);
    setRoomToBook(null);
  }, [addItem, buildCartPayload, roomToBook]);

  const filterProductsForLocation = useCallback((productList = []) => {
    if (!Array.isArray(productList)) return [];

    const locationTokens = new Set([
      normalizeLocationToken(location?._id),
      normalizeLocationToken(location?.id),
      normalizeLocationToken(location?.name),
      normalizeLocationToken(location?.code),
    ].filter(Boolean));

    if (locationTokens.size === 0) {
      return [];
    }

    return productList.filter((product) => {
      if (!Array.isArray(product?.locations) || product.locations.length === 0) {
        return false;
      }

      return product.locations.some((locationEntry) => {
        if (locationEntry && typeof locationEntry === 'object') {
          return [locationEntry._id, locationEntry.id, locationEntry.name, locationEntry.code].some((candidate) => {
            const token = normalizeLocationToken(candidate);
            return token && locationTokens.has(token);
          });
        }

        const token = normalizeLocationToken(locationEntry);
        return token && locationTokens.has(token);
      });
    });
  }, [location?._id, location?.id, location?.name, location?.code]);

  const recordSyncTime = useCallback((value = new Date()) => {
    const syncTime = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(syncTime.getTime())) {
      return;
    }

    setLastSyncTime(syncTime);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('pos:sync-state-changed', {
          detail: { syncedAt: syncTime.toISOString() },
        })
      );
    }
  }, []);

  // Initialize offline sync on mount ONLY (empty deps — runs once)
  useEffect(() => {
    initOfflineSync();
    
    // Clean up old invalid transactions from previous schema
    cleanupOldTransactions().catch(err => {
      console.error('Cleanup failed:', err);
    });
    
    // DON'T clear categories cache on mount — it wipes offline data.
    // Categories are always refreshed from API when online in the fetchCategories effect.
    
    // Listen for online/offline changes
    const handleOnline = () => {
      console.log('🟢 Online');
      setIsOnline(true);
    };
    
    const handleOffline = () => {
      console.log('🔴 Offline');
      setIsOnline(false);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    setIsOnline(getOnlineStatus());
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Listen for transaction completion to refresh products (separate effect so it
  // re-binds when selectedCategory changes, but doesn't re-run initOfflineSync)
  useEffect(() => {
    const handleTransactionCompleted = async () => {
      console.log('📲 Transaction completed event received, refreshing products...');

      // Check if auto-refresh is enabled in UI settings
      let autoRefresh = true;
      try {
        const stored = localStorage.getItem('uiSettings');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.system?.autoRefreshProducts === false) autoRefresh = false;
        }
      } catch (e) {}

      // If online + auto-refresh enabled, fetch fresh quantities from API
      if (autoRefresh && getOnlineStatus()) {
        try {
          // Quick network quality check — abort after 3s to avoid blocking slow connections
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);

          if (selectedCategory) {
            const categoryId = selectedCategory._id || selectedCategory.id;
            let refreshUrl = `/api/products?category=${encodeURIComponent(categoryId)}`;
            if (location?._id) {
              refreshUrl += `&locationId=${encodeURIComponent(location._id)}`;
            }
            const response = await fetch(
              refreshUrl,
              { signal: controller.signal }
            );
            clearTimeout(timeout);

            if (response.ok) {
              const data = await response.json();
              const freshProducts = data.data || [];
              if (freshProducts.length > 0) {
                setProducts(freshProducts);
                // Also update IndexedDB with fresh data
                try { await syncProducts(freshProducts); } catch (e) {}
                console.log(`✅ Auto-refreshed ${freshProducts.length} products from API`);
                return;
              }
            }
          }
        } catch (err) {
          // Network too slow or offline — fall through to local DB
          if (err.name !== 'AbortError') {
            console.warn('⚠️ Auto-refresh from API failed:', err.message);
          } else {
            console.log('⏱️ Auto-refresh skipped — network too slow');
          }
        }
      }

      // Fallback: reload from local DB (offline or auto-refresh disabled)
      if (selectedCategory) {
        const categoryName = selectedCategory.name;
        const categoryId = selectedCategory._id || selectedCategory.id;
        let localProducts = await getLocalProductsByCategory(categoryName);
        if (!localProducts || localProducts.length === 0) {
          localProducts = await getLocalProductsByCategory(categoryId);
        }
        if (localProducts && localProducts.length > 0) {
          setProducts(filterProductsForLocation(localProducts));
        }
      }
    };

    // When coming back online, queue a product refresh if auto-refresh is enabled
    const handleBackOnline = async () => {
      let autoRefresh = true;
      try {
        const stored = localStorage.getItem('uiSettings');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.system?.autoRefreshProducts === false) autoRefresh = false;
        }
      } catch (e) {}

      if (autoRefresh) {
        console.log('🟢 Back online — auto-refreshing products...');
        // Small delay to let network stabilize
        setTimeout(() => {
          handleManualSyncRef.current?.();
        }, 2000);
      }
    };

    window.addEventListener('transactions:completed', handleTransactionCompleted);
    window.addEventListener('online', handleBackOnline);
    
    return () => {
      window.removeEventListener('transactions:completed', handleTransactionCompleted);
      window.removeEventListener('online', handleBackOnline);
    };
  }, [selectedCategory, location, filterProductsForLocation]);

  // Listen for sidebar cloud sync to refresh products/categories/images
  useEffect(() => {
    const handleProductsRefresh = () => {
      console.log('🔄 Products refresh triggered from sidebar sync');
      // Clear failed images so they retry loading
      setFailedImages(new Set());
      setFailedCategoryImages(new Set());
      // Trigger the manual sync which fetches all products and categories
      handleManualSyncRef.current?.();
    };

    window.addEventListener('sync:products-refresh', handleProductsRefresh);
    return () => window.removeEventListener('sync:products-refresh', handleProductsRefresh);
  }, []);

  // Log when categories change
  useEffect(() => {
    console.log("📦 Categories state updated:", categories.length, "categories");
  }, [categories]);

  const filterCategoriesForLocation = useCallback((categoryList = []) => {
    const locationCategoryIds = location?.categories || location?.categoryIds;
    if (!Array.isArray(locationCategoryIds) || locationCategoryIds.length === 0) {
      return categoryList;
    }
    const idSet = new Set(locationCategoryIds.map(id => String(id)));
    return categoryList.filter(cat => idSet.has(String(cat?._id || cat?.id)));
  }, [location?.categories, location?.categoryIds]);

  // Log when products change
  useEffect(() => {
    console.log("🛍️ Products state updated:", products.length, "products");
  }, [products]);

  // Fetch categories on mount and when location changes
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        console.log("📦 Loading categories...");
        console.log("📍 Current location:", location);
        setError(null); // Clear previous errors
        
        // If location is available, always fetch from API (skip IndexedDB)
        // This ensures we get only categories for this location
        if (location?._id) {
          console.log("📥 Location found, fetching from API with location filter...");
          const url = `/api/categories?location=${location._id}`;
          console.log("🔗 API URL:", url);
          
          try {
            const response = await fetch(url);
            if (response.ok) {
              const data = await response.json();
              console.log("📦 Categories from API:", data.data);
              const categories = data.data || [];
              
              if (categories.length > 0) {
                const filtered = filterCategoriesForLocation(categories);
                setCategories(filtered);
                // Save to IndexedDB for offline support
                await syncCategories(filtered);
                // Also save to localStorage as backup cache
                try { localStorage.setItem('cachedCategories', JSON.stringify(filtered)); } catch (e) {}
                recordSyncTime();
                // Auto-select first category
                setSelectedCategory(filtered[0] || null);
              } else {
                console.warn("⚠️ No categories found for this location, using defaults");
                const filtered = filterCategoriesForLocation(DEFAULT_CATEGORIES);
                setCategories(filtered);
                setSelectedCategory(filtered[0] || null);
              }
            } else {
              console.warn(`⚠️ API returned ${response.status}, trying local cache...`);
              // Try local cache on API failure
              const localCategories = await getLocalCategories();
              if (localCategories && localCategories.length > 0) {
                console.log("✅ Using cached categories");
                const filtered = filterCategoriesForLocation(localCategories);
                setCategories(filtered);
                setSelectedCategory(filtered[0] || null);
              } else {
                console.log("📦 Using default categories as fallback");
                const filtered = filterCategoriesForLocation(DEFAULT_CATEGORIES);
                setCategories(filtered);
                setSelectedCategory(filtered[0] || null);
              }
            }
          } catch (fetchErr) {
            console.warn("⚠️ Fetch error, trying local cache...", fetchErr);
            // Try local cache on fetch error
            const localCategories = await getLocalCategories();
            if (localCategories && localCategories.length > 0) {
              console.log("✅ Using cached categories");
              const filtered = filterCategoriesForLocation(localCategories);
              setCategories(filtered);
              setSelectedCategory(filtered[0] || null);
            } else {
              console.log("📦 Using default categories as fallback");
              const filtered = filterCategoriesForLocation(DEFAULT_CATEGORIES);
              setCategories(filtered);
              setSelectedCategory(filtered[0] || null);
            }
          }
        } else {
          console.log("📦 No location yet, trying local cache...");
          // No location provided, try local cache
          const localCategories = await getLocalCategories();
          
          if (localCategories && localCategories.length > 0) {
            console.log("✅ Found", localCategories.length, "categories in local storage");
            const filtered = filterCategoriesForLocation(localCategories);
            setCategories(filtered);
            // Auto-select first category
            setSelectedCategory(filtered[0] || null);
          } else {
            // Try localStorage cache when offline or no IndexedDB data
            const cached = typeof window !== 'undefined'
              ? localStorage.getItem('cachedCategories')
              : null;
            if (cached) {
              const cachedCategories = JSON.parse(cached);
              if (cachedCategories && cachedCategories.length > 0) {
                console.log("✅ Using cached categories from localStorage");
                const filtered = filterCategoriesForLocation(cachedCategories);
                setCategories(filtered);
                setSelectedCategory(filtered[0] || null);
                await syncCategories(filtered);
                setLoadingCategories(false);
                return;
              }
            }

            console.log("📥 No local categories found, fetching all from API...");
            try {
              const response = await fetch('/api/categories');
              if (response.ok) {
                const data = await response.json();
                console.log("📦 Categories from API:", data.data);
                const categories = data.data || [];
                const filtered = filterCategoriesForLocation(categories);
                setCategories(filtered);
                // Save to IndexedDB for offline support
                if (filtered.length > 0) {
                  await syncCategories(filtered);
                  // Also save to localStorage as backup cache
                  try { localStorage.setItem('cachedCategories', JSON.stringify(filtered)); } catch (e) {}
                  recordSyncTime();
                }
                // Auto-select first category
                if (filtered.length > 0) {
                  setSelectedCategory(filtered[0]);
                }
              } else {
                console.log("📦 Using default categories as fallback");
                const filtered = filterCategoriesForLocation(DEFAULT_CATEGORIES);
                setCategories(filtered);
                setSelectedCategory(filtered[0] || null);
              }
            } catch (fetchErr) {
              console.warn("⚠️ Fetch error, using default categories");
              const filtered = filterCategoriesForLocation(DEFAULT_CATEGORIES);
              setCategories(filtered);
              setSelectedCategory(filtered[0] || null);
            }
          }
        }
        setLoadingCategories(false);
      } catch (err) {
        console.error('❌ Failed to fetch categories:', err);
        // Fallback to default categories
        console.log("📦 Using default categories as fallback");
        const filtered = filterCategoriesForLocation(DEFAULT_CATEGORIES);
        setCategories(filtered);
        setSelectedCategory(filtered[0] || null);
        setError(null); // Clear error - we have a fallback
        setLoadingCategories(false);
      }
    };

    fetchCategories();
  }, [location, filterCategoriesForLocation, recordSyncTime]); // Re-fetch when location changes

  // Load ALL products from local DB on mount for global search
  useEffect(() => {
    const loadAllLocalProducts = async () => {
      try {
        console.log("📦 Loading all local products for search...");
        const localProducts = await getAllLocalProducts();
        const locationScopedProducts = filterProductsForLocation(localProducts);
        if (locationScopedProducts.length > 0) {
          console.log(`✅ Loaded ${locationScopedProducts.length} location-scoped products from local storage`);
          setAllProducts(locationScopedProducts);
        } else {
          console.log("📦 No local products found, will fetch on sync");
        }
      } catch (err) {
        console.error("❌ Error loading local products:", err);
      }
    };
    
    loadAllLocalProducts();
  }, [filterProductsForLocation]);

  // Fetch products when category changes (from IndexedDB ONLY - API sync is manual)
  useEffect(() => {
    if (!selectedCategory) {
      setProducts([]);
      return;
    }

    const fetchProducts = async () => {
      setLoadingProducts(true);
      setError(null);
      
      try {
        const categoryId = selectedCategory._id || selectedCategory.id;
        const categoryName = selectedCategory.name;
        console.log("🛍️ Loading products for category:", categoryName, "(ID:", categoryId, ")");

        if (!location?._id) {
          console.log("📍 Waiting for active location before loading products");
          setProducts([]);
          setLoadingProducts(false);
          return;
        }
        
        // ALWAYS try local storage first
        // Products in IndexedDB store category NAME (not ID) in the 'category' field
        // So search by name first, then fall back to ID
        let localProducts = filterProductsForLocation(await getLocalProductsByCategory(categoryName));
        
        if (!localProducts || localProducts.length === 0) {
          // Fallback: try by ID in case some products store category ID
          localProducts = filterProductsForLocation(await getLocalProductsByCategory(categoryId));
        }
        
        if (localProducts && localProducts.length > 0) {
          console.log("✅ Found", localProducts.length, "products in local storage");
          setProducts(localProducts);
          setLoadingProducts(false);
          return; // Use local products - no API call
        }
        
        // If no local products for this category, try all local products filtered
        console.log("📦 No products for this category locally, checking all products...");
        const allLocal = filterProductsForLocation(await getAllLocalProducts());
        
        if (allLocal && allLocal.length > 0) {
          // Filter by category name OR ID
          const categoryFiltered = allLocal.filter(p => 
            p.category === categoryName || 
            p.category === categoryId ||
            p.categoryId === categoryId
          );
          
          if (categoryFiltered.length > 0) {
            console.log("✅ Filtered", categoryFiltered.length, "products from all local products");
            setProducts(categoryFiltered);
            setLoadingProducts(false);
            return;
          }
        }
        
        // No local data at all - try localStorage cache before API
        const cachedProductsRaw = typeof window !== 'undefined'
          ? localStorage.getItem('cachedProducts')
          : null;
        if (cachedProductsRaw) {
          const cachedProducts = filterProductsForLocation(JSON.parse(cachedProductsRaw));
          if (cachedProducts && cachedProducts.length > 0) {
            console.log("✅ Using cached products from localStorage");
            await syncProducts(cachedProducts);
            setAllProducts(cachedProducts);
            const categoryFiltered = cachedProducts.filter(p =>
              p.category === categoryName ||
              p.category === categoryId ||
              p.categoryId === categoryId
            );
            setProducts(categoryFiltered);
            setLoadingProducts(false);
            return;
          }
        }

        // No local data at all - fetch the active location's products from the API when online.
        if (isOnline) {
          console.log("📥 No local products found, fetching from API (first load)...");
          let url = `/api/products?category=${encodeURIComponent(categoryId)}`;
          if (location?._id) url += `&locationId=${encodeURIComponent(location._id)}`;
          
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
            
            if (response.ok) {
              const data = await response.json();
              console.log("🛍️ Products from API:", data.data?.length || 0);
              setProducts(data.data || []);
              // Save to IndexedDB for offline support
              if (data.data && data.data.length > 0) {
                await syncProducts(data.data);
                // Also save to localStorage as backup cache
                try {
                  const existingCached = JSON.parse(localStorage.getItem('cachedProducts') || '[]');
                  const merged = [...existingCached];
                  data.data.forEach(product => {
                    const idx = merged.findIndex(p => p._id === product._id);
                    if (idx >= 0) merged[idx] = product;
                    else merged.push(product);
                  });
                  localStorage.setItem('cachedProducts', JSON.stringify(merged));
                } catch (e) {}
                // Also update allProducts for search
                setAllProducts(prev => {
                  const merged = [...prev];
                  data.data.forEach(product => {
                    if (!merged.find(p => p._id === product._id)) {
                      merged.push(product);
                    }
                  });
                  return merged;
                });
              }
              recordSyncTime();
            } else {
              console.warn("API returned", response.status);
              setProducts([]);
            }
          } catch (fetchErr) {
            console.error("❌ API fetch failed:", fetchErr.message);
            setProducts([]);
          }
        } else {
          // Offline or user has synced before - show empty with message
          console.log("📦 No products for this category - use Sync Products to load");
          setProducts([]);
        }
        
        setLoadingProducts(false);
      } catch (err) {
        console.error('❌ Unexpected error in fetchProducts:', err);
        setProducts([]);
        setLoadingProducts(false);
      }
    };

    fetchProducts();
  }, [selectedCategory, isOnline, location?._id, filterProductsForLocation, recordSyncTime]);

  // Manual sync button handler - syncs ALL products and categories
  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      console.log("🔄 Manual sync initiated - syncing ALL products...");
      setError(null);
      
      // Fetch and sync categories - use location filter if available
      const catUrl = location?._id 
        ? `/api/categories?location=${location._id}` 
        : '/api/categories';
      console.log("🔗 Categories API URL:", catUrl);
      
      const catResponse = await fetch(catUrl);
      if (catResponse.ok) {
        const catData = await catResponse.json();
        const fetchedCategories = catData.data || [];
        await syncCategories(fetchedCategories);
        setCategories(fetchedCategories);
        // Save categories to localStorage as backup cache
        try { localStorage.setItem('cachedCategories', JSON.stringify(fetchedCategories)); } catch (e) {}
        console.log(`✅ Categories synced: ${fetchedCategories.length} categories`);
        
        // Now fetch products for ALL categories
        let allFetchedProducts = [];
        
        for (const category of fetchedCategories) {
          const categoryId = category._id || category.id;
          console.log(`📦 Fetching products for category: ${category.name}...`);
          
          try {
            let prodUrl = `/api/products?category=${encodeURIComponent(categoryId)}`;
            if (location?._id) prodUrl += `&locationId=${encodeURIComponent(location._id)}`;
            const prodResponse = await fetch(prodUrl, { signal: AbortSignal.timeout(15000) });
            
            if (prodResponse.ok) {
              const prodData = await prodResponse.json();
              const categoryProducts = prodData.data || [];
              allFetchedProducts = [...allFetchedProducts, ...categoryProducts];
              console.log(`   ✅ ${categoryProducts.length} products for ${category.name}`);
            }
          } catch (prodErr) {
            console.warn(`   ⚠️ Failed to fetch products for ${category.name}:`, prodErr.message);
          }
        }
        
        // Save all products to IndexedDB and localStorage
        const uniqueProducts = Array.from(
          new Map(allFetchedProducts.map((product) => [String(product._id), product])).values()
        );

        if (uniqueProducts.length > 0) {
          await syncProducts(uniqueProducts);
          const locationScopedProducts = filterProductsForLocation(uniqueProducts);
          setAllProducts(locationScopedProducts);
          // Save to localStorage as backup cache for offline use
          try { localStorage.setItem('cachedProducts', JSON.stringify(uniqueProducts)); } catch (e) {}
          console.log(`✅ Total products synced: ${uniqueProducts.length}`);
          
          // Reload current category products
          if (selectedCategory) {
            const categoryId = selectedCategory._id || selectedCategory.id;
            const categoryName = selectedCategory.name;
            const categoryProducts = locationScopedProducts.filter(p => 
              p.category === categoryName ||
              p.category === categoryId || 
              p.categoryId === categoryId
            );
            setProducts(categoryProducts);
          }
        }
        
      } else {
        const errorData = await catResponse.text();
        console.error("❌ Categories API Error:", catResponse.status);
        throw new Error(`Failed to sync categories: ${catResponse.status}`);
      }
      
      recordSyncTime();
      
      // Also sync pending transactions and till closes if online
      if (getOnlineStatus()) {
        console.log("🔄 Syncing pending transactions and till closes...");
        try {
          await syncPendingTransactions();
          await syncPendingTillCloses();
          console.log("✅ Pending data synced");
        } catch (err) {
          console.error('⚠️ Error syncing pending data:', err);
        }
      }
      
      console.log("✅ Manual sync complete");
    } catch (err) {
      console.error('❌ Manual sync failed:', err);
      setError(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Keep ref updated for event listener
  handleManualSyncRef.current = handleManualSync;

  // Callback for image error handling
  const handleImageError = useCallback((productId) => {
    setFailedImages(prev => new Set([...prev, productId]));
    setLoadingImages(prev => ({ ...prev, [productId]: false }));
  }, []);

  // Handle search button click - apply search filter
  const handleSearchClick = () => {
    const value = searchTerm.trim();
    setAppliedSearch(value);
    setSearchTerm(value);
    setShowSearchKeyboard(false);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-50 overflow-hidden text-sm sm:text-base">
      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-2 py-1.5 sm:px-3 sm:py-2 flex items-center justify-between flex-shrink-0">
          <span className="text-xs sm:text-sm text-red-700">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700 font-bold"
          >
            ✕
          </button>
        </div>
      )}
      
      {/* Customer/Promotion Indicator Banner */}
      {activeCart.customer && (
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white px-2 py-1.5 sm:px-3 sm:py-2 flex items-center justify-between flex-shrink-0 shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-lg sm:text-xl">👤</span>
            <div>
              <div className="font-bold text-sm sm:text-base">
                {activeCart.customer.name}
                <span className="ml-2 px-1.5 py-0.5 bg-white/20 rounded text-xs">
                  {activeCart.customer.type || 'Customer'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {!showPaymentPanel && (
        <>
          {/* Sync Button + Status Bar */}
          <div className="bg-white border-b border-neutral-200 px-2 py-1.5 sm:px-3 sm:py-2 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-1.5">
              {/* Online Status */}
              <div className={`flex items-center gap-1 px-2 py-1 rounded ${isOnline ? 'bg-green-50' : 'bg-neutral-100'}`}>
                <FontAwesomeIcon 
                  icon={isOnline ? faWifi : faX} 
                  className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isOnline ? 'text-green-600' : 'text-neutral-400'}`} 
                />
                <span className={`text-[11px] sm:text-xs font-semibold ${isOnline ? 'text-green-700' : 'text-neutral-600'}`}>
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>

              {/* Last Sync Time */}
              {lastSyncTime && (
                <span className="text-[11px] sm:text-xs text-neutral-500">
                  Last sync: {lastSyncTime.toLocaleTimeString()}
                </span>
              )}
            </div>
            
            {/* Sync Button */}
            <button
              onClick={handleManualSync}
              disabled={isSyncing || !isOnline}
              className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-primary-600 text-white text-[11px] sm:text-xs font-semibold rounded hover:bg-primary-700 disabled:bg-neutral-400 disabled:cursor-not-allowed transition-colors duration-base min-h-9 sm:min-h-10"
            >
              <FontAwesomeIcon icon={faSyncAlt} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'Syncing...' : 'Sync Products'}
            </button>
          </div>

          {/* Search Bar - Redesigned */}
          <div className="bg-white border-b-2 border-primary-200 px-2 py-1.5 sm:px-3 sm:py-2 flex-shrink-0 shadow-sm">
            <div className="relative flex gap-1.5">
              <div className="relative flex-1">
                <FontAwesomeIcon 
                  icon={faSearch} 
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary-500"
                />
                <input
                  type="text"
                  placeholder="Search products or categories..."
                  value={searchTerm}
                  readOnly
                  onClick={() => setShowSearchKeyboard(true)}
                  onFocus={() => setShowSearchKeyboard(true)}
                  className="w-full pl-8 pr-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200 transition-all font-medium"
                />
              </div>
              <button
                onClick={() => {
                  if (!searchTerm.trim()) {
                    setShowSearchKeyboard(true);
                    return;
                  }
                  handleSearchClick();
                }}
                className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-primary-500 hover:bg-primary-600 text-white font-bold rounded-lg text-xs sm:text-sm transition-colors duration-base flex items-center gap-1.5"
              >
                <FontAwesomeIcon icon={faSearch} className="w-4 h-4" />
                <span className="hidden md:inline">Search</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Payment Panel - Full Content Side */}
      {showPaymentPanel && (
        <div className="flex-1 overflow-y-auto p-1.5 sm:p-2">
          <PaymentPanel />
        </div>
      )}

      {/* Categories + Products - SCROLLABLE SECTION */}
      {!showPaymentPanel && (
        <div className="flex-1 overflow-y-auto p-1.5 sm:p-2">
        {/* Category Grid */}
        <div className="mb-3">
          <div className="text-sm sm:text-base font-bold text-neutral-800 mb-2 px-1">CATEGORIES</div>
          {loadingCategories ? (
            <div className="flex items-center justify-center py-6">
              <div className="text-center">
                <div className="w-10 h-10 bg-cyan-600 rounded-full flex items-center justify-center mx-auto mb-2 shadow-md">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                </div>
                <div className="text-cyan-700 font-semibold text-xs">Loading categories...</div>
                <div className="w-24 h-1 bg-cyan-100 rounded-full mx-auto mt-2 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-cyan-400 to-green-400 rounded-full animate-pulse" style={{ width: '50%' }}></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5 sm:gap-3 auto-rows-max">
              {categories.map(category => {
                const categoryKey = String(category._id || category.id || category.name);
                const color = CATEGORY_COLORS[category.name] || 'from-neutral-500 to-neutral-600';
                const icon = getCategoryIcon(category);
                const categoryImage = getCategoryImageUrl(category);
                const useCategoryImage = Boolean(categoryImage) && !failedCategoryImages.has(categoryKey);
                
                return (
                  <button
                    key={categoryKey}
                    onClick={() => {
                      setSelectedCategory(category);
                      setAppliedSearch('');
                      setSearchTerm('');
                    }}
                    className={`relative h-20 sm:h-28 rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-all duration-base transform hover:scale-105 touch-manipulation ${
                      selectedCategory?._id === category._id || selectedCategory?.id === category.id ? 'ring-4 ring-primary-500' : ''
                    }`}
                  >
                    {useCategoryImage ? (
                      <>
                        <Image
                          src={categoryImage}
                          alt={category.name}
                          fill
                          sizes="(max-width: 640px) 50vw, (max-width: 1280px) 20vw, 180px"
                          quality={68}
                          unoptimized={shouldBypassImageOptimization(categoryImage)}
                          className="object-cover"
                          onError={() => {
                            setFailedCategoryImages((prev) => new Set([...prev, categoryKey]));
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />
                      </>
                    ) : (
                      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-90`} />
                    )}

                    {/* Content */}
                    <div className="relative h-full flex flex-col items-center justify-center text-white text-center p-2 sm:p-3">
                      {!useCategoryImage && (
                        <FontAwesomeIcon icon={icon} className="w-6 h-6 sm:w-8 sm:h-8 mb-1.5 sm:mb-2" />
                      )}
                      <div className="text-sm sm:text-base font-bold leading-tight line-clamp-2">{category.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Product List - Category view or Search Results */}
        {false && appliedSearch ? (
          // Search Results View - Search across all products
          <div className="bg-white rounded-lg border-2 border-green-200 p-3 mt-3">
            <div className="text-base font-bold text-neutral-900 mb-3">
              🔍 Search Results
            </div>
            {(() => {
              const searchResults = allProducts.filter(product =>
                product.name.toLowerCase().includes(appliedSearch.toLowerCase()) ||
                (product.description && product.description.toLowerCase().includes(appliedSearch.toLowerCase()))
              );
              
              return searchResults.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 auto-rows-max">
                  {searchResults.map(product => {
                    const productKey = product._id || product.id;
                    const productImage = getProductImageUrl(product);
                    const showProductImage = isOnline && productImage && !failedImages.has(productKey);
                    const roomProduct = isRoomProduct(product);
                    const roomUnavailable = isRoomUnavailable(product);
                    const roomStatusLabel = getRoomStatusLabel(product.roomStatus);

                    return (
                    <button
                      key={productKey}
                      onClick={() => handleProductSelect(product)}
                      disabled={roomUnavailable}
                      className={`relative bg-white rounded-lg border-2 border-green-200 hover:border-green-400 hover:shadow-lg transition-all shadow-sm touch-manipulation overflow-hidden active:scale-[0.98] ${roomUnavailable ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      {/* Top Row: Image + Details Side by Side */}
                      <div className="flex h-14 sm:h-16">
                        {/* Product Image */}
                        <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-green-50 to-green-100 flex items-center justify-center overflow-hidden flex-shrink-0 relative">
                          {!isOnline && (
                            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-20">
                              <div className="text-xl">📦</div>
                            </div>
                          )}
                          
                          {isOnline && loadingImages[productKey] && !failedImages.has(productKey) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
                              <div className="animate-pulse text-lg">⏳</div>
                            </div>
                          )}
                          
                          {showProductImage ? (
                            <Image
                              src={productImage}
                              alt={product.name}
                              fill
                              sizes="64px"
                              quality={62}
                              unoptimized={shouldBypassImageOptimization(productImage)}
                              className="object-cover"
                              onLoad={() => setLoadingImages(prev => ({ ...prev, [productKey]: false }))}
                              onError={() => handleImageError(productKey)}
                            />
                          ) : (
                            <div className="text-xl">📦</div>
                          )}
                          
                          {/* Search Badge */}
                          <div className="absolute top-1 left-1 px-1 py-0.5 rounded text-xs font-bold bg-green-600 text-white">
                            🔍
                          </div>
                        </div>

                        {/* Product Details */}
                        <div className="flex-1 p-1.5 flex flex-col justify-between min-w-0">
                          <div className="text-[11px] sm:text-xs font-semibold text-gray-800 leading-tight line-clamp-2">
                            {product.name}
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            {/* Stock Badge */}
                            {roomProduct ? (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-bold ${roomUnavailable ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {roomStatusLabel}
                              </span>
                            ) : product.quantity !== undefined && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-bold ${
                                product.quantity <= 0 ? 'bg-red-100 text-red-700' :
                                product.quantity <= 5 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-green-100 text-green-700'
                              }`}>
                                {product.quantity <= 0 ? 'Out' : `${product.quantity} left`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Bottom Row: Price Full Width */}
                      <div className="bg-gradient-to-r from-green-500 to-green-600 px-2 py-1">
                        <div className="text-sm sm:text-base font-black text-white text-center">
                          ₦{Math.round(product.salePriceIncTax || 0).toLocaleString()}
                        </div>
                      </div>
                    </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-neutral-400 py-2 text-center">
                  No products match &quot;{searchTerm}&quot;
                </div>
              );
            })()}
          </div>
        ) : (selectedCategory || appliedSearch) && (
          // Category View
          <div className="bg-white rounded-lg border-2 border-primary-200 p-2 sm:p-3 mt-2 sm:mt-3">
            <div className="text-sm sm:text-base font-bold text-neutral-900 mb-2 sm:mb-3">
              {selectedCategory.name}
            </div>
            {loadingProducts ? (
              <div className="flex items-center justify-center py-6">
                <div className="text-center">
                  <div className="w-10 h-10 bg-cyan-600 rounded-full flex items-center justify-center mx-auto mb-2 shadow-md">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                  </div>
                  <div className="text-cyan-700 font-semibold text-xs">Loading products...</div>
                  <div className="w-24 h-1 bg-cyan-100 rounded-full mx-auto mt-2 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-cyan-400 to-green-400 rounded-full animate-pulse" style={{ width: '50%' }}></div>
                  </div>
                </div>
              </div>
            ) : (() => {
              const searchSource = appliedSearch && allProducts.length > 0 ? allProducts : products;
              const filteredProducts = appliedSearch
                ? searchSource.filter(product =>
                    product.name.toLowerCase().includes(appliedSearch.toLowerCase()) ||
                    (product.description && product.description.toLowerCase().includes(appliedSearch.toLowerCase()))
                  )
                : searchSource;
              
              return filteredProducts.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 auto-rows-max">
                {filteredProducts.map(product => {
                  const productKey = product._id || product.id;
                  const productImage = getProductImageUrl(product);
                  const showProductImage = isOnline && productImage && !failedImages.has(productKey);
                  const roomProduct = isRoomProduct(product);
                  const roomUnavailable = isRoomUnavailable(product);
                  const roomStatusLabel = getRoomStatusLabel(product.roomStatus);

                  return (
                  <button
                    key={productKey}
                    onClick={() => handleProductSelect(product)}
                    disabled={roomUnavailable}
                    className={`relative bg-white rounded border border-gray-200 hover:border-cyan-400 hover:shadow-md transition-all shadow-sm touch-manipulation overflow-hidden active:scale-[0.98] w-full ${roomUnavailable ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {/* Top Row: Image + Details Side by Side */}
                    <div className="flex h-14 sm:h-16">
                      {/* Product Image */}
                      <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0 relative">
                        {!isOnline && (
                          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-20">
                            <div className="text-xl">📦</div>
                          </div>
                        )}
                        
                        {isOnline && loadingImages[productKey] && !failedImages.has(productKey) && (
                          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
                            <div className="animate-pulse text-lg">⏳</div>
                          </div>
                        )}
                        
                        {showProductImage ? (
                          <Image
                            src={productImage}
                            alt={product.name}
                            fill
                            sizes="64px"
                            quality={62}
                            unoptimized={shouldBypassImageOptimization(productImage)}
                            className="object-cover"
                            onLoad={() => setLoadingImages(prev => ({ ...prev, [productKey]: false }))}
                            onError={() => handleImageError(productKey)}
                          />
                        ) : (
                          <div className="text-xl">📦</div>
                        )}
                      </div>

                      {/* Product Details */}
                      <div className="flex-1 p-1 flex flex-col justify-between min-w-0">
                        <div className="text-[11px] sm:text-xs font-bold text-gray-800 leading-tight line-clamp-2">
                          {product.name}
                        </div>
                        <div className="flex items-center justify-end mt-0.5">
                          {/* Stock Badge - Right Aligned */}
                          {roomProduct ? (
                            <span className={`px-1 py-0.5 rounded text-[10px] sm:text-xs font-bold ${roomUnavailable ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {roomStatusLabel}
                            </span>
                          ) : product.quantity !== undefined && (
                            <span className={`px-1 py-0.5 rounded text-[10px] sm:text-xs font-bold ${
                              product.quantity <= 0 ? 'bg-red-100 text-red-700' :
                              product.quantity <= 5 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-green-100 text-green-700'
                            }`}>
                              {product.quantity <= 0 ? 'Out' : `${parseFloat(product.quantity.toFixed(2))}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row: Price Full Width */}
                    <div className="bg-gradient-to-r from-cyan-500 to-cyan-600 px-2 py-1">
                      <div className="text-sm sm:text-base font-black text-white text-center">
                        ₦{Math.round(product.salePriceIncTax || 0).toLocaleString()}
                      </div>
                    </div>
                  </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-gray-400 py-2 text-center">
                {searchTerm ? 'No products match your search' : 'No products in this category'}
              </div>
            );
            })()}
          </div>
        )}

        {/* Empty State */}
        {!selectedCategory && (
          <div className="flex items-center justify-center text-gray-400 text-center py-6">
            <div>
              <div className="text-2xl mb-1">📦</div>
              <div className="text-xs">Select a category above</div>
            </div>
          </div>
        )}
        </div>
      )}

      <AlphaKeyboardModal
        isOpen={showSearchKeyboard}
        value={searchTerm}
        title="Search Products"
        placeholder="Search products or categories..."
        onChange={(value) => {
          setSearchTerm(value);
          if (!value.trim()) {
            setAppliedSearch('');
          }
        }}
        onClose={() => setShowSearchKeyboard(false)}
        onSubmit={handleSearchClick}
      />
      <RoomReservationModal
        product={roomToBook}
        initialReservation={roomToBook ? getRoomReservationDetails(roomToBook) : null}
        onClose={() => setRoomToBook(null)}
        onConfirm={handleRoomBookingConfirm}
      />
    </div>
  );
}
