/**
 * Offline Storage Module
 * 
 * Handles persistent storage using IndexedDB for large datasets
 * and localStorage for quick access to small state.
 * 
 * Strategy:
 * - localStorage: cart state, sync metadata, last sync time
 * - IndexedDB: completed orders (large volume)
 * - Automatic fallback to localStorage if IndexedDB unavailable
 */

const DB_NAME = 'SalesPOS';
const DB_VERSION = 3;
const STORES = {
  ORDERS: 'orders',
  SYNC_LOG: 'sync_log',
};

class OfflineStorage {
  constructor() {
    this.db = null;
    this.isIndexedDBAvailable = false;
  }

  /**
   * Initialize IndexedDB connection
   */
  async init() {
    try {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.warn('IndexedDB not available, falling back to localStorage');
          this.isIndexedDBAvailable = false;
          resolve(false);
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.isIndexedDBAvailable = true;
          resolve(true);
        };

        request.onupgradeneeded = event => {
          const db = event.target.result;
          // Legacy stores for offline/storage.js
          if (!db.objectStoreNames.contains(STORES.ORDERS)) {
            const orderStore = db.createObjectStore(STORES.ORDERS, { keyPath: 'id' });
            orderStore.createIndex('status', 'status', { unique: false });
            orderStore.createIndex('createdAt', 'createdAt', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORES.SYNC_LOG)) {
            db.createObjectStore(STORES.SYNC_LOG, { keyPath: 'id' });
          }
          // Ensure all main app stores also exist (shared DB)
          if (!db.objectStoreNames.contains('products')) {
            const productStore = db.createObjectStore('products', { keyPath: '_id' });
            productStore.createIndex('category', 'category', { unique: false });
          }
          if (!db.objectStoreNames.contains('categories')) {
            db.createObjectStore('categories', { keyPath: '_id' });
          }
          if (!db.objectStoreNames.contains('transactions')) {
            const txStore = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
            txStore.createIndex('synced', 'synced', { unique: false });
            txStore.createIndex('createdAt', 'createdAt', { unique: false });
          }
          if (!db.objectStoreNames.contains('sync_meta')) {
            db.createObjectStore('sync_meta', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('till_closes')) {
            const tillCloseStore = db.createObjectStore('till_closes', { keyPath: '_id' });
            tillCloseStore.createIndex('synced', 'synced', { unique: false });
            tillCloseStore.createIndex('closedAt', 'closedAt', { unique: false });
          }
          if (!db.objectStoreNames.contains('till_opens')) {
            const tillOpenStore = db.createObjectStore('till_opens', { keyPath: '_id' });
            tillOpenStore.createIndex('synced', 'synced', { unique: false });
            tillOpenStore.createIndex('openedAt', 'openedAt', { unique: false });
          }
        };
      });
    } catch (err) {
      console.warn('IndexedDB initialization failed:', err);
      this.isIndexedDBAvailable = false;
      return false;
    }
  }

  /**
   * Save order to persistent storage
   */
  async saveOrder(order) {
    try {
      if (this.isIndexedDBAvailable && this.db) {
        return new Promise((resolve, reject) => {
          const tx = this.db.transaction([STORES.ORDERS], 'readwrite');
          const store = tx.objectStore(STORES.ORDERS);
          const request = store.put(order);

          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(order);
        });
      } else {
        // Fallback to localStorage
        const orders = JSON.parse(localStorage.getItem('pos_orders') || '[]');
        const idx = orders.findIndex(o => o.id === order.id);
        if (idx >= 0) {
          orders[idx] = order;
        } else {
          orders.push(order);
        }
        localStorage.setItem('pos_orders', JSON.stringify(orders));
        return order;
      }
    } catch (err) {
      console.error('Failed to save order:', err);
      throw err;
    }
  }

  /**
   * Retrieve all orders with optional filter
   */
  async getOrders(filter = {}) {
    try {
      if (this.isIndexedDBAvailable && this.db) {
        return new Promise((resolve, reject) => {
          const tx = this.db.transaction([STORES.ORDERS], 'readonly');
          const store = tx.objectStore(STORES.ORDERS);
          const request = store.getAll();

          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            let orders = request.result;
            if (filter.status) {
              orders = orders.filter(o => o.status === filter.status);
            }
            resolve(orders);
          };
        });
      } else {
        const orders = JSON.parse(localStorage.getItem('pos_orders') || '[]');
        if (filter.status) {
          return orders.filter(o => o.status === filter.status);
        }
        return orders;
      }
    } catch (err) {
      console.error('Failed to retrieve orders:', err);
      return [];
    }
  }

  /**
   * Delete order
   */
  async deleteOrder(orderId) {
    try {
      if (this.isIndexedDBAvailable && this.db) {
        return new Promise((resolve, reject) => {
          const tx = this.db.transaction([STORES.ORDERS], 'readwrite');
          const store = tx.objectStore(STORES.ORDERS);
          const request = store.delete(orderId);

          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } else {
        const orders = JSON.parse(localStorage.getItem('pos_orders') || '[]');
        const filtered = orders.filter(o => o.id !== orderId);
        localStorage.setItem('pos_orders', JSON.stringify(filtered));
      }
    } catch (err) {
      console.error('Failed to delete order:', err);
    }
  }

  /**
   * Record sync event
   */
  async recordSync(event) {
    const syncLog = {
      id: `sync_${Date.now()}`,
      timestamp: new Date().toISOString(),
      status: event.status, // 'success' | 'failure'
      ordersCount: event.ordersCount || 0,
      errorMessage: event.errorMessage || null,
    };

    try {
      if (this.isIndexedDBAvailable && this.db) {
        return new Promise((resolve, reject) => {
          const tx = this.db.transaction([STORES.SYNC_LOG], 'readwrite');
          const store = tx.objectStore(STORES.SYNC_LOG);
          const request = store.add(syncLog);

          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(syncLog);
        });
      } else {
        const logs = JSON.parse(localStorage.getItem('pos_syncLog') || '[]');
        logs.push(syncLog);
        localStorage.setItem('pos_syncLog', JSON.stringify(logs));
        return syncLog;
      }
    } catch (err) {
      console.error('Failed to record sync:', err);
    }
  }

  /**
   * Clear all data (nuclear option)
   */
  async clearAll() {
    try {
      if (this.isIndexedDBAvailable && this.db) {
        return new Promise((resolve, reject) => {
          const tx = this.db.transaction(Object.values(STORES), 'readwrite');
          Object.values(STORES).forEach(storeName => {
            const store = tx.objectStore(storeName);
            store.clear();
          });

          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => resolve();
        });
      } else {
        localStorage.removeItem('pos_orders');
        localStorage.removeItem('pos_syncLog');
        localStorage.removeItem('pos_activeCart');
      }
    } catch (err) {
      console.error('Failed to clear storage:', err);
    }
  }
}

export const offlineStorage = new OfflineStorage();
