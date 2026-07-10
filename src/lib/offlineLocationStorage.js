/**
 * Offline Location Storage Utility
 * 
 * Manages local storage of locations for offline login capability
 * Allows staff to login and work offline using cached location data
 * 
 * Features:
 * - Cache locations from API
 * - Retrieve cached locations for offline use
 * - Store metadata about cached locations
 * - Validate location availability offline
 * - Manage location sync status
 */

/**
 * Cache locations locally for offline access
 * @param {Array} locations - Array of location objects to cache
 * @returns {boolean} - True if caching was successful
 */
export function cacheLocationsOffline(locations) {
  try {
    if (!Array.isArray(locations)) {
      console.warn('⚠️ Invalid locations array provided to cacheLocationsOffline');
      return false;
    }

    // Store the locations data
    localStorage.setItem('cachedLocations', JSON.stringify(locations));

    // Store metadata
    const metadata = {
      lastSynced: new Date().toISOString(),
      count: locations.length,
      locationNames: locations.map(l => l.name),
      locationIds: locations.map(l => l._id)
    };
    localStorage.setItem('locations_metadata', JSON.stringify(metadata));

    console.log(`💾 [Offline Storage] Cached ${locations.length} locations for offline access`);
    console.log(`📍 Available locations: ${locations.map(l => l.name).join(', ')}`);

    return true;
  } catch (error) {
    console.error('❌ Failed to cache locations offline:', error);
    return false;
  }
}

/**
 * Retrieve cached locations from localStorage
 * @returns {Array} - Array of cached locations or empty array if none found
 */
export function getCachedLocationsOffline() {
  try {
    const cached = localStorage.getItem('cachedLocations');
    if (!cached) {
      console.warn('⚠️ No cached locations found');
      return [];
    }

    const locations = JSON.parse(cached);
    if (!Array.isArray(locations)) {
      console.warn('⚠️ Cached locations data is not an array');
      return [];
    }

    console.log(`✅ Retrieved ${locations.length} cached locations for offline use`);
    return locations;
  } catch (error) {
    console.error('❌ Failed to retrieve cached locations:', error);
    return [];
  }
}

/**
 * Get metadata about cached locations
 * @returns {Object|null} - Metadata object or null if not found
 */
export function getLocationsMetadata() {
  try {
    const metadata = localStorage.getItem('locations_metadata');
    if (!metadata) {
      return null;
    }

    const parsed = JSON.parse(metadata);
    return {
      ...parsed,
      lastSynced: new Date(parsed.lastSynced).toLocaleString(),
      lastSyncedISO: parsed.lastSynced
    };
  } catch (error) {
    console.error('❌ Failed to retrieve locations metadata:', error);
    return null;
  }
}

/**
 * Check if a specific location is available offline
 * @param {string} locationId - The ID of the location to check
 * @returns {boolean} - True if location is available offline
 */
export function isLocationAvailableOffline(locationId) {
  const locations = getCachedLocationsOffline();
  return locations.some(loc => loc._id === locationId);
}

/**
 * Get a specific location by ID from offline cache
 * @param {string} locationId - The ID of the location to retrieve
 * @returns {Object|null} - Location object or null if not found
 */
export function getLocationOffline(locationId) {
  const locations = getCachedLocationsOffline();
  return locations.find(loc => loc._id === locationId) || null;
}

/**
 * Get all location names from offline cache
 * @returns {Array} - Array of location names
 */
export function getOfflineLocationNames() {
  const locations = getCachedLocationsOffline();
  return locations.map(loc => loc.name);
}

/**
 * Clear offline location cache (for logout or sync reset)
 * @returns {boolean} - True if clearing was successful
 */
export function clearOfflineLocationCache() {
  try {
    localStorage.removeItem('cachedLocations');
    localStorage.removeItem('locations_metadata');
    console.log('🗑️ Cleared offline location cache');
    return true;
  } catch (error) {
    console.error('❌ Failed to clear offline location cache:', error);
    return false;
  }
}

/**
 * Check if cached locations are stale (older than specified hours)
 * @param {number} maxAgeHours - Maximum age of cache in hours (default: 24)
 * @returns {boolean} - True if cache is stale
 */
export function isLocationCacheStale(maxAgeHours = 24) {
  try {
    const metadata = localStorage.getItem('locations_metadata');
    if (!metadata) {
      return true; // No cache = stale
    }

    const parsed = JSON.parse(metadata);
    const lastSynced = new Date(parsed.lastSynced);
    const now = new Date();
    const hoursDiff = (now - lastSynced) / (1000 * 60 * 60);

    const isStale = hoursDiff > maxAgeHours;
    if (isStale) {
      console.warn(`⚠️ Location cache is stale (${Math.round(hoursDiff)} hours old, max: ${maxAgeHours} hours)`);
    }

    return isStale;
  } catch (error) {
    console.error('❌ Failed to check cache staleness:', error);
    return true; // Assume stale on error
  }
}

/**
 * Get offline location sync status for UI display
 * @returns {Object} - Status object with sync info
 */
export function getOfflineLocationSyncStatus() {
  try {
    const metadata = getLocationsMetadata();
    const locations = getCachedLocationsOffline();

    return {
      hasCachedData: locations.length > 0,
      cachedLocationCount: locations.length,
      cachedLocationNames: locations.map(l => l.name),
      lastSynced: metadata?.lastSynced || 'Never',
      lastSyncedISO: metadata?.lastSyncedISO || null,
      isCacheStale: isLocationCacheStale(),
      message: locations.length > 0 
        ? `${locations.length} locations cached for offline (last synced: ${metadata?.lastSynced || 'Unknown'})`
        : 'No offline location data available'
    };
  } catch (error) {
    console.error('❌ Failed to get sync status:', error);
    return {
      hasCachedData: false,
      cachedLocationCount: 0,
      cachedLocationNames: [],
      lastSynced: 'Error',
      isCacheStale: true,
      message: 'Error reading offline location data'
    };
  }
}

/**
 * Log detailed information about offline location storage
 * Useful for debugging offline functionality
 */
export function logOfflineLocationDebugInfo() {
  console.group('📍 Offline Location Storage Debug Info');
  
  try {
    const locations = getCachedLocationsOffline();
    const metadata = getLocationsMetadata();
    const syncStatus = getOfflineLocationSyncStatus();

    console.log('Cached Locations:', locations);
    console.log('Metadata:', metadata);
    console.log('Sync Status:', syncStatus);
    console.log('Cache Stale?:', isLocationCacheStale());

    if (locations.length > 0) {
      console.log('Location Details:');
      locations.forEach((loc, idx) => {
        console.log(`  [${idx}] ${loc.name} (ID: ${loc._id})`);
        if (loc.address) console.log(`      Address: ${loc.address}`);
        if (loc.phone) console.log(`      Phone: ${loc.phone}`);
        console.log(`      Status: ${loc.isActive !== false ? 'Active' : 'Inactive'}`);
      });
    }
  } catch (error) {
    console.error('Error retrieving debug info:', error);
  }

  console.groupEnd();
}
