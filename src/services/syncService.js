/**
 * Sync Service
 * Handles auto-syncing transactions when network is available
 */

import {
  getPendingTransactionsCount,
  syncPendingTillCloses,
  syncPendingTillOpens,
  syncPendingTransactions,
} from "../lib/offlineSync";

let syncInProgress = false;
let lastSyncAttempt = null;

/**
 * Auto-sync unsynced transactions to cloud
 */
export async function autoSyncTransactions() {
  // Don't sync if already syncing or no network
  if (syncInProgress || !navigator.onLine) {
    return { success: false, reason: "Already syncing or offline" };
  }

  syncInProgress = true;
  lastSyncAttempt = new Date();

  try {
    console.log("🔄 Starting auto-sync of transactions...");

    const pendingBefore = await getPendingTransactionsCount();
    console.log(`📤 Found ${pendingBefore} unsynced transactions`);

    if (pendingBefore === 0) {
      syncInProgress = false;
      return { success: true, synced: 0 };
    }

    // Use unified offline sync pipeline
    await syncPendingTillOpens();
    await syncPendingTransactions();
    await syncPendingTillCloses();

    const pendingAfter = await getPendingTransactionsCount();
    const syncedCount = Math.max(0, pendingBefore - pendingAfter);

    syncInProgress = false;
    console.log(`✅ Sync complete: ${syncedCount} synced, ${pendingAfter} remaining`);

    return {
      success: pendingAfter === 0,
      synced: syncedCount,
      failed: pendingAfter,
      total: pendingBefore,
    };
  } catch (err) {
    syncInProgress = false;
    console.error("❌ Auto-sync error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Setup online/offline listeners for auto-sync
 */
export function setupAutoSync() {
  // When going online, trigger sync
  window.addEventListener("online", () => {
    console.log("🌐 Back online! Starting auto-sync...");
    setTimeout(() => autoSyncTransactions(), 1000); // Wait 1s for connection stability
  });

  window.addEventListener("offline", () => {
    console.log("📵 Going offline - transactions will sync later");
  });

  console.log("✅ Auto-sync listeners setup");
}

/**
 * Get sync status
 */
export function getSyncStatus() {
  return {
    syncing: syncInProgress,
    lastAttempt: lastSyncAttempt,
    online: navigator.onLine,
  };
}
