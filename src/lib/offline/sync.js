/**
 * Offline Sync Manager
 * 
 * Handles automatic sync when connection is restored.
 * Strategy:
 * 1. Detect online/offline status
 * 2. Queue orders for sync when offline
 * 3. Attempt sync on connection restore
 * 4. Handle conflict resolution (server wins in case of conflict)
 * 5. Record sync metadata for audit trail
 */

import { offlineStorage } from './storage';

class SyncManager {
  constructor() {
    this.isSyncing = false;
    this.syncQueue = [];
    this.lastSyncTime = localStorage.getItem('pos_lastSyncTime');
  }

  /**
   * Queue order for sync (called when order is completed offline)
   */
  async queueForSync(order) {
    this.syncQueue.push({
      ...order,
      queuedAt: new Date().toISOString(),
      needsSync: true,
    });

    await offlineStorage.saveOrder({
      ...order,
      needsSync: true,
      queuedAt: new Date().toISOString(),
    });
  }

  /**
   * Attempt to sync all queued orders
   * In production, this would call backend API
   */
  async syncOrders() {
    if (this.isSyncing) {
      console.log('Sync already in progress');
      return;
    }

    this.isSyncing = true;

    try {
      // Get all orders that need sync
      const pendingOrders = await offlineStorage.getOrders({ status: 'COMPLETE' });
      const ordersToSync = pendingOrders.filter(o => o.needsSync);

      if (ordersToSync.length === 0) {
        console.log('No orders to sync');
        this.isSyncing = false;
        return { success: true, synced: 0 };
      }

      console.log(`Starting sync of ${ordersToSync.length} orders...`);

      // In production, call actual backend API
      const result = await this._syncWithBackend(ordersToSync);

      if (result.success) {
        // Mark orders as synced
        for (const order of ordersToSync) {
          await offlineStorage.saveOrder({
            ...order,
            needsSync: false,
            syncedAt: new Date().toISOString(),
          });
        }

        // Record sync event
        this.lastSyncTime = new Date().toISOString();
        localStorage.setItem('pos_lastSyncTime', this.lastSyncTime);

        await offlineStorage.recordSync({
          status: 'success',
          ordersCount: ordersToSync.length,
        });

        console.log(`Successfully synced ${ordersToSync.length} orders`);
      } else {
        await offlineStorage.recordSync({
          status: 'failure',
          ordersCount: ordersToSync.length,
          errorMessage: result.error,
        });

        console.error('Sync failed:', result.error);
      }

      this.isSyncing = false;
      return result;
    } catch (err) {
      console.error('Sync error:', err);

      await offlineStorage.recordSync({
        status: 'failure',
        ordersCount: this.syncQueue.length,
        errorMessage: err.message,
      });

      this.isSyncing = false;
      return { success: false, error: err.message };
    }
  }

  /**
   * Mock backend sync (in production, replace with actual API call)
   */
  async _syncWithBackend(orders) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      // In production: const response = await fetch('/api/orders/sync', { ... })
      // For now, mock success
      console.log('Mock sync: Would send to API:', {
        endpoint: '/api/orders/sync',
        ordersCount: orders.length,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        synced: orders.length,
        message: `Synced ${orders.length} orders`,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Setup automatic sync on connection restore
   */
  setupAutoSync() {
    window.addEventListener('online', async () => {
      console.log('Connection restored, attempting sync...');
      await this.syncOrders();
    });

    window.addEventListener('offline', () => {
      console.log('Connection lost, switching to offline mode');
    });
  }

  /**
   * Conflict resolution strategy:
   * Server version wins in case of conflict (simple first approach)
   * In production, might implement:
   * - Last-write-wins with timestamp comparison
   * - User-prompted conflict resolution UI
   * - Separate draft/synced states
   */
  resolveConflict(localOrder, serverOrder) {
    // Server version wins
    return serverOrder;
  }

  /**
   * Get sync status
   */
  getSyncStatus() {
    return {
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      pendingOrders: this.syncQueue.length,
    };
  }
}

export const syncManager = new SyncManager();
