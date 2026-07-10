/**
 * Category Cache Cleanup Utility
 * 
 * Clears cached categories from IndexedDB to force fresh fetch
 * Useful when categories structure changes or location-based filtering is needed
 */

// Shared upgrade handler - ensures all stores exist
function ensureAllStores(db) {
  if (!db.objectStoreNames.contains('products')) {
    const s = db.createObjectStore('products', { keyPath: '_id' });
    s.createIndex('category', 'category', { unique: false });
  }
  if (!db.objectStoreNames.contains('categories')) {
    db.createObjectStore('categories', { keyPath: '_id' });
  }
  if (!db.objectStoreNames.contains('transactions')) {
    const s = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
    s.createIndex('synced', 'synced', { unique: false });
    s.createIndex('createdAt', 'createdAt', { unique: false });
  }
  if (!db.objectStoreNames.contains('sync_meta')) {
    db.createObjectStore('sync_meta', { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains('till_closes')) {
    const s = db.createObjectStore('till_closes', { keyPath: '_id' });
    s.createIndex('synced', 'synced', { unique: false });
    s.createIndex('closedAt', 'closedAt', { unique: false });
  }
  if (!db.objectStoreNames.contains('till_opens')) {
    const s = db.createObjectStore('till_opens', { keyPath: '_id' });
    s.createIndex('synced', 'synced', { unique: false });
    s.createIndex('openedAt', 'openedAt', { unique: false });
  }
}

export async function clearCategoriesCache() {
  try {
    const request = indexedDB.open('SalesPOS', 3);

    return new Promise((resolve, reject) => {
      request.onupgradeneeded = (event) => {
        ensureAllStores(event.target.result);
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const catStore = db.transaction(['categories'], 'readwrite')
          .objectStore('categories');

        const clearRequest = catStore.clear();

        clearRequest.onsuccess = () => {
          console.log('✅ Categories cache cleared');
          resolve(true);
        };

        clearRequest.onerror = () => {
          console.error('❌ Error clearing categories cache:', clearRequest.error);
          reject(clearRequest.error);
        };
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('❌ Error clearing categories cache:', err);
    throw err;
  }
}
