/**
 * IndexedDB Service
 * Handles local storage of products, categories, and transactions
 */

const DB_NAME = "SalesPOS";
const DB_VERSION = 3;

// Store names
const STORES = {
  PRODUCTS: "products",
  CATEGORIES: "categories",
  TRANSACTIONS: "transactions",
  SYNC_META: "sync_meta", // Track sync status
  TILL_CLOSES: "till_closes", // Track offline till closes
  TILL_OPENS: "till_opens", // Track offline till opens / mappings
};

let db = null;

/**
 * Initialize IndexedDB
 */
export async function initIndexedDB() {
  // If we already have a valid connection, reuse it
  if (db) {
    try {
      // Quick check that the DB is still usable
      db.transaction([STORES.PRODUCTS], "readonly");
      return db;
    } catch (e) {
      // Connection is stale or stores are missing — re-open
      console.warn("⚠️ Stale IndexedDB connection, re-opening...");
      db = null;
    }
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("❌ IndexedDB failed to open:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      // Close the connection if another tab upgrades the DB version
      db.onversionchange = () => {
        db.close();
        db = null;
        console.warn("⚠️ IndexedDB version change detected, connection closed");
      };
      console.log("✅ IndexedDB initialized (v" + DB_VERSION + ")");
      resolve(db);
    };

    request.onblocked = () => {
      console.warn("⚠️ IndexedDB upgrade blocked — close other tabs using the app");
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      
      // Products store
      if (!database.objectStoreNames.contains(STORES.PRODUCTS)) {
        const productStore = database.createObjectStore(STORES.PRODUCTS, { keyPath: "_id" });
        productStore.createIndex("category", "category", { unique: false });
        console.log("📦 Products store created");
      }

      // Categories store
      if (!database.objectStoreNames.contains(STORES.CATEGORIES)) {
        database.createObjectStore(STORES.CATEGORIES, { keyPath: "_id" });
        console.log("📦 Categories store created");
      }

      // Transactions store (sales/orders)
      if (!database.objectStoreNames.contains(STORES.TRANSACTIONS)) {
        const txStore = database.createObjectStore(STORES.TRANSACTIONS, { 
          keyPath: "id", 
          autoIncrement: true 
        });
        txStore.createIndex("synced", "synced", { unique: false });
        txStore.createIndex("createdAt", "createdAt", { unique: false });
        console.log("📦 Transactions store created");
      }

      // Sync metadata
      if (!database.objectStoreNames.contains(STORES.SYNC_META)) {
        database.createObjectStore(STORES.SYNC_META, { keyPath: "key" });
        console.log("📦 Sync metadata store created");
      }

      // Till closes store (offline till reconciliation)
      if (!database.objectStoreNames.contains(STORES.TILL_CLOSES)) {
        const tillCloseStore = database.createObjectStore(STORES.TILL_CLOSES, { keyPath: "_id" });
        tillCloseStore.createIndex("synced", "synced", { unique: false });
        tillCloseStore.createIndex("closedAt", "closedAt", { unique: false });
        console.log("📦 Till closes store created");
      }

      // Till opens store (offline till open mapping)
      if (!database.objectStoreNames.contains(STORES.TILL_OPENS)) {
        const tillOpenStore = database.createObjectStore(STORES.TILL_OPENS, { keyPath: "_id" });
        tillOpenStore.createIndex("synced", "synced", { unique: false });
        tillOpenStore.createIndex("openedAt", "openedAt", { unique: false });
        console.log("📦 Till opens store created");
      }
    };
  });
}

/**
 * Add/Update products in local DB
 */
export async function syncProducts(products, options = {}) {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.PRODUCTS, STORES.SYNC_META], "readwrite");
    const productStore = transaction.objectStore(STORES.PRODUCTS);
    const metaStore = transaction.objectStore(STORES.SYNC_META);
    const replace = options?.replace === true;

    if (replace) {
      productStore.clear();
    }

    // Default behavior is upsert to preserve other cached products.
    products.forEach((product) => {
      productStore.put(product); // put() will update if exists, add if not
    });

    // Update sync timestamp
    metaStore.put({
      key: "lastProductSync",
      timestamp: new Date().toISOString(),
      count: products.length,
    });

    transaction.oncomplete = () => {
      const mode = replace ? "replaced" : "merged";
      console.log(`✅ Synced ${products.length} products to local DB (${mode})`);
      resolve({ success: true, count: products.length });
    };

    transaction.onerror = () => {
      console.error("❌ Failed to sync products:", transaction.error);
      reject(transaction.error);
    };
  });
}

/**
 * Add/Update categories in local DB
 */
export async function syncCategories(categories) {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.CATEGORIES, STORES.SYNC_META], "readwrite");
    const categoryStore = transaction.objectStore(STORES.CATEGORIES);
    const metaStore = transaction.objectStore(STORES.SYNC_META);

    // Clear existing categories
    categoryStore.clear();

    // Add new categories
    categories.forEach((category) => {
      categoryStore.add(category);
    });

    // Update sync timestamp
    metaStore.put({
      key: "lastCategorySync",
      timestamp: new Date().toISOString(),
      count: categories.length,
    });

    transaction.oncomplete = () => {
      console.log(`✅ Synced ${categories.length} categories to local DB`);
      resolve({ success: true, count: categories.length });
    };

    transaction.onerror = () => {
      console.error("❌ Failed to sync categories:", transaction.error);
      reject(transaction.error);
    };
  });
}

/**
 * Get all categories from local DB
 */
export async function getLocalCategories() {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.CATEGORIES], "readonly");
    const store = transaction.objectStore(STORES.CATEGORIES);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      console.error("❌ Failed to get categories:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Get products by category from local DB
 */
export async function getLocalProductsByCategory(category) {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.PRODUCTS], "readonly");
    const store = transaction.objectStore(STORES.PRODUCTS);
    const index = store.index("category");
    const request = index.getAll(category);

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      console.error("❌ Failed to get products:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Get all products from local DB (any category)
 */
export async function getAllLocalProducts() {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.PRODUCTS], "readonly");
    const store = transaction.objectStore(STORES.PRODUCTS);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      console.error("❌ Failed to get all products:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Add transaction (sale) to local DB
 */
export async function addLocalTransaction(transaction) {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const txStore = db.transaction([STORES.TRANSACTIONS], "readwrite");
    const store = txStore.objectStore(STORES.TRANSACTIONS);

    const baseId = transaction.externalId || transaction.clientId || transaction.id;
    const generatedId = baseId
      ? String(baseId)
      : `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    
    const transactionData = {
      ...transaction,
      externalId: transaction.externalId || generatedId,
      clientId: transaction.clientId || generatedId,
      createdAt: transaction.createdAt || new Date().toISOString(),
      synced: false, // Mark as unsynced
      syncAttempts: 0,
    };

    const request = store.add(transactionData);

    request.onsuccess = () => {
      console.log(`✅ Transaction ${request.result} saved locally`);
      resolve({ id: request.result, ...transactionData });
    };

    request.onerror = () => {
      console.error("❌ Failed to save transaction:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Get all unsynced transactions
 */
export async function getUnsyncedTransactions() {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.TRANSACTIONS], "readonly");
    const store = transaction.objectStore(STORES.TRANSACTIONS);
    const index = store.index("synced");
    // Query for all records where synced === false
    const request = index.getAll();

    request.onsuccess = () => {
      const allTxns = request.result || [];
      // Filter to only unsynced transactions (synced !== true)
      const unsynced = allTxns.filter(txn => txn.synced !== true);
      console.log(`📤 Found ${unsynced.length} unsynced transactions`);
      resolve(unsynced);
    };

    request.onerror = () => {
      console.error("❌ Failed to get unsynced transactions:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Mark transaction as synced
 */
export async function markTransactionSynced(id) {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.TRANSACTIONS], "readwrite");
    const store = transaction.objectStore(STORES.TRANSACTIONS);
    const request = store.get(id);

    request.onsuccess = () => {
      const data = request.result;
      if (data) {
        data.synced = true;
        data.syncedAt = new Date().toISOString();
        store.put(data);
        console.log(`✅ Transaction ${id} marked as synced`);
        resolve(data);
      } else {
        reject(new Error("Transaction not found"));
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Get sync metadata
 */
export async function getSyncMeta(key) {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.SYNC_META], "readonly");
    const store = transaction.objectStore(STORES.SYNC_META);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Clear all local data (for testing)
 */
export async function clearAllData() {
  if (!db) await initIndexedDB();

  return new Promise((resolve, reject) => {
    const allStoreNames = Object.values(STORES);
    const transaction = db.transaction(allStoreNames, "readwrite");

    allStoreNames.forEach((storeName) => {
      transaction.objectStore(storeName).clear();
    });

    transaction.oncomplete = () => {
      console.log("✅ All local data cleared");
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
}
