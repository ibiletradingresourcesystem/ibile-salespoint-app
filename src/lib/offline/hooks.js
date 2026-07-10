/**
 * Offline Utilities - Custom Hooks
 * 
 * Provides hooks for components to:
 * - Check online/offline status
 * - Monitor sync state
 * - Trigger sync on demand
 */

import { useEffect, useState, useCallback } from 'react';
import { syncManager } from './sync';

/**
 * Hook to detect online/offline status
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Set initial status
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Hook to monitor sync state
 */
export function useSyncState() {
  const [syncStatus, setSyncStatus] = useState(() => syncManager.getSyncStatus());

  useEffect(() => {
    // Poll sync status every 2 seconds
    const interval = setInterval(() => {
      setSyncStatus(syncManager.getSyncStatus());
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const triggerSync = useCallback(async () => {
    const result = await syncManager.syncOrders();
    setSyncStatus(syncManager.getSyncStatus());
    return result;
  }, []);

  return { ...syncStatus, triggerSync };
}
