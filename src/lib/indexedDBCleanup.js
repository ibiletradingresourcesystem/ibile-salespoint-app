/**
 * IndexedDB Cleanup Utility
 * 
 * Removes old invalid transactions with status 'COMPLETE'
 * This is needed for migration from old cart format to new transaction format
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

export async function cleanupOldTransactions() {
  try {
    const request = indexedDB.open('SalesPOS', 3);

    return new Promise((resolve, reject) => {
      request.onupgradeneeded = (event) => {
        ensureAllStores(event.target.result);
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const txStore = db.transaction(['transactions'], 'readwrite')
          .objectStore('transactions');

        const getAllRequest = txStore.getAll();

        getAllRequest.onsuccess = () => {
          const transactions = getAllRequest.result;
          let deleted = 0;

          transactions.forEach(tx => {
            // Delete if status is invalid (old cart objects)
            // Check if tx.id is a string before calling startsWith
            const isOldCartObject = tx.status === 'COMPLETE' || 
                                    (typeof tx.id === 'string' && tx.id.startsWith('order_'));
            
            if (isOldCartObject) {
              txStore.delete(tx.id || tx); // Delete by key (id)
              deleted++;
              console.log(`🗑️ Deleted old transaction: ${tx.id}`);
            }
          });

          if (deleted > 0) {
            console.log(`✅ Cleaned up ${deleted} old transactions`);
          } else {
            console.log('✅ No old transactions to clean up');
          }

          resolve(deleted);
        };

        getAllRequest.onerror = () => reject(getAllRequest.error);
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('❌ Error cleaning up transactions:', err);
    throw err;
  }
}
