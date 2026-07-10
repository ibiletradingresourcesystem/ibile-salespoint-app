import { getStoreLogo, setStoreLogo } from "@/src/lib/logoCache";
import { getUiSettings, saveUiSettings } from "@/src/lib/uiSettings";

const STORAGE_KEY = "posBootstrap";
const MAX_AGE_MS = 5 * 60 * 1000;

const canUseBrowserStorage = () => typeof window !== "undefined";

const getLocationId = (location) => String(location?._id || location?.id || "").trim();

const readCachedStore = () => {
  if (!canUseBrowserStorage()) return null;

  try {
    const rawValue = localStorage.getItem("cachedStore");
    return rawValue ? JSON.parse(rawValue) : null;
  } catch (error) {
    return null;
  }
};

const buildFallbackStoreData = (location) => {
  const cachedStore = readCachedStore();

  return {
    name: cachedStore?.name || "Store Name",
    logo: getStoreLogo(),
    location: location?.name || cachedStore?.location || "Store Location",
    address: location?.address || "",
    phone: location?.phone || "",
    currency: "NGN",
    taxRate: 0.1,
  };
};

const writePosBootstrap = (payload = {}) => {
  if (!canUseBrowserStorage()) return null;

  const nextValue = {
    ...payload,
    timestamp: Date.now(),
  };

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextValue));
  return nextValue;
};

export const clearPosBootstrap = () => {
  if (!canUseBrowserStorage()) return;
  sessionStorage.removeItem(STORAGE_KEY);
};

export const readPosBootstrap = ({ location } = {}) => {
  if (!canUseBrowserStorage()) return null;

  try {
    const rawValue = sessionStorage.getItem(STORAGE_KEY);
    if (!rawValue) return null;

    const parsedValue = JSON.parse(rawValue);
    if (!parsedValue?.timestamp) {
      clearPosBootstrap();
      return null;
    }

    if (Date.now() - parsedValue.timestamp > MAX_AGE_MS) {
      clearPosBootstrap();
      return null;
    }

    const expectedLocationId = getLocationId(location);
    if (expectedLocationId && parsedValue.locationId && parsedValue.locationId !== expectedLocationId) {
      return null;
    }

    return parsedValue;
  } catch (error) {
    clearPosBootstrap();
    return null;
  }
};

export const getOptimisticStoreData = ({ location } = {}) => {
  const bootstrap = readPosBootstrap({ location });
  return bootstrap?.storeData || buildFallbackStoreData(location);
};

export const primePosBootstrapFromCache = ({ staff, location } = {}) => {
  return writePosBootstrap({
    storeData: buildFallbackStoreData(location),
    uiSettings: getUiSettings(),
    storeId: String(staff?.storeId || "").trim(),
    locationId: getLocationId(location),
  });
};

export const primePosBootstrapFromLiveData = ({ staff, location, storeData, uiSettings } = {}) => {
  const fallbackStoreData = buildFallbackStoreData(location);
  const resolvedStoreData = {
    ...fallbackStoreData,
    ...(storeData || {}),
    location: location?.name || storeData?.location || fallbackStoreData.location,
    address: location?.address || storeData?.address || fallbackStoreData.address,
    phone: location?.phone || storeData?.phone || fallbackStoreData.phone,
  };

  if (resolvedStoreData.logo) {
    setStoreLogo(resolvedStoreData.logo);
  }

  const resolvedUiSettings = uiSettings ? saveUiSettings(uiSettings) : getUiSettings();

  return writePosBootstrap({
    storeData: resolvedStoreData,
    uiSettings: resolvedUiSettings,
    storeId: String(staff?.storeId || "").trim(),
    locationId: getLocationId(location),
  });
};